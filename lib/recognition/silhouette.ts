import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { referenceSilhouetteMask } from "@/lib/recognition/jet-reference-model";

/**
 * Geometric multi-view silhouette match (the un-gameable half of recognizability).
 *
 * The structural scorer (score.ts) rewards having parts labelled nose/wings/tail with a wide-enough
 * bounding box - which an optimizer can satisfy with 1-2 token tiles (a box with triangles glued on).
 * This module measures whether the tiles ACTUALLY FILL the shape of the target from three
 * orthographic views. It is computed directly from tile geometry (no rendering), so it is fast
 * enough to optimize against, and it cannot be gamed: token triangles cannot cover the wide wing
 * region, and a plain box over-fills the corners where wings/taper should be empty.
 *
 * Views (build axes): top = (x,z) plan, side = (x,y) profile, front = (z,y) head-on.
 * Each view is normalized to the build's bounding box on its two axes (pose/scale invariant), then
 * compared by IoU against the target silhouette projected from the 3D RECONSTRUCTION of the jet
 * (jet-reference-model.ts), which was built directly from the source video frames.
 */

export type SilhouetteView = "top" | "side" | "front";

const GRID = 24;

interface ViewAxes {
  a: (v: Vec3) => number; // horizontal (u)
  b: (v: Vec3) => number; // vertical (v)
}

const VIEW_AXES: Record<SilhouetteView, ViewAxes> = {
  top: { a: (v) => v.x, b: (v) => v.z },
  side: { a: (v) => v.x, b: (v) => v.y },
  front: { a: (v) => v.z, b: (v) => v.y }
};

function pointInConvexPolygon(px: number, py: number, poly: Array<{ x: number; y: number }>): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const c = poly[i];
    const d = poly[(i + 1) % poly.length];
    const cross = (d.x - c.x) * (py - c.y) - (d.y - c.y) * (px - c.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Rasterize the build's tiles into a normalized GRID x GRID occupancy mask for a view. */
export function projectSilhouette(graph: BuildGraph, view: SilhouetteView, grid = GRID): Uint8Array {
  const axes = VIEW_AXES[view];
  const tiles = graph.tiles;
  const polys: Array<Array<{ x: number; y: number }>> = [];
  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (const tile of tiles) {
    const verts = tileWorldVertices(tile as TileInstance);
    const poly = verts.map((v) => ({ x: axes.a(v), y: axes.b(v) }));
    polys.push(poly);
    for (const p of poly) {
      if (p.x < aMin) aMin = p.x;
      if (p.x > aMax) aMax = p.x;
      if (p.y < bMin) bMin = p.y;
      if (p.y > bMax) bMax = p.y;
    }
  }
  const mask = new Uint8Array(grid * grid);
  const aSpan = aMax - aMin || 1;
  const bSpan = bMax - bMin || 1;
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const px = aMin + ((i + 0.5) / grid) * aSpan;
      const py = bMin + ((j + 0.5) / grid) * bSpan;
      for (const poly of polys) {
        if (pointInConvexPolygon(px, py, poly)) {
          mask[j * grid + i] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let k = 0; k < a.length; k += 1) {
    const x = a[k];
    const y = b[k];
    if (x || y) union += 1;
    if (x && y) inter += 1;
  }
  return union === 0 ? 0 : inter / union;
}

/** IoU allowing a horizontal flip of the build mask (nose may be at either end of the u axis). */
function iouFlipInvariant(buildMask: Uint8Array, targetMask: Uint8Array, grid = GRID): number {
  const flipped = new Uint8Array(grid * grid);
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      flipped[j * grid + (grid - 1 - i)] = buildMask[j * grid + i];
    }
  }
  return Math.max(iou(buildMask, targetMask), iou(flipped, targetMask));
}

const VIEWS: SilhouetteView[] = ["top", "side", "front"];

// Target masks now come from the 3D RECONSTRUCTION of the jet (jet-reference-model.ts), projected to
// each view, instead of the earlier hand-drawn predicates. This gives a far more realistic target
// silhouette (proper swept-wing dart, nose cone, tail). Cached per grid size.
const targetMaskCache = new Map<string, Uint8Array>();
function jetTargetMask(view: SilhouetteView, grid: number): Uint8Array {
  const key = `${view}:${grid}`;
  let mask = targetMaskCache.get(key);
  if (!mask) {
    mask = referenceSilhouetteMask(view, grid);
    targetMaskCache.set(key, mask);
  }
  return mask;
}

export interface SilhouetteScore {
  total: number; // mean IoU across views, 0..1
  perView: Record<SilhouetteView, number>;
}

/** Mean flip-invariant silhouette IoU of a build against the reconstructed jet, across three views. */
export function jetSilhouetteMatch(graph: BuildGraph, grid = GRID): SilhouetteScore {
  const perView = {} as Record<SilhouetteView, number>;
  let sum = 0;
  for (const view of VIEWS) {
    const buildMask = projectSilhouette(graph, view, grid);
    const targetMask = jetTargetMask(view, grid);
    const score = iouFlipInvariant(buildMask, targetMask, grid);
    perView[view] = score;
    sum += score;
  }
  return { total: sum / VIEWS.length, perView };
}
