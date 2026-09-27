import { buildBounds, validateMagneticBuild } from "@/lib/engine/build";
import { add, magnitude, scale } from "@/lib/engine/math";
import type { EngineState } from "@/lib/engine/rapier-world";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import { stageBuild } from "./geometry";
import { planConstructionPaths } from "./construction";
import { findInsertionPath, type InsertionPath } from "./insertion";
import { checkHandAccess } from "./grip";
import { simulateSupport, type SupportTrial } from "./support";
import { contactsClosed } from "./contacts";
import { simulateGravitySeat, type SeatingTrial } from "./seating";
import { simulateHeldMotion, type HeldMotionTrial } from "./held-motion";
import { tileQuaternion } from "./rotation-clearance";
import { dockToSupports } from "./docking";
import type { Check, Replica } from "./types";

export interface AssemblyOperationResult extends Check {
  index: number;
  seed: number;
  tileIds: string[];
  path?: InsertionPath;
  approachTiles?: TileInstance[];
  grip?: Check;
  closure?: Check;
  seating?: Omit<SeatingTrial, "settled" | "state">;
  carry?: Omit<HeldMotionTrial, "settled" | "state">;
  pickup?: Omit<HeldMotionTrial, "settled" | "state">;
  lowering?: Omit<HeldMotionTrial, "settled" | "state">;
  docking?: Check & { offset: { x: number; y: number; z: number } };
  timeline?: ({ phase: "pickup" | "carry" | "seating" | "lowering" } | { phase: "support"; index: number })[];
  trials: Omit<SupportTrial, "settled" | "state">[];
}
export interface AssemblyResult extends Check {
  stageId: string;
  operations: AssemblyOperationResult[];
  checkpoints: Omit<SupportTrial, "settled" | "state">[];
}
const subset = (build: BuildGraph, ids: Set<string>): BuildGraph => ({ ...build,
  tiles: build.tiles.filter(t => ids.has(t.id)),
  connections: build.connections.filter(c => ids.has(c.fromTileId) && ids.has(c.toTileId)) });
const mergePoses = (build: BuildGraph, state: BuildGraph): BuildGraph => ({ ...build,
  tiles: build.tiles.map(t => state.tiles.find(actual => actual.id === t.id) ?? t) });

/** A path with empty air at both ends is not a magnetic assembly operation. */
export function checkClosure(build: BuildGraph, path: InsertionPath): Check {
  const present = subset(build, new Set([...path.movingTileIds, ...path.fixedTileIds]));
  const closure = contactsClosed(present);
  if (closure.status !== "pass") return closure;
  const validation = validateMagneticBuild(present);
  if (!path.fixedTileIds.length) return { status: "pass", detail: "First part/module placed; no pre-existing join required." };
  const cross = validation.validConnections.filter(c => path.movingTileIds.includes(c.fromTile.id) !== path.movingTileIds.includes(c.toTile.id));
  if (!cross.length) return { status: "fail", detail: "Inserted module has no validated magnetic edge contact to installed parts." };
  for (const c of cross) {
    const a = path.movingTileIds.includes(c.fromTile.id) ? c.fromTile : c.toTile;
    const b = a === c.fromTile ? c.toTile : c.fromTile;
    if (findMagneticEdgeMatch({ ...a, position: add(a.position, path.offsets[0]) }, b))
      return { status: "fail", detail: "Insertion begins already attached; a separated pre-snap pose is required." };
  }
  return { status: "pass", detail: `${cross.length} new edge contacts close after a separated, clear approach. Gap ≤ thickness + 0.03 in, alignment within 5 degrees and overlap within 0.21 in of the shorter edge. Magnetic force remains a model assumption.` };
}

/** Bounded assembly: retain actual poses, velocities, local hinge frames and
 * break history across support, insertion, seating and release. */
export async function evaluateAssembly(replica: Replica, deadline = Infinity): Promise<AssemblyResult[]> {
  const coverage = planConstructionPaths(replica, deadline), results: AssemblyResult[] = [];
  const prepared = new Map<string, Map<number, { build: BuildGraph; floorY: number; state?: EngineState }>>();
  for (const stage of replica.stages) {
    const result: AssemblyResult = { stageId: stage.id, status: "unverified", detail: "No complete supported construction contract.", operations: [], checkpoints: [] };
    results.push(result);
    const paths = coverage.find(p => p.stageId === stage.id)!;
    if (paths.status !== "pass") { result.status = paths.status; result.detail = paths.detail; continue; }
    const plan = replica.construction!.find(p => p.stageId === stage.id)!;
    if (plan.operations.some(op => !op.hands?.length)) continue;
    const dependencies = [...(stage.installedStageIds ?? []), ...plan.operations.flatMap(op => op.preparedStageId ? [op.preparedStageId] : [])];
    if (dependencies.some(id => !prepared.has(id))) { result.detail = "An earlier module has not passed its complete supported assembly."; continue; }
    if (dependencies.length && (stage.transform || dependencies.some(id => replica.stages.find(s => s.id === id)?.transform))) {
      result.detail = "A stage rotation/transfer needs a continuous validated orientation trajectory."; continue;
    }
    if ((stage.installedStageIds?.length ?? 0) > 1 || plan.operations.some(op => op.preparedStageId)) {
      result.detail = "Prepared worlds require an explicit continuous transfer before they can be combined."; continue;
    }
    const nominal = stageBuild(replica, stage), floorY = buildBounds(nominal.tiles).min.y;
    const states = new Map<number, { build: BuildGraph; floorY: number; state?: EngineState }>();
    const failures: string[] = [];
    for (const seed of [0, 17, 53]) {
      let failure = "";
      let current = structuredClone(nominal);
      let physicalState: EngineState | undefined;
      const placed = new Set<string>();
      for (const id of stage.installedStageIds ?? []) {
        const previous = prepared.get(id)!.get(seed)!;
        const aligned = { ...previous.build, tiles: previous.build.tiles.map(t => ({ ...t,
          position: { ...t.position, y: t.position.y + floorY - previous.floorY } })) };
        current = mergePoses(current, aligned);
        physicalState = previous.state;
        aligned.tiles.forEach(t => placed.add(t.id));
      }
      for (const [index, operation] of plan.operations.entries()) {
        const row: AssemblyOperationResult = { index, seed, tileIds: operation.tileIds, status: "fail", detail: "", trials: [], timeline: [] };
        result.operations.push(row);
        const record = async (build: BuildGraph, holds: string[]) => {
          const gripDefinitions = [...(operation.hands ?? []), ...(operation.pickup ? [operation.pickup.hand] : [])];
          const supportHands = holds.map(id => gripDefinitions.find(h => h.tileId === id)!);
          const trial = await simulateSupport(build, holds, floorY, seed, deadline, physicalState, supportHands);
          const { settled, state, ...summary } = trial;
          physicalState = state;
          row.trials.push(summary);
          row.timeline!.push({ phase: "support",index: row.trials.length-1 });
          if (trial.status !== "pass") failure = trial.detail;
          if (!failure) {
            const closure = contactsClosed(settled);
            if (closure.status !== "pass") failure = closure.detail;
          }
          return settled;
        };
        const hands = operation.hands!, moving = new Set(operation.tileIds);
        if (hands.length > 2 || new Set(hands.map(h => h.tileId)).size !== hands.length ||
            hands.some(h => !moving.has(h.tileId) && !placed.has(h.tileId)) || hands.filter(h => moving.has(h.tileId)).length !== 1) {
          failure = row.detail = "Need one insertion hand and at most one distinct installed-panel support hand."; break;
        }
        const support = hands.filter(h => placed.has(h.tileId)).map(h => h.tileId);
        if (operation.pickup) {
          const { height, hand } = operation.pickup;
          if (!Number.isFinite(height) || height <= 0 || height > .9 || !placed.has(hand.tileId) || support.length !== 1 || support[0] === hand.tileId) {
            failure = row.detail = "Pickup needs a bounded lift and a distinct one-panel support handoff."; break;
          }
          const prefix = subset(current,placed), tile = prefix.tiles.find(t => t.id === hand.tileId)!, q = tileQuaternion(tile);
          const lifted = await simulateHeldMotion(prefix,physicalState,[...placed],[hand], [
            { seconds: 0,position: tile.position,rotation: q }, { seconds: 1,position: add(tile.position,{ x: 0,y: height,z: 0 }),rotation: q }],floorY,seed,deadline);
          const { settled,state,...summary } = lifted;
          row.pickup = summary;
          row.timeline!.push({ phase: "pickup" });
          if (lifted.status !== "pass") { failure = row.detail = lifted.detail; break; }
          current = mergePoses(current,settled); physicalState = state;
          const handoff = checkHandAccess(subset(current,placed), { id: "handoff", movingTileIds: [hand.tileId], fixedTileIds: [...placed].filter(id => id !== hand.tileId),
            offsets: [{ x: 0,y: 0,z: 0 },{ x: 0,y: 0,z: 0 }] },[hand,...hands.filter(h => placed.has(h.tileId))],floorY);
          if (handoff.status !== "pass") { failure = row.detail = handoff.detail; break; }
          current = mergePoses(current, await record(subset(current,placed),[hand.tileId,...support]));
          if (failure) { row.detail = failure; break; }
        }
        // Remove the previous insertion hand before using it for another tile.
        if (placed.size) {
          current = mergePoses(current, await record(subset(current, placed), support));
          if (failure) { row.detail = failure; break; }
        }
        if (!operation.gravitySeat && placed.size) {
          const docking = dockToSupports(nominal, current, operation.tileIds, [...placed], hands, floorY, deadline);
          row.docking = { status: docking.status, detail: docking.detail, offset: docking.offset };
          if (docking.status !== "pass") { failure = row.detail = docking.detail; break; }
          current = docking.build;
        }
        const releaseOffset = { x: 0, y: operation.gravitySeat?.releaseHeight ?? 0, z: 0 };
        const approachPose = () => ({ ...current, tiles: current.tiles.map(t => moving.has(t.id)
          ? { ...t, position: add(t.position, releaseOffset) } : t) });
        let approach = approachPose();
        const path = findInsertionPath(approach, operation.tileIds, [...placed], deadline, floorY);
        if (!path) { failure = row.detail = "Settled predecessors block insertion."; break; }
        row.path = path;
        row.grip = checkHandAccess(approach, path, hands, floorY);
        if (row.grip.status !== "pass") { failure = row.detail = row.grip.detail; break; }
        const airborne = subset(approach, new Set([...moving, ...placed]));
        airborne.tiles = airborne.tiles.map(t => moving.has(t.id) ? { ...t, position: add(t.position, path!.offsets[0]) } : t);
        airborne.connections = airborne.connections.filter(c => moving.has(c.fromTileId) === moving.has(c.toTileId));
        const pickup = approach.tiles.find(t => t.id === hands.find(h => moving.has(h.tileId))!.tileId)!;
        let seconds = 0;
        const waypoints = path.offsets.map((offset, i) => {
          if (i) seconds += Math.max(.1, magnitude(add(offset, scale(path!.offsets[i-1],-1))) / 1.5);
          return { seconds, position: add(pickup.position, offset), rotation: tileQuaternion(pickup) };
        });
        const carried = await simulateHeldMotion(airborne, physicalState, operation.tileIds, hands, waypoints, floorY, seed, deadline);
        const { settled: carriedPose, state: carriedState, ...carrySummary } = carried;
        row.carry = carrySummary;
        row.timeline!.push({ phase: "carry" });
        if (carried.status !== "pass") { failure = row.detail = carried.detail; break; }
        physicalState = carriedState;
        approach = mergePoses(approach, carriedPose);
        row.approachTiles = approach.tiles.filter(t => moving.has(t.id) || placed.has(t.id));
        current = mergePoses(current, { ...carriedPose, tiles: carriedPose.tiles.map(t => moving.has(t.id)
          ? { ...t, position: add(t.position, scale(releaseOffset,-1)) } : t) });
        if (operation.gravitySeat) {
          const seated = await simulateGravitySeat(subset(current, new Set([...placed, ...moving])), operation.tileIds, hands,
            operation.gravitySeat.releaseHeight, floorY, seed, deadline, physicalState);
          const { settled, state, ...summary } = seated;
          row.seating = summary;
          row.timeline!.push({ phase: "seating" });
          if (seated.path) row.path = seated.path;
          if (seated.motion.length) row.approachTiles = seated.motion[0].tiles;
          row.closure = { status: seated.status, detail: seated.detail };
          if (seated.status !== "pass") { failure = row.detail = seated.detail; break; }
          current = mergePoses(current, settled);
          physicalState = state;
        } else {
          row.closure = checkClosure(current, path);
          if (row.closure.status !== "pass") { failure = row.detail = row.closure.detail; break; }
        }
        moving.forEach(id => placed.add(id));
        current = mergePoses(current, await record(subset(current, placed), operation.gravitySeat ? support : hands.map(h => h.tileId)));
        if (!failure && operation.lowerBeforeRelease !== undefined) {
          const height = operation.lowerBeforeRelease, hand = hands.find(h => support.includes(h.tileId));
          if (!operation.releaseAfter || !hand || support.length !== 1 || !Number.isFinite(height) || height <= 0 || height > .9) {
            failure = row.detail = "Controlled descent needs one support panel, a bounded distance and a following release."; break;
          }
          const prefix = subset(current,placed), tile = prefix.tiles.find(t => t.id === hand.tileId)!, q = tileQuaternion(tile);
          const lowered = await simulateHeldMotion(prefix,physicalState,[...placed],[hand], [
            { seconds: 0,position: tile.position,rotation: q }, { seconds: 1,position: add(tile.position,{ x: 0,y: -height,z: 0 }),rotation: q }],floorY,seed,deadline);
          const { settled,state,...summary } = lowered;
          row.lowering = summary;
          row.timeline!.push({ phase: "lowering" });
          if (lowered.status !== "pass") { failure = row.detail = lowered.detail; break; }
          current = mergePoses(current,settled); physicalState = state;
        }
        if (!failure && operation.releaseAfter)
          current = mergePoses(current, await record(subset(current, placed), []));
        if (failure) { row.detail = failure; break; }
        row.status = "pass";
        row.detail = operation.gravitySeat ? "Clear release grip, gravity-seated contacts and stable connected prefix; actual motion retained."
          : "Clear grip and insertion, connected closure and stable supported prefix; actual settled poses retained.";
      }
      if (failure) { failures.push(`Seed ${seed}: ${failure}`); continue; }
      // Includes release-only checkpoints which add no new parts. Reusing a held
      // module must never skip its first unsupported release.
      if (stage.support === "released") {
        const { settled, state, ...checkpoint } = await simulateSupport(subset(current, placed), [], floorY, seed, deadline, physicalState, []);
        result.checkpoints.push(checkpoint);
        const closure = contactsClosed(settled);
        if (checkpoint.status !== "pass" || closure.status !== "pass") {
          failures.push(`Seed ${seed}: ${checkpoint.status !== "pass" ? checkpoint.detail : closure.detail}`); continue;
        }
        current = mergePoses(current, settled);
        physicalState = state;
      }
      states.set(seed, { build: subset(current, placed), floorY, state: physicalState });
    }
    result.status = failures.length ? "fail" : "pass";
    result.detail = failures.join(" ") || "All operations passed with three perturbation seeds, at most two panel grips and mandatory free checkpoints. Fingertip-proxy simulation only; measured human grip and physical magnetic forces remain unverified.";
    if (!failures.length) prepared.set(stage.id, states);
  }
  return results;
}
