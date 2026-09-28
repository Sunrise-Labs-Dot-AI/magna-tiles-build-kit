import { add, cross, dot, normalize, scale, subtract, transformLocal, magnitude } from "@/lib/engine/math";
import { TILE_THICKNESS } from "@/lib/engine/constants";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import type { Check } from "./types";
import { insertionPathProposals, validateInsertionPath, type InsertionPath } from "./insertion";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { v } from "./geometry";
import { pointMotionBound, tileQuaternion } from "./rotation-clearance";
import { distance, quaternionAngle } from "@/lib/engine/math";

/** Two fingertip spheres pinch one accessible edge. These fixed dimensions are an
 * explicit accessibility proxy, not measured hand size or grip-force validation. */
export const GRIP_PROXY = { id: "edge-pinch-v1", radius: 0.22, approachLength: 1.5 } as const;
export interface HandContact {
  tileId: string;
  localPoint: Vec3;
  localOutward: Vec3;
  proxy: typeof GRIP_PROXY.id;
  /** Tile-local offsets from the final pinch, ending at zero. */
  approachOffsets?: Vec3[];
}

/** Exact physical grip identity, independent of property order or an omitted
 * default approach. Regrasping the same panel is a separate operation. */
export function sameHandContact(a: HandContact, b: HandContact): boolean {
  const sameVector = (p?: Vec3, q?: Vec3) => !!p && !!q &&
    (["x","y","z"] as const).every(k => Number.isFinite(p[k]) && p[k] === q[k]);
  if (a.tileId !== b.tileId || a.proxy !== GRIP_PROXY.id || a.proxy !== b.proxy ||
      !sameVector(a.localPoint,b.localPoint) || !sameVector(a.localOutward,b.localOutward)) return false;
  const offsets = (h: HandContact) => h.approachOffsets ?? [scale(h.localOutward,GRIP_PROXY.approachLength),v(0,0,0)];
  const left=offsets(a),right=offsets(b);
  return Array.isArray(left) && Array.isArray(right) && left.length >= 2 && left.length <= 8 &&
    left.length === right.length && left.every((p,i) => sameVector(p,right[i]));
}

export interface HandTransition extends Check {
  previousHands: HandContact[];
  nextHands: HandContact[];
  changed: boolean;
}

/** Acquire new grips while prior hands remain, then withdraw old grips. This
 * changes no body pose or state; the requested final support still needs physics. */
export function checkHandTransition(build: BuildGraph, previousHands: HandContact[], nextHands: HandContact[], floorY: number, deadline = Infinity): HandTransition {
  if (Date.now() > deadline) throw new SimulationBudgetExceeded();
  const changed = previousHands.length !== nextHands.length || previousHands.some(old =>
    !nextHands.some(next => sameHandContact(old,next)));
  const result: HandTransition = { status:"fail",detail:"",changed,
    previousHands:structuredClone(previousHands),nextHands:structuredClone(nextHands) };
  const fail = (detail: string) => ({ ...result,detail });
  if ([previousHands,nextHands].some(hands => hands.length > 2 || new Set(hands.map(h => h.tileId)).size !== hands.length ||
      hands.some(h => !build.tiles.some(t => t.id === h.tileId))))
    return fail("Hand transition needs at most two distinct present panel grips on each side.");
  if (previousHands.some(old => nextHands.some(next => old.tileId === next.tileId && !sameHandContact(old,next))))
    return fail("An existing panel grip changes without an explicit release and regrasp.");
  const union = [...previousHands,...nextHands.filter(next => !previousHands.some(old => old.tileId === next.tileId))];
  if (union.length > 2) return fail("Acquiring this grip needs a third hand; explicitly release a prior grip first.");
  if (!changed) return { ...result,status:"pass",detail:"The existing grip set is unchanged." };
  const moving = union[0].tileId;
  const access = checkHandAccess(build,{ id:"support-hand-transition",movingTileIds:[moving],
    fixedTileIds:build.tiles.filter(t => t.id !== moving).map(t => t.id),offsets:[v(0,0,0),v(0,0,0)] },union,floorY,deadline);
  return { ...result,...access,detail:access.status === "pass"
    ? "Prior-hand withdrawal and new-grip acquisition clear the actual prefix with at most two hands; final support is checked separately."
    : access.detail };
}

// Continuous segment against the prism's inflated half-spaces. Conservative at
// corners: it may reject a feasible sphere path, but cannot skip a thin obstacle.
function blocked(tile: TileInstance, from: Vec3, to: Vec3, radius: number): boolean {
  const vertices = tileWorldVertices(tile), normal = tileNormal(tile);
  // The catalog origin of a right triangle lies on its hypotenuse. It cannot
  // orient an interior half-space: rounding can flip the collision boundary.
  const center = scale(vertices.reduce(add,v(0,0,0)),1/vertices.length);
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
  const offsets = hand.approachOffsets ?? [scale(hand.localOutward,GRIP_PROXY.approachLength),v(0,0,0)];
  if (offsets.length < 2 || offsets.length > 8 || offsets.some(p => !p || ![p.x,p.y,p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 6)) ||
    magnitude(offsets.at(-1)!) > 1e-6 || magnitude(offsets[0]) < GRIP_PROXY.approachLength ||
    offsets.slice(1).reduce((sum,p,i) => sum+distance(p,offsets[i]),0) > 12) return null;
  const basis = tile.basis ?? basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z);
  const point = transformLocal(hand.localPoint, tile.position, basis);
  const outward = transformLocal(hand.localOutward, v(0, 0, 0), basis);
  return { outward, approach: offsets.map(p => transformLocal(p,v(0,0,0),basis)), fingers: [-1, 1].map(sign => add(point, scale(basis.zAxis, sign * (TILE_THICKNESS / 2 + GRIP_PROXY.radius)))) };
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

/** Search the same bounded directions until solids and fingertips both clear. */
export function findHandInsertionPath(build: BuildGraph, movingTileIds: string[], fixedTileIds: string[], hands: HandContact[], floorY: number, deadline = Infinity): InsertionPath | null {
  for (const path of insertionPathProposals(build,movingTileIds,fixedTileIds)) {
    if (Date.now() > deadline) throw new SimulationBudgetExceeded();
    if (validateInsertionPath(build,path,deadline,floorY).status === "pass" &&
        checkHandAccess(build,path,hands,floorY,deadline).status === "pass") return path;
  }
  return null;
}

export function checkHandAccess(build: BuildGraph, path: InsertionPath, hands: HandContact[], floorY: number, deadline = Infinity): Check {
  const checkBudget=()=>{if(Date.now()>deadline)throw new SimulationBudgetExceeded();};
  checkBudget();
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
      checkBudget();
      // Check acquiring and withdrawing each grip at start and closure, then carry
      // the moving grip through every continuous insertion segment.
      const translations = moving ? path.offsets : [v(0, 0, 0)];
      const segments: [Vec3, Vec3][] = translations.flatMap(offset => {
        const end = add(finger, offset);
        return geometry!.approach.slice(1).map((p,i) => [add(end,geometry!.approach[i]),add(end,p)] as [Vec3,Vec3]);
      });
      const acquisition = geometry!.approach.slice(1).map((p,i) => [add(finger,geometry!.approach[i]),add(finger,p)] as [Vec3,Vec3]);
      const own = build.tiles.find(t => t.id === hand.tileId)!;
      if (acquisition.some(([a,b]) => blocked(own,a,b,GRIP_PROXY.radius))) return fail(`Grip approach crosses its own panel ${hand.tileId}.`);
      if (moving) for (let i = 1; i < path.offsets.length; i++) segments.push([add(finger, path.offsets[i - 1]), add(finger, path.offsets[i])]);
      for (const [from, to] of segments) {
        checkBudget();
        if (Math.min(from.y, to.y) - GRIP_PROXY.radius < floorY - 1e-6) return fail(`Grip on ${hand.tileId} crosses the table.`);
        for (const tile of build.tiles.filter(t => path.fixedTileIds.includes(t.id) && t.id !== hand.tileId)) {
          checkBudget();
          if (blocked(tile, from, to, GRIP_PROXY.radius)) return fail(`Grip on ${hand.tileId} is blocked by ${tile.id}.`);
        }
      }
      for (const tile of build.tiles.filter(t => path.movingTileIds.includes(t.id) && t.id !== hand.tileId)) {
        checkBudget();
        if (moving) {
          if (acquisition.some(([a,b]) => blocked(tile,a,b,GRIP_PROXY.radius)))
            return fail(`Grip on ${hand.tileId} is blocked by moving module panel ${tile.id}.`);
        } else {
          for (let i = 1; i < path.offsets.length; i++) {
            checkBudget();
            if (blocked(tile, subtract(finger, path.offsets[i - 1]), subtract(finger, path.offsets[i]), GRIP_PROXY.radius))
              return fail(`Inserted ${tile.id} collides with the support hand.`);
          }
          // The support hand must be removable after closure.
          if (acquisition.some(([a,b]) => blocked(tile,a,b,GRIP_PROXY.radius)))
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
        checkBudget();
        const start = add(a, path.offsets[i - 1]), d = subtract(path.offsets[i], path.offsets[i - 1]);
        const t = dot(d, d) ? Math.max(0, Math.min(1, dot(subtract(b, start), d) / dot(d, d))) : 0;
        if (Math.hypot(...Object.values(subtract(add(start, scale(d, t)), b))) < 2 * GRIP_PROXY.radius)
          return fail("The insertion and support fingertips collide.");
      }
    // Either hand must be able to approach/withdraw while the other stays put.
    for (const offset of [path.offsets[0],path.offsets.at(-1)!]) for (const g of geometries) {
      const other = geometries.find(h => h !== g)!;
      for (const a of g.geometry!.fingers) for (const b of other.geometry!.fingers) for (let i = 1; i < g.geometry!.approach.length; i++) {
        checkBudget();
        const from = add(add(a,g.moving ? offset : v(0,0,0)),g.geometry!.approach[i-1]);
        const target = add(b,other.moving ? offset : v(0,0,0));
        const d = subtract(g.geometry!.approach[i],g.geometry!.approach[i-1]);
        const t = dot(d,d) ? Math.max(0,Math.min(1,dot(subtract(target,from),d)/dot(d,d))) : 0;
        if (distance(add(from,scale(d,t)),target) < 2*GRIP_PROXY.radius) return fail("A grip approach collides with the other hand.");
      }
    }
  }
  return { status: "pass", detail: "Two-finger edge proxies clear the table, all present panels and each other. Palm, force and human dexterity remain uncalibrated." };
}

/** A supporting fingertip remains an obstacle while the released part falls.
 * Unlike insertion access, no moving hand remains attached to that part. */
export function checkSupportFingerClearance(build: BuildGraph, hands: HandContact[], floorY: number, previous?: BuildGraph): Check {
  for (const hand of hands) {
    const tile = build.tiles.find(t => t.id === hand.tileId), geometry = tile && contactGeometry(tile, hand);
    if (!geometry) return { status: "fail", detail: "Invalid stationary support grip." };
    for (const finger of geometry.fingers) {
      if (finger.y - GRIP_PROXY.radius < floorY - 1e-6)
        return { status: "fail", detail: "Support fingertip crosses the table during seating." };
      if (build.tiles.some(t => {
        if (t.id === hand.tileId) return false;
        const before = previous?.tiles.find(p => p.id === t.id);
        let sweep = 0;
        if (before) {
          const a = before.basis ?? basisFromEuler(before.rotation.x, before.rotation.y, before.rotation.z);
          const b = t.basis ?? basisFromEuler(t.rotation.x, t.rotation.y, t.rotation.z);
          const angle = Math.acos(Math.max(-1, Math.min(1, (dot(a.xAxis,b.xAxis) + dot(a.yAxis,b.yAxis) + dot(a.zAxis,b.zAxis) - 1) / 2)));
          const radius = Math.max(...tileWorldVertices(t).map(p => magnitude(subtract(p, t.position)))) + TILE_THICKNESS / 2;
          // Every point of the interpolated rigid step is within this bound of
          // the endpoint prism. Inflation catches crossings between snapshots.
          sweep = magnitude(subtract(t.position, before.position)) + radius * angle;
        }
        return blocked(t, finger, finger, GRIP_PROXY.radius + sweep);
      }))
        return { status: "fail", detail: "A falling panel strikes a support fingertip." };
    }
  }
  return { status: "pass", detail: "Supporting fingertips remain clear." };
}

/** Both gripped panels may move. Bound fingertip arcs and obstacle motion, then
 * check the entire relative segment, including the two hands against each other. */
export function checkMotionFingerClearance(before: BuildGraph, after: BuildGraph, hands: HandContact[], floorY: number): Check {
  const fail = (detail: string): Check => ({ status: "fail", detail });
  const paths: { hand: HandContact; start: Vec3; end: Vec3; arc: number }[] = [];
  for (const hand of hands) {
    const a = before.tiles.find(t => t.id === hand.tileId), b = after.tiles.find(t => t.id === hand.tileId);
    const ag = a && contactGeometry(a, hand), bg = b && contactGeometry(b, hand);
    if (!a || !b || !ag || !bg) return fail("Invalid moving grip.");
    const angle = quaternionAngle(tileQuaternion(a), tileQuaternion(b));
    for (const [i, start] of ag.fingers.entries()) {
      const end = bg.fingers[i];
      // Sagitta of the circular arc relative to its endpoint chord.
      const arc = distance(start, a.position) * (1 - Math.cos(angle / 2));
      if (Math.min(start.y, end.y) - arc - GRIP_PROXY.radius < floorY - 1e-6) return fail("Moving fingertip crosses the fixed table.");
      for (const obstacle of after.tiles) {
        if (obstacle.id === hand.tileId) continue;
        const previous = before.tiles.find(t => t.id === obstacle.id);
        if (!previous) return fail("A present obstacle is missing its previous pose.");
        if (blocked(obstacle, start, end, GRIP_PROXY.radius + arc + pointMotionBound(previous, obstacle))) return fail(`Moving grip on ${hand.tileId} hits ${obstacle.id}.`);
      }
      paths.push({ hand, start, end, arc });
    }
  }
  for (let i = 0; i < paths.length; i++) for (let j = 0; j < i; j++) {
    const a = paths[i], b = paths[j];
    if (a.hand.tileId === b.hand.tileId) continue;
    const start = subtract(a.start, b.start), d = subtract(subtract(a.end, b.end), start);
    const t = dot(d,d) ? Math.max(0, Math.min(1, -dot(start,d)/dot(d,d))) : 0;
    if (magnitude(add(start, scale(d,t))) < 2*GRIP_PROXY.radius + a.arc + b.arc) return fail("Moving fingertip proxies collide.");
  }
  return { status: "pass", detail: "Swept fingertip proxies remain clear." };
}
