import { buildBounds, validateMagneticBuild } from "@/lib/engine/build";
import { add, scale, dot, subtract, magnitude } from "@/lib/engine/math";
import { TILE_THICKNESS } from "@/lib/engine/constants";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import { stageBuild } from "./geometry";
import { planConstructionPaths } from "./construction";
import { findInsertionPath, type InsertionPath } from "./insertion";
import { checkHandAccess } from "./grip";
import { simulateSupport, type SupportTrial } from "./support";
import type { Check, Replica } from "./types";

export interface AssemblyOperationResult extends Check {
  index: number;
  seed: number;
  tileIds: string[];
  path?: InsertionPath;
  grip?: Check;
  closure?: Check;
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

function contactsClosed(build: BuildGraph): Check {
  const validation = validateMagneticBuild(build);
  if (validation.rejectedReasons.length || findRawOverlaps(build.tiles).length)
    return { status: "fail", detail: `Contact closure rejected: ${validation.rejectedReasons.join("; ") || "intersecting solid parts"}.` };
  // The legacy magnetic search allows distant near-matches. A closure certificate
  // additionally requires actual finite-thickness edge proximity and alignment.
  for (const c of validation.validConnections) {
    const a = c.fromEdge, b = c.toEdge, delta = subtract(b.midpoint, a.midpoint);
    const gap = magnitude(subtract(delta, scale(a.direction, dot(delta, a.direction))));
    const aa = [a.start, a.end].map(p => dot(p, a.direction)), bb = [b.start, b.end].map(p => dot(p, a.direction));
    const overlap = Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb));
    if (gap > TILE_THICKNESS + 0.03 || Math.abs(dot(a.direction, b.direction)) < Math.cos(Math.PI / 36) || overlap < Math.min(a.length, b.length) - 0.21)
      return { status: "fail", detail: `Edges do not close at ${c.id}: transverse gap ${gap.toFixed(3)} in, overlap ${overlap.toFixed(3)} in.` };
  }
  return { status: "pass", detail: "Solid edge gaps, overlap and orientation close." };
}

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
    if (stage.transform || dependencies.some(id => replica.stages.find(s => s.id === id)?.transform)) {
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
        let path = findInsertionPath(current, operation.tileIds, [...placed], deadline);
        if (!path) { failure = row.detail = "Settled predecessors block insertion."; break; }
        row.path = path;
        row.grip = checkHandAccess(current, path, hands, floorY);
        if (row.grip.status !== "pass") { failure = row.detail = row.grip.detail; break; }
        // Carry the prepared module away from floor support, holding only its named panel.
        const airborne = subset(current, moving);
        airborne.tiles = airborne.tiles.map(t => ({ ...t, position: add(t.position, path!.offsets[0]) }));
        const held = hands.filter(h => moving.has(h.tileId)).map(h => h.tileId);
        const carried = await record(airborne, held);
        if (failure) { row.detail = failure; break; }
        carried.tiles = carried.tiles.map(t => ({ ...t, position: add(t.position, scale(path!.offsets[0], -1)) }));
        current = mergePoses(current, carried);
        // Actual carried shape may move; search and check again rather than reset it.
        path = findInsertionPath(current, operation.tileIds, [...placed], deadline);
        if (!path) { failure = row.detail = "Carried module deformation blocks insertion."; break; }
        row.path = path;
        row.grip = checkHandAccess(current, path, hands, floorY);
        row.closure = checkClosure(current, path);
        if (row.grip.status !== "pass" || row.closure.status !== "pass") {
          failure = row.detail = row.grip.status !== "pass" ? row.grip.detail : row.closure.detail; break;
        }
        moving.forEach(id => placed.add(id));
        current = mergePoses(current, await record(subset(current, placed), hands.map(h => h.tileId)));
        if (!failure && operation.releaseAfter)
          current = mergePoses(current, await record(subset(current, placed), []));
        if (failure) { row.detail = failure; break; }
        row.status = "pass";
        row.detail = "Clear grip and insertion, connected closure and stable supported prefix; actual settled poses retained.";
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
