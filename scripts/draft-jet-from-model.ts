/**
 * Convert the 3D jet reconstruction (jet-reference-model.ts) into an actual Magnatiles draft:
 * each reconstruction polygon becomes a real tile (small-square / triangle) placed via position +
 * basis. Squares (the fuselage prism) convert exactly; triangles are mapped to the nearest real
 * triangle tile, oriented to the reconstruction polygon's plane and primary edge.
 *
 * Writes build-drafts/jet-reconstruction.json and reports the gate verdict.
 * Run: npx tsx scripts/draft-jet-from-model.ts
 */
import { writeFileSync } from "node:fs";
import { JET_REFERENCE_TILES, type ReferenceTile, type Vec3 } from "../lib/recognition/jet-reference-model";
import { TILE_SPECS } from "../lib/magnetic-tiles/catalog";
import { draftToBuildGraph } from "../lib/builder/operations";
import { gateBuild } from "../lib/engine";
import { findRawOverlaps } from "../lib/engine/overlap";
import type { AuthoredBuildDraft, BuilderTile } from "../lib/builder/types";
import type { TileShape } from "../lib/magnetic-tiles/types";

type V = { x: number; y: number; z: number };
const v = (a: Vec3): V => ({ x: a[0], y: a[1], z: a[2] });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V) => Math.sqrt(dot(a, a));
const norm = (a: V): V => { const l = len(a) || 1; return scale(a, 1 / l); };
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

const COLORS: Record<string, string> = {
  fuselage: "#118ab2", nose: "#8ecae6", wing: "#ef476f", tail: "#06d6a0", fin: "#7b2cbf"
};
const PART_SHAPE: Record<string, TileShape> = {
  fuselage: "small-square", nose: "right-triangle", wing: "right-triangle", tail: "equilateral-triangle", fin: "equilateral-triangle"
};

// Build a basis + position that places a tile of `shape` so its local vertices map onto the target
// polygon as closely as the tile's fixed geometry allows.
function placeTile(shape: TileShape, target: V[]): { position: V; basis: { xAxis: V; yAxis: V; zAxis: V } } {
  const spec = TILE_SPECS[shape];
  const halfW = spec.width / 2;
  const halfH = spec.height / 2;
  const t0 = target[0];
  const t1 = target[1];
  const t2 = target[2 % target.length];

  const xAxis = norm(sub(t1, t0));
  const zAxis = norm(cross(sub(t1, t0), sub(t2, t0)));
  const yAxis = norm(cross(zAxis, xAxis));

  if (shape === "small-square" && target.length === 4) {
    // Exact: map corners directly. position = centroid; basis from the two edges at corner0.
    const yA = norm(sub(target[3], t0));
    const zA = norm(cross(xAxis, yA));
    const position = scale(add(add(target[0], target[1]), add(target[2], target[3])), 0.25);
    return { position, basis: { xAxis, yAxis: yA, zAxis: zA } };
  }

  // Triangle: anchor local vertex 0 (-halfW,-halfH) at target t0, with local +x along t0->t1.
  // position = t0 - localV0 mapped, so that world(localV0) = t0.
  const localV0 = { x: -halfW, y: -halfH };
  const position = sub(t0, add(scale(xAxis, localV0.x), scale(yAxis, localV0.y)));
  return { position, basis: { xAxis, yAxis, zAxis } };
}

const NOW = "2026-06-03T00:00:00.000Z";
const HALF_THICKNESS = 0.09; // TILE_THICKNESS / 2 — offset faces outward so angled joints don't interpenetrate

// Global centroid of all reconstruction vertices, to orient each tile's outward normal.
const allVerts = (JET_REFERENCE_TILES as ReferenceTile[]).flatMap((t) => t.verts.map(v));
const centroid = scale(allVerts.reduce((a, b) => add(a, b), { x: 0, y: 0, z: 0 }), 1 / allVerts.length);

const tiles: BuilderTile[] = [];
let counter = 0;
const partCounters: Record<string, number> = {};
for (const t of JET_REFERENCE_TILES as ReferenceTile[]) {
  const shape = PART_SHAPE[t.part];
  const target = t.verts.map(v);
  const placed = placeTile(shape, target);
  // Push the tile outward along its normal by half-thickness (like box face offsets), so faces
  // meeting at the prism's angled edges don't interpenetrate as solid prisms.
  const faceCenter = scale(target.reduce((a, b) => add(a, b), { x: 0, y: 0, z: 0 }), 1 / target.length);
  const outwardSign = dot(placed.basis.zAxis, sub(faceCenter, centroid)) >= 0 ? 1 : -1;
  const position = add(placed.position, scale(placed.basis.zAxis, outwardSign * HALF_THICKNESS));
  const basis = placed.basis;
  partCounters[t.part] = (partCounters[t.part] ?? 0) + 1;
  counter += 1;
  tiles.push({
    id: `${t.part}-${partCounters[t.part]}`,
    shape,
    color: COLORS[t.part],
    position,
    rotation: { x: 0, y: 0, z: 0 },
    basis,
    step: counter,
    role: `${t.part} panel`,
    subassemblyId: t.part === "fuselage" ? "body" : t.part === "fin" ? "top-fin" : t.part === "wing" ? "wings" : t.part,
    authoredMode: "freeform",
    confirmed: true
  });
}

const draft: AuthoredBuildDraft = {
  id: "jet-reconstruction",
  title: "Jet Aircraft (reconstruction)",
  prompt: "jet aircraft reconstructed from video",
  family: "aircraft",
  inventoryPreset: "classic-100",
  status: "draft",
  createdAt: NOW,
  updatedAt: NOW,
  referenceFrameSrcs: [],
  visualSignoff: false,
  tiles,
  connections: []
};

writeFileSync("build-drafts/jet-reconstruction.json", `${JSON.stringify(draft, null, 2)}\n`);

(async () => {
  const graph = draftToBuildGraph(draft);
  const overlaps = findRawOverlaps(graph.tiles);
  const bom: Record<string, number> = {};
  graph.tiles.forEach((t) => (bom[t.shape] = (bom[t.shape] ?? 0) + 1));
  console.log("tiles:", graph.tiles.length, "BOM:", JSON.stringify(bom));
  console.log("bounds W/H/D:", graph.bounds.width.toFixed(1), graph.bounds.height.toFixed(1), graph.bounds.depth.toFixed(1));
  console.log("raw overlaps:", overlaps.length, overlaps.slice(0, 6).map((o) => `${o.firstTileId}<->${o.secondTileId}:${o.penetration.toFixed(2)}`).join(" "));
  const gate = await gateBuild(graph);
  console.log("GATE passed:", gate.passed);
  gate.reasons.slice(0, 14).forEach((r) => console.log("  -", r));
})();
