import { buildBounds, validateMagneticBuild } from "@/lib/engine/build";
import { add, scale } from "@/lib/engine/math";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import { stageBuild } from "./geometry";
import { planConstructionPaths } from "./construction";
import { findInsertionPath, type InsertionPath } from "./insertion";
import { checkHandAccess } from "./grip";
import { simulateSupport, type SupportTrial } from "./support";
import { contactsClosed } from "./contacts";
import { simulateGravitySeat, type SeatingTrial } from "./seating";
import type { Check, Replica } from "./types";

export interface AssemblyOperationResult extends Check {
  index: number;
  seed: number;
  tileIds: string[];
  path?: InsertionPath;
  approachTiles?: TileInstance[];
  grip?: Check;
  closure?: Check;
  seating?: Omit<SeatingTrial, "settled">;
  trials: Omit<SupportTrial, "settled">[];
}
export interface AssemblyResult extends Check {
  stageId: string;
  operations: AssemblyOperationResult[];
  checkpoints: Omit<SupportTrial, "settled">[];
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

/** Bounded quasi-static assembly: settle every held prefix and carry its actual
 * geometry into the next path/closure. Recreating a rested state does not restore
 * the authored poses. Missing rotational transfers fail closed as unverified. */
export async function evaluateAssembly(replica: Replica, deadline = Infinity): Promise<AssemblyResult[]> {
  const coverage = planConstructionPaths(replica, deadline), results: AssemblyResult[] = [];
  const prepared = new Map<string, Map<number, { build: BuildGraph; floorY: number }>>();
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
    const nominal = stageBuild(replica, stage), floorY = buildBounds(nominal.tiles).min.y;
    const states = new Map<number, { build: BuildGraph; floorY: number }>();
    let failure = "";
    for (const seed of [0, 17, 53]) {
      let current = structuredClone(nominal);
      const placed = new Set<string>();
      for (const id of stage.installedStageIds ?? []) {
        const previous = prepared.get(id)!.get(seed)!;
        const aligned = { ...previous.build, tiles: previous.build.tiles.map(t => ({ ...t,
          position: { ...t.position, y: t.position.y + floorY - previous.floorY } })) };
        current = mergePoses(current, aligned);
        aligned.tiles.forEach(t => placed.add(t.id));
      }
      for (const [index, operation] of plan.operations.entries()) {
        const row: AssemblyOperationResult = { index, seed, tileIds: operation.tileIds, status: "fail", detail: "", trials: [] };
        result.operations.push(row);
        const record = async (build: BuildGraph, holds: string[]) => {
          const trial = await simulateSupport(build, holds, floorY, seed, deadline);
          const { settled, ...summary } = trial;
          row.trials.push(summary);
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
        // Remove the previous insertion hand before using it for another tile.
        if (placed.size) {
          current = mergePoses(current, await record(subset(current, placed), support));
          if (failure) { row.detail = failure; break; }
        }
        if (operation.preparedStageId) current = mergePoses(current, prepared.get(operation.preparedStageId)!.get(seed)!.build);
        const releaseOffset = { x: 0, y: operation.gravitySeat?.releaseHeight ?? 0, z: 0 };
        const approachPose = () => ({ ...current, tiles: current.tiles.map(t => moving.has(t.id)
          ? { ...t, position: add(t.position, releaseOffset) } : t) });
        let approach = approachPose();
        let path = findInsertionPath(approach, operation.tileIds, [...placed], deadline);
        if (!path) { failure = row.detail = "Settled predecessors block insertion."; break; }
        row.path = path;
        row.grip = checkHandAccess(approach, path, hands, floorY);
        if (row.grip.status !== "pass") { failure = row.detail = row.grip.detail; break; }
        // Carry the prepared module away from floor support, holding only its named panel.
        const airborne = subset(approach, moving);
        airborne.tiles = airborne.tiles.map(t => ({ ...t, position: add(t.position, path!.offsets[0]) }));
        const held = hands.filter(h => moving.has(h.tileId)).map(h => h.tileId);
        const carried = await record(airborne, held);
        if (failure) { row.detail = failure; break; }
        carried.tiles = carried.tiles.map(t => ({ ...t, position: add(t.position, scale(add(path!.offsets[0], releaseOffset), -1)) }));
        current = mergePoses(current, carried);
        // Actual carried shape may move; search and check again rather than reset it.
        approach = approachPose();
        path = findInsertionPath(approach, operation.tileIds, [...placed], deadline);
        if (!path) { failure = row.detail = "Carried module deformation blocks insertion."; break; }
        row.path = path;
        row.grip = checkHandAccess(approach, path, hands, floorY);
        row.approachTiles = approach.tiles.filter(t => moving.has(t.id) || placed.has(t.id));
        if (row.grip.status !== "pass") { failure = row.detail = row.grip.detail; break; }
        if (operation.gravitySeat) {
          const seated = await simulateGravitySeat(subset(current, new Set([...placed, ...moving])), operation.tileIds, hands,
            operation.gravitySeat.releaseHeight, floorY, seed, deadline);
          const { settled, ...summary } = seated;
          row.seating = summary;
          if (seated.path) row.path = seated.path;
          if (seated.motion.length) row.approachTiles = seated.motion[0].tiles;
          row.closure = { status: seated.status, detail: seated.detail };
          if (seated.status !== "pass") { failure = row.detail = seated.detail; break; }
          current = mergePoses(current, settled);
        } else {
          row.closure = checkClosure(current, path);
          if (row.closure.status !== "pass") { failure = row.detail = row.closure.detail; break; }
        }
        moving.forEach(id => placed.add(id));
        current = mergePoses(current, await record(subset(current, placed), operation.gravitySeat ? support : hands.map(h => h.tileId)));
        if (!failure && operation.releaseAfter)
          current = mergePoses(current, await record(subset(current, placed), []));
        if (failure) { row.detail = failure; break; }
        row.status = "pass";
        row.detail = operation.gravitySeat ? "Clear release grip, gravity-seated contacts and stable connected prefix; actual motion retained."
          : "Clear grip and insertion, connected closure and stable supported prefix; actual settled poses retained.";
      }
      if (failure) break;
      // Includes release-only checkpoints which add no new parts. Reusing a held
      // module must never skip its first unsupported release.
      if (stage.support === "released") {
        const { settled, ...checkpoint } = await simulateSupport(subset(current, placed), [], floorY, seed, deadline);
        result.checkpoints.push(checkpoint);
        const closure = contactsClosed(settled);
        if (checkpoint.status !== "pass" || closure.status !== "pass") {
          failure = checkpoint.status !== "pass" ? checkpoint.detail : closure.detail; break;
        }
        current = mergePoses(current, settled);
      }
      states.set(seed, { build: subset(current, placed), floorY });
    }
    result.status = failure ? "fail" : "pass";
    result.detail = failure || "All operations passed with three perturbation seeds, at most two panel grips and mandatory free checkpoints. Quasi-static fingertip-proxy simulation only; measured human grip and physical magnetic forces remain unverified.";
    if (!failure) prepared.set(stage.id, states);
  }
  return results;
}
