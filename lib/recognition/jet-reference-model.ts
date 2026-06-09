/**
 * A raw 3D reconstruction of the jet from the source video frames (NOT built via the Magnatiles
 * macro/fold system). Each tile is a polygon placed directly in world space, scaled by real tile
 * dimensions (SMALL_EDGE = 3). Reconstructed from 03/05/07/09/11/12/13 frames:
 * a 4-segment square-tube fuselage, a forward nose point, wide swept wings, a rear tail
 * (h-stab + v-fin), and a top fin.
 *
 * Its projected silhouettes are the REALISTIC target for the recognizability scorer, replacing the
 * earlier hand-drawn masks. Axes match the builder/scorer convention: X = fuselage length,
 * Y = up (ground at 0), Z = wingspan (centered).
 */

export type Vec3 = [number, number, number];
export type JetPart = "fuselage" | "nose" | "wing" | "tail" | "fin";
export interface ReferenceTile {
  part: JetPart;
  verts: Vec3[];
}

const E = 3; // SMALL_EDGE
const TH = Math.sqrt(E * E - (E / 2) * (E / 2)); // equilateral height ≈ 2.598 (square side faces)

/**
 * Fuselage is a TRIANGULAR PRISM (equilateral cross-section, side 3), not a square tube. The BOM
 * (16 small squares) only works as a triangle: 3 faces x 4 segments = 12 body squares, leaving 4
 * squares for the wing modules. It rests keel-DOWN (bottom ridge at Y=0 on the table, flat top at
 * Y=TH), which is tippy on its own - hence the video's "adjust until the body stands by itself" -
 * and is braced upright by the wide wings acting as outriggers.
 *
 * Cross-section (looking down +X): top edge Z in [-1.5, 1.5] at Y=TH; bottom keel at (Y=0, Z=0).
 * The two slanted side faces are each 3x3 squares (slant length = 3).
 */
// Reconstructed from the CLEAN final-inspection frames (t405 side, t360 top-3/4) sampled directly
// from the video, not the hand-occluded step frames. Key proportions from t405:
//  - a LONG pointed nose wedge (~40% of the length), low to the table;
//  - a low keeled triangular body;
//  - WIDE wings spreading nearly flat at table level;
//  - LARGE, TALL upright tail fins (taller than the body) clustered at the rear.
function buildReferenceTiles(): ReferenceTile[] {
  const tiles: ReferenceTile[] = [];

  // Body: triangular prism (keel-down), 4 segments, X in [0,12]. Rear at X=0, front at X=12.
  for (let s = 0; s < 4; s += 1) {
    const xa = s * E;
    const xb = s * E + E;
    tiles.push({ part: "fuselage", verts: [[xa, TH, -1.5], [xb, TH, -1.5], [xb, TH, 1.5], [xa, TH, 1.5]] });
    tiles.push({ part: "fuselage", verts: [[xa, TH, -1.5], [xb, TH, -1.5], [xb, 0, 0], [xa, 0, 0]] });
    tiles.push({ part: "fuselage", verts: [[xa, TH, 1.5], [xb, TH, 1.5], [xb, 0, 0], [xa, 0, 0]] });
  }

  // Nose: a LONG triangular wedge from the front opening (X=12) to a sharp apex well forward, low.
  const apex: Vec3 = [19.5, 0.4, 0];
  tiles.push({ part: "nose", verts: [[12, TH, -1.5], [12, TH, 1.5], apex] }); // top
  tiles.push({ part: "nose", verts: [[12, TH, -1.5], [12, 0, 0], apex] }); // left slant
  tiles.push({ part: "nose", verts: [[12, TH, 1.5], [12, 0, 0], apex] }); // right slant

  // Wings: large, WIDE, nearly flat at table level, swept rearward. Rooted along the lower-mid
  // side of the body, spreading far out in ±Z and dropping to ~table height at the tips.
  for (const sign of [-1, 1]) {
    const zRoot = 1.2 * sign;
    const zTip = 8.5 * sign;
    const leadRoot: Vec3 = [11, 1.4, zRoot];
    const trailRoot: Vec3 = [3, 1.4, zRoot];
    const tip: Vec3 = [7, 0.2, zTip];
    const tipTrail: Vec3 = [2, 0.3, zTip * 0.7];
    tiles.push({ part: "wing", verts: [leadRoot, trailRoot, tip] });
    tiles.push({ part: "wing", verts: [trailRoot, tipTrail, tip] });
  }

  // Tail: a cluster of LARGE, TALL upright fins at the rear (taller than the body), plus low
  // horizontal stabilizers spreading sideways.
  // Two big vertical fins in the X-Y plane (Z=0), fanned, reaching well above the body top.
  tiles.push({ part: "tail", verts: [[5, TH, 0], [1.5, TH, 0], [3.5, TH + 4.0, 0]] }); // tall central fin
  tiles.push({ part: "tail", verts: [[3, TH, 0], [0, TH, 0], [1.0, TH + 3.4, 0.0]] }); // rear fin
  // Horizontal stabilizers (low, spreading at the very rear).
  for (const sign of [-1, 1]) {
    const zRoot = 1.2 * sign;
    const zTip = 4.0 * sign;
    tiles.push({ part: "tail", verts: [[0, TH, zRoot], [3, TH, zRoot], [0.5, TH + 0.3, zTip]] });
  }

  // Top fin: a smaller upright triangle just ahead of the tail cluster.
  tiles.push({ part: "fin", verts: [[7, TH, 0], [4.5, TH, 0], [6, TH + 2.4, 0]] });

  return tiles;
}

export const JET_REFERENCE_TILES: ReferenceTile[] = buildReferenceTiles();

export type SilhouetteView = "top" | "side" | "front";

// Project a world point to a view's 2D (a,b) plane. Matches the scorer's VIEW_AXES:
// top = (x,z), side = (x,y), front = (z,y).
const VIEW_PROJECT: Record<SilhouetteView, (v: Vec3) => [number, number]> = {
  top: (v) => [v[0], v[2]],
  side: (v) => [v[0], v[1]],
  front: (v) => [v[2], v[1]]
};

function pointInPoly(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The reconstruction's silhouette as a normalized grid mask for a view: project all tiles, take the
 * bounding box, and rasterize occupancy into a grid x grid mask (same normalization the scorer uses
 * for candidate builds, so the two are directly comparable by IoU).
 */
export function referenceSilhouetteMask(view: SilhouetteView, grid: number): Uint8Array {
  const project = VIEW_PROJECT[view];
  const polys = JET_REFERENCE_TILES.map((t) => t.verts.map(project));
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (const poly of polys) for (const [a, b] of poly) {
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const aSpan = aMax - aMin || 1;
  const bSpan = bMax - bMin || 1;
  const mask = new Uint8Array(grid * grid);
  for (let j = 0; j < grid; j += 1) {
    for (let i = 0; i < grid; i += 1) {
      const pa = aMin + ((i + 0.5) / grid) * aSpan;
      const pb = bMin + ((j + 0.5) / grid) * bSpan;
      for (const poly of polys) {
        if (pointInPoly(pa, pb, poly)) {
          mask[j * grid + i] = 1;
          break;
        }
      }
    }
  }
  return mask;
}
