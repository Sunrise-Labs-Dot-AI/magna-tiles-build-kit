/**
 * Reconstruct the jet as a raw 3D model from the video frames (NOT via the Magnatiles builder).
 *
 * Each tile is placed directly in world space as a polygon, scaled by real tile dimensions
 * (SMALL_EDGE = 3 app units). This is free of the builder's macro/fold/overlap constraints, so it
 * can capture the TRUE shape the video builder made - in particular the wide swept wings that the
 * cube-corner fold rules wouldn't allow.
 *
 * Reconstruction is from: 03-body-stands (square tube), 05-left-wing (square tube end-on + forward
 * nose point + wing = square+triangle module), 07-wings-aligned (cross/plus from top), 09-tail
 * (wide swept wings + rear h-stab + v-fin), 11/12/13 finals.
 *
 * Output: projected silhouettes (top/side/front) + a shaded iso view, written to
 * verification/jet-reference-model/*.png. The silhouettes become the realistic target for the
 * recognizability scorer (replacing the hand-drawn JET_TARGET_PREDICATES).
 *
 * Run: npx tsx scripts/reconstruct-jet.ts
 */

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { JET_REFERENCE_TILES, type JetPart, type ReferenceTile, type Vec3 } from "../lib/recognition/jet-reference-model";

type Tile = ReferenceTile;
const tiles = JET_REFERENCE_TILES;

// ---- Rendering ----
const COLORS: Record<JetPart, [number, number, number]> = {
  fuselage: [30, 110, 180],
  nose: [120, 200, 230],
  wing: [225, 70, 110],
  tail: [20, 200, 150],
  fin: [140, 70, 200]
};

const W = 600;
const H = 450;

interface Proj {
  pts: Array<[number, number]>;
  depth: number;
  color: [number, number, number];
}

function projectTiles(project: (v: Vec3) => [number, number, number]): Proj[] {
  const projected: Proj[] = tiles.map((t) => {
    const ps = t.verts.map(project);
    const depth = ps.reduce((s, p) => s + p[2], 0) / ps.length;
    return { pts: ps.map((p) => [p[0], p[1]] as [number, number]), depth, color: COLORS[t.part] };
  });
  return projected.sort((a, b) => b.depth - a.depth); // far first (painter's)
}

function fitToCanvas(projs: Proj[], pad = 40): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of projs) for (const [x, y] of p.pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const sx = (W - 2 * pad) / (maxX - minX || 1);
  const sy = (H - 2 * pad) / (maxY - minY || 1);
  const s = Math.min(sx, sy);
  for (const p of projs) {
    p.pts = p.pts.map(([x, y]) => [pad + (x - minX) * s, H - (pad + (y - minY) * s)]);
  }
}

function pointInPoly(px: number, py: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function rasterize(projs: Proj[], path: string, mode: "shaded" | "silhouette"): Promise<void> {
  const buf = Buffer.alloc(W * H * 3, 245); // light gray bg
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      for (const p of projs) {
        if (pointInPoly(x + 0.5, y + 0.5, p.pts)) {
          const i = (y * W + x) * 3;
          if (mode === "silhouette") {
            buf[i] = 30; buf[i + 1] = 30; buf[i + 2] = 30;
          } else {
            buf[i] = p.color[0]; buf[i + 1] = p.color[1]; buf[i + 2] = p.color[2];
          }
        }
      }
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path);
}

// Projections (return [screenX, screenY(up), depth])
const projTop = (v: Vec3): [number, number, number] => [v[0], -v[2], -v[1]]; // looking down -Y
const projSide = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]]; // looking along +Z
const projFront = (v: Vec3): [number, number, number] => [-v[2], v[1], -v[0]]; // looking along -X (from nose)
function projIso(v: Vec3): [number, number, number] {
  const az = (35 * Math.PI) / 180;
  const el = (25 * Math.PI) / 180;
  const x1 = v[0] * Math.cos(az) + v[2] * Math.sin(az);
  const z1 = -v[0] * Math.sin(az) + v[2] * Math.cos(az);
  const y2 = v[1] * Math.cos(el) - z1 * Math.sin(el);
  const depth = v[1] * Math.sin(el) + z1 * Math.cos(el);
  return [x1, y2, depth];
}

async function main() {
  const outDir = join(process.cwd(), "verification", "jet-reference-model");
  mkdirSync(outDir, { recursive: true });

  const views: Array<{ name: string; project: (v: Vec3) => [number, number, number]; mode: "shaded" | "silhouette" }> = [
    { name: "iso", project: projIso, mode: "shaded" },
    { name: "top", project: projTop, mode: "silhouette" },
    { name: "side", project: projSide, mode: "silhouette" },
    { name: "front", project: projFront, mode: "silhouette" }
  ];

  for (const view of views) {
    const projs = projectTiles(view.project);
    fitToCanvas(projs);
    await rasterize(projs, join(outDir, `${view.name}.png`), view.mode);
    console.log(`wrote ${view.name}.png (${view.mode})`);
  }
  console.log(`\nReconstructed jet: ${tiles.length} tiles`);
  const byPart: Record<string, number> = {};
  tiles.forEach((t) => (byPart[t.part] = (byPart[t.part] ?? 0) + 1));
  console.log("by part:", JSON.stringify(byPart));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
