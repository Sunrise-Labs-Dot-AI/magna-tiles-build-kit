import { buildBounds } from "@/lib/engine/build";
import { validateEngineInput } from "@/lib/engine/input";
import { add, cross, dot, normalize, scale, subtract } from "@/lib/engine/math";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal, tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";

export interface InsertionPath {
  id: string;
  movingTileIds: string[];
  fixedTileIds: string[];
  /** Translations from the authored final pose; orientation stays fixed. Last offset must be zero. */
  offsets: Vec3[];
}

export interface InsertionResult {
  id: string;
  status: "pass" | "fail";
  detail: string;
  collision?: { moving: string; obstacle: string; segment: number; fraction: number };
}

function edges(tile: TileInstance): Vec3[] {
  const vertices = tileWorldVertices(tile);
  // A prism also has thickness edges. Their cross-products are necessary SAT axes.
  return [tileNormal(tile), ...vertices.map((p, i) => normalize(subtract(vertices[(i + 1) % vertices.length], p)))];
}

function separatingAxes(a: TileInstance, b: TileInstance): Vec3[] {
  const an = tileNormal(a), bn = tileNormal(b), ae = edges(a), be = edges(b);
  const candidates = [an, bn, ...ae.map(e => cross(e, an)), ...be.map(e => cross(e, bn)),
    ...ae.flatMap(e => be.map(f => cross(e, f)))];
  const result: Vec3[] = [];
  for (const axis of candidates) {
    if (dot(axis, axis) < 1e-16) continue;
    const n = normalize(axis);
    if (!result.some(previous => Math.abs(dot(previous, n)) > 1 - 1e-10)) result.push(n);
  }
  return result;
}

/** Continuous SAT for fixed-orientation convex prisms. Each axis contributes an
 * open time interval in which overlap exceeds the unchanged raw tolerance.
 * Intersecting all intervals detects even collisions between the endpoints.
 */
function sweptCollision(a: TileInstance, b: TileInstance, start: Vec3, end: Vec3): number | null {
  const av = tilePrismVertices(a), bv = tilePrismVertices(b), velocity = subtract(end, start);
  let enter = 0, leave = 1;
  for (const axis of separatingAxes(a, b)) {
    const ap = av.map(p => dot(add(p, start), axis)), bp = bv.map(p => dot(p, axis));
    const low = Math.min(...bp) + RAW_OVERLAP_TOLERANCE - Math.max(...ap);
    const high = Math.max(...bp) - RAW_OVERLAP_TOLERANCE - Math.min(...ap);
    const speed = dot(velocity, axis);
    if (Math.abs(speed) < 1e-12) {
      if (low >= -1e-10 || high <= 1e-10) return null;
    } else {
      const first = low / speed, last = high / speed;
      enter = Math.max(enter, Math.min(first, last));
      leave = Math.min(leave, Math.max(first, last));
      if (leave - enter <= 1e-10) return null;
    }
  }
  return leave - enter > 1e-10 ? (enter + leave) / 2 : null;
}

/** Validates only tile/ground clearance of a supplied translation path. Hand access,
 * stability, subassembly construction and attachment are separate requirements.
 */
export function validateInsertionPath(build: BuildGraph, path: InsertionPath, deadline = Infinity): InsertionResult {
  const fail = (detail: string): InsertionResult => ({ id: path?.id ?? "invalid", status: "fail", detail });
  const errors = validateEngineInput(build);
  if (errors.length) return fail(errors.join("; "));
  if (!path || !Array.isArray(path.movingTileIds) || !Array.isArray(path.fixedTileIds) ||
      !Array.isArray(path.offsets) || !path.movingTileIds.length || path.offsets.length < 2 || path.offsets.length > 64 ||
      path.movingTileIds.length + path.fixedTileIds.length > build.tiles.length)
    return fail("Insertion needs moving parts and 2–64 translation offsets.");
  const ids = [...path.movingTileIds, ...path.fixedTileIds];
  if (new Set(ids).size !== ids.length || ids.some(id => !build.tiles.some(t => t.id === id)))
    return fail("Unknown, duplicated or simultaneously moving/fixed part.");
  if (path.offsets.some(p => !p || ![p.x, p.y, p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000)))
    return fail("Invalid translation offset.");
  if (dot(path.offsets.at(-1)!, path.offsets.at(-1)!) > 1e-12 ||
      path.offsets.every(p => dot(p, p) <= 1e-12))
    return fail("Path must approach the authored pose and end at zero offset.");
  const moving = build.tiles.filter(t => path.movingTileIds.includes(t.id));
  const fixed = build.tiles.filter(t => path.fixedTileIds.includes(t.id));
  const zero = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) {
    if (Date.now() > deadline) throw new SimulationBudgetExceeded();
    if (sweptCollision(moving[i], moving[j], zero, zero) !== null)
      return fail(`Moving module contains intersecting parts: ${moving[i].id}, ${moving[j].id}.`);
  }
  const floor = buildBounds(build.tiles).min.y;
  for (const tile of moving) {
    if (Date.now() > deadline) throw new SimulationBudgetExceeded();
    const minY = Math.min(...tilePrismVertices(tile).map(p => p.y));
    // Linear translation reaches its lowest value at a segment endpoint.
    if (path.offsets.some(offset => minY + offset.y < floor - RAW_OVERLAP_TOLERANCE))
      return fail(`${tile.id} passes through the assembly table.`);
    for (const obstacle of fixed) for (let segment = 0; segment < path.offsets.length - 1; segment++) {
      if (Date.now() > deadline) throw new SimulationBudgetExceeded();
      const fraction = sweptCollision(tile, obstacle, path.offsets[segment], path.offsets[segment + 1]);
      if (fraction !== null) return {
        ...fail(`${tile.id} passes through ${obstacle.id} during insertion.`),
        collision: { moving: tile.id, obstacle: obstacle.id, segment, fraction },
      };
    }
  }
  return { id: path.id, status: "pass", detail: "Continuous translation clears the listed fixed parts and table. Grip, magnetic closure and release are not certified by this check." };
}

/** Deterministic bounded path proposals. All proposed directions are independently
 * checked; no failure is repaired by omitting an obstacle. Rotating insertions are
 * intentionally outside this solver and require a different validated trajectory.
 */
export function findInsertionPath(build: BuildGraph, movingTileIds: string[], fixedTileIds: string[], deadline = Infinity): InsertionPath | null {
  if (validateEngineInput(build).length) return null;
  const bounds = buildBounds(build.tiles), span = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) + 3;
  const directions: Vec3[] = [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  for (const direction of directions) {
    const path = { id: `insert-${movingTileIds.join("+")}`, movingTileIds, fixedTileIds,
      offsets: [scale(direction, span), { x: 0, y: 0, z: 0 }] };
    if (validateInsertionPath(build, path, deadline).status === "pass") return path;
  }
  return null;
}

/** Render the same path the clearance check evaluated. Unplaced parts stay absent. */
export function insertionPreview(build: BuildGraph, path: InsertionPath, progress: number): BuildGraph {
  const clamped = Math.max(0, Math.min(1, progress));
  const t = clamped * (path.offsets.length - 1), segment = Math.min(Math.floor(t), path.offsets.length - 2);
  const offset = add(path.offsets[segment], scale(subtract(path.offsets[segment + 1], path.offsets[segment]), t - segment));
  const present = new Set([...path.fixedTileIds, ...path.movingTileIds]), moving = new Set(path.movingTileIds);
  return {
    ...build,
    tiles: build.tiles.filter(tile => present.has(tile.id)).map(tile => moving.has(tile.id)
      ? { ...tile, position: add(tile.position, offset) } : tile),
    connections: build.connections.filter(c => present.has(c.fromTileId) && present.has(c.toTileId) &&
      (clamped === 1 || moving.has(c.fromTileId) === moving.has(c.toTileId))),
  };
}
