import { add, cross, dot, normalize, scale, subtract, transformLocal } from "@/lib/engine/math";
import { TILE_THICKNESS } from "@/lib/engine/constants";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import type { Check } from "./types";
import type { InsertionPath } from "./insertion";
import { v } from "./geometry";

/** Two fingertip spheres pinch one accessible edge. These fixed dimensions are an
 * explicit accessibility proxy, not measured hand size or grip-force validation. */
export const GRIP_PROXY = { id: "edge-pinch-v1", radius: 0.22, approachLength: 1.5 } as const;
export interface HandContact {
  tileId: string;
  localPoint: Vec3;
  localOutward: Vec3;
  proxy: typeof GRIP_PROXY.id;
}

// Continuous segment against the prism's inflated half-spaces. Conservative at
// corners: it may reject a feasible sphere path, but cannot skip a thin obstacle.
function blocked(tile: TileInstance, from: Vec3, to: Vec3, radius: number): boolean {
  const vertices = tileWorldVertices(tile), normal = tileNormal(tile), center = tile.position;
  const planes = [{ n: normal, p: add(center, scale(normal, TILE_THICKNESS / 2)) },
    { n: scale(normal, -1), p: add(center, scale(normal, -TILE_THICKNESS / 2)) }];
  for (let i = 0; i < vertices.length; i++) {
    let n = normalize(cross(subtract(vertices[(i + 1) % vertices.length], vertices[i]), normal));
    if (dot(subtract(center, vertices[i]), n) > 0) n = scale(n, -1);
    planes.push({ n, p: vertices[i] });
  }
  let lo = 0, hi = 1;
  for (const { n, p } of planes) {
    const a = dot(subtract(from, p), n) - radius + 1e-7, b = dot(subtract(to, from), n);
    if (Math.abs(b) < 1e-12) { if (a >= 0) return false; }
    else if (b > 0) hi = Math.min(hi, -a / b);
    else lo = Math.max(lo, -a / b);
    if (lo > hi) return false;
  }
  return lo <= hi;
}

function contactGeometry(tile: TileInstance, hand: HandContact) {
  if (hand.proxy !== GRIP_PROXY.id || !hand.localPoint || !hand.localOutward ||
      ![...Object.values(hand.localPoint), ...Object.values(hand.localOutward)].every(Number.isFinite) ||
      Math.abs(hand.localPoint.z) > 1e-6 || Math.abs(hand.localOutward.z) > 1e-6 ||
      Math.abs(dot(hand.localOutward, hand.localOutward) - 1) > 1e-6) return null;
  const vertices = tileLocalVertices(tile.shape);
  let onEdge = false;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], d = subtract(vertices[(i + 1) % vertices.length], a);
    const t = dot(subtract(hand.localPoint, a), d) / dot(d, d);
    const closest = add(a, scale(d, t));
    const normal = normalize(v(d.y, -d.x, 0));
    if (t >= 0.15 && t <= 0.85 && Math.hypot(...Object.values(subtract(closest, hand.localPoint))) < 1e-5 &&
        dot(normal, hand.localOutward) > 0.99) onEdge = true;
  }
  if (!onEdge) return null;
  const basis = tile.basis ?? basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z);
  const point = transformLocal(hand.localPoint, tile.position, basis);
  const outward = transformLocal(hand.localOutward, v(0, 0, 0), basis);
  return { outward, fingers: [-1, 1].map(sign => add(point, scale(basis.zAxis, sign * (TILE_THICKNESS / 2 + GRIP_PROXY.radius)))) };
}

export function edgeGrips(tile: TileInstance): HandContact[] {
  const vertices = tileLocalVertices(tile.shape);
  return vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length], d = subtract(b, a);
    return { tileId: tile.id, localPoint: scale(add(a, b), 0.5), localOutward: normalize(v(d.y, -d.x, 0)), proxy: GRIP_PROXY.id };
  });
}

/** Bounded proposals only; acceptance always reruns on actual settled geometry. */
export function findHandContacts(build: BuildGraph, path: InsertionPath, movingPanel: string, supportPanel: string | undefined, floorY: number): HandContact[] | null {
  const moving = build.tiles.find(t => t.id === movingPanel), support = build.tiles.find(t => t.id === supportPanel);
  if (!moving || (supportPanel && !support)) return null;
  for (const grip of edgeGrips(moving)) for (const hold of support ? edgeGrips(support) : [undefined]) {
    const hands = hold ? [grip, hold] : [grip];
    if (checkHandAccess(build, path, hands, floorY).status === "pass") return hands;
  }
  return null;
}

export function checkHandAccess(build: BuildGraph, path: InsertionPath, hands: HandContact[], floorY: number): Check {
  const fail = (detail: string): Check => ({ status: "fail", detail });
  const present = new Set([...path.movingTileIds, ...path.fixedTileIds]);
  if (!Array.isArray(hands) || !hands.length || hands.length > 2 || new Set(hands.map(h => h.tileId)).size !== hands.length ||
      hands.some(h => !present.has(h.tileId)) || hands.filter(h => path.movingTileIds.includes(h.tileId)).length !== 1)
    return fail("Need one insertion hand and at most one distinct support hand, each holding one present panel.");
  const geometries = hands.map(h => {
    const tile = build.tiles.find(t => t.id === h.tileId)!;
    return { hand: h, geometry: contactGeometry(tile, h), moving: path.movingTileIds.includes(h.tileId) };
  });
  if (geometries.some(g => !g.geometry)) return fail("Grip must pinch an actual edge with the fixed proxy and an outward approach.");
  for (const { hand, geometry, moving } of geometries) {
    for (const finger of geometry!.fingers) {
      // Check acquiring and withdrawing each grip at start and closure, then carry
      // the moving grip through every continuous insertion segment.
      const translations = moving ? path.offsets : [v(0, 0, 0)];
      const segments: [Vec3, Vec3][] = translations.flatMap(offset => {
        const end = add(finger, offset);
        return [[add(end, scale(geometry!.outward, GRIP_PROXY.approachLength)), end] as [Vec3, Vec3]];
      });
      if (moving) for (let i = 1; i < path.offsets.length; i++) segments.push([add(finger, path.offsets[i - 1]), add(finger, path.offsets[i])]);
      for (const [from, to] of segments) {
        if (Math.min(from.y, to.y) - GRIP_PROXY.radius < floorY - 1e-6) return fail(`Grip on ${hand.tileId} crosses the table.`);
        for (const tile of build.tiles.filter(t => path.fixedTileIds.includes(t.id) && t.id !== hand.tileId))
          if (blocked(tile, from, to, GRIP_PROXY.radius)) return fail(`Grip on ${hand.tileId} is blocked by ${tile.id}.`);
      }
      for (const tile of build.tiles.filter(t => path.movingTileIds.includes(t.id) && t.id !== hand.tileId)) {
        if (moving) {
          if (blocked(tile, add(finger, scale(geometry!.outward, GRIP_PROXY.approachLength)), finger, GRIP_PROXY.radius))
            return fail(`Grip on ${hand.tileId} is blocked by moving module panel ${tile.id}.`);
        } else {
          for (let i = 1; i < path.offsets.length; i++)
            if (blocked(tile, subtract(finger, path.offsets[i - 1]), subtract(finger, path.offsets[i]), GRIP_PROXY.radius))
              return fail(`Inserted ${tile.id} collides with the support hand.`);
          // The support hand must be removable after closure.
          if (blocked(tile, finger, add(finger, scale(geometry!.outward, GRIP_PROXY.approachLength)), GRIP_PROXY.radius))
            return fail(`Support grip on ${hand.tileId} is trapped after closure.`);
        }
      }
    }
  }
  // Two proxies must not occupy the same space while one is translated.
  if (geometries.length === 2) {
    const moving = geometries.find(g => g.moving)!, fixed = geometries.find(g => !g.moving)!;
    for (const a of moving.geometry!.fingers) for (const b of fixed.geometry!.fingers)
      for (let i = 1; i < path.offsets.length; i++) {
        const start = add(a, path.offsets[i - 1]), d = subtract(path.offsets[i], path.offsets[i - 1]);
        const t = dot(d, d) ? Math.max(0, Math.min(1, dot(subtract(b, start), d) / dot(d, d))) : 0;
        if (Math.hypot(...Object.values(subtract(add(start, scale(d, t)), b))) < 2 * GRIP_PROXY.radius)
          return fail("The insertion and support fingertips collide.");
      }
  }
  return { status: "pass", detail: "Two-finger edge proxies clear the table, all present panels and each other. Palm, force and human dexterity remain uncalibrated." };
}
