/** Frozen pre-optimization swept-clearance oracle. Do not refactor with production.
 * rotation-clearance.ts SHA-256: 4c7be22a54ccc088a44476b0960b21db16345bafed8ad7242ad1c37c3480f74b
 * insertion.ts SHA-256: 5d12c91556940d6065eb3f0d2be6ed66522647792854d58438534239202e6519
 * Original algorithm and axis helper copied verbatim; imports only are rewired. */
import { add, basisToQuaternion, cross, distance, dot, normalize, quaternionAngle, quaternionToBasis, scale, slerp, subtract } from "@/lib/engine/math";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileNormal, tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { Check } from "@/lib/replication/types";

export const tileQuaternion = (t: TileInstance) => basisToQuaternion(t.basis ?? basisFromEuler(t.rotation.x, t.rotation.y, t.rotation.z));
export function interpolateTile(a: TileInstance, b: TileInstance, t: number): TileInstance {
  return { ...a, position: add(scale(a.position, 1-t), scale(b.position, t)), basis: quaternionToBasis(slerp(tileQuaternion(a), tileQuaternion(b), t)) };
}
export function pointMotionBound(a: TileInstance, b: TileInstance): number {
  const radius = Math.max(...tilePrismVertices(a).map(p => distance(p, a.position)));
  return distance(a.position, b.position) + radius * quaternionAngle(tileQuaternion(a), tileQuaternion(b));
}

export function samePoses(a: BuildGraph, b: BuildGraph): boolean {
  return a.tiles.length === b.tiles.length && a.tiles.every((t,i) => {
    const other = b.tiles[i];
    return t.id === other.id && t.shape === other.shape && distance(t.position,other.position) === 0 &&
      JSON.stringify(t.basis ?? t.rotation) === JSON.stringify(other.basis ?? other.rotation);
  });
}

/** Conservative certification of every interpolated pose, including rotations.
 * A midpoint separating axis is safe only if its gap exceeds the maximum motion
 * of all vertices in the interval. Ambiguous intervals subdivide, never pass by
 * endpoint sampling. Includes dynamic/dynamic pairs and the fixed table. */
export function checkSweptPoses(before: BuildGraph, after: BuildGraph, floorY: number, deadline = Infinity): Check {
  const fail = (detail: string): Check => ({ status: "fail", detail });
  if (!Number.isFinite(floorY) || before.tiles.length !== after.tiles.length ||
    before.tiles.some(t => !after.tiles.some(b => b.id === t.id && b.shape === t.shape))) return fail("Motion changes the set of present solids.");
  const ends = before.tiles.map(t => after.tiles.find(b => b.id === t.id)!);
  const recurse = (starts: TileInstance[], stops: TileInstance[], depth: number): string | null => {
    if (Date.now() > deadline) throw new SimulationBudgetExceeded();
    const middle = starts.map((t, i) => interpolateTile(t, stops[i], .5));
    const bounds = starts.map((t, i) => pointMotionBound(t, stops[i]) / 2);
    const vertices = middle.map(t => tilePrismVertices(t));
    let uncertain = false;
    for (let i = 0; i < middle.length; i++) {
      const minY = Math.min(...vertices[i].map(p => p.y));
      if (minY < floorY - RAW_OVERLAP_TOLERANCE) return `${middle[i].id} intersects the fixed table during rotation/translation.`;
      if (minY - bounds[i] < floorY - RAW_OVERLAP_TOLERANCE) uncertain = true;
      for (let j = 0; j < i; j++) {
        const gap = Math.max(...separatingAxes(middle[i], middle[j]).map(axis => {
          const a = vertices[i].map(p => dot(p, axis)), b = vertices[j].map(p => dot(p, axis));
          return Math.max(Math.min(...a)-Math.max(...b), Math.min(...b)-Math.max(...a));
        }));
        if (gap < -RAW_OVERLAP_TOLERANCE - 1e-9) return `${middle[i].id} intersects ${middle[j].id} during rotation/translation.`;
        if (gap - bounds[i] - bounds[j] < -RAW_OVERLAP_TOLERANCE) uncertain = true;
      }
    }
    if (!uncertain) return null;
    if (depth === 12) return "Swept clearance cannot be certified within the subdivision budget.";
    return recurse(starts, middle, depth+1) ?? recurse(middle, stops, depth+1);
  };
  // The bound covers the closed interval, including both endpoints. Any interval
  // containing an endpoint collision cannot receive a clearance certificate.
  const error = recurse(before.tiles, ends, 0);
  return error ? fail(error) : { status: "pass", detail: "Conservative swept prisms clear every present solid and the fixed table." };
}

function edges(tile: TileInstance): Vec3[] {
  const vertices = tileWorldVertices(tile);
  // A prism also has thickness edges. Their cross-products are necessary SAT axes.
  return [tileNormal(tile), ...vertices.map((p, i) => normalize(subtract(vertices[(i + 1) % vertices.length], p)))];
}

export function separatingAxes(a: TileInstance, b: TileInstance): Vec3[] {
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

