import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  attachByPort,
  boundsForTiles,
  box,
  composeMacros,
  macroBom,
  squarePyramid,
  tilePrimitive,
  type TileMacro
} from "../lib/magnetic-tiles/macros";
import { assembleBuildGraph } from "../lib/builder/operations";
import { gateBuild, type GateBuildResult } from "../lib/engine";
import { buildBounds } from "../lib/engine/build";
import { findMagneticEdgeMatch, tileWorldVertices } from "../lib/magnetic-tiles/magnet-geometry";
import { tileNormal, tilesIntersectAsPrisms } from "../lib/magnetic-tiles/prism-geometry";
import { scoreRecognition, combinedScore, type RecognitionBreakdown } from "../lib/recognition/score";
import { jetSilhouetteMatch, type SilhouetteScore } from "../lib/recognition/silhouette";
import { JET_RECOGNITION_TARGET } from "../lib/recognition/targets";
import type { AuthoredBuildDraft, BuilderTile } from "../lib/builder/types";
import type { BuildBounds, BuildGraph, Inventory, MagneticConnection, TileInstance, Vec3 } from "../lib/magnetic-tiles/types";

export interface JetParams {
  fuselageLength: number;
  noseFold: number;
  nosePortIndex: number;
  noseFlip: number;
  wingSpan: number;
  wingSweep: number;
  wingDihedral: number;
  wingAttachSegment: number;
  wingFlip: number;
  tailFinHeight: number;
  tailFold: number;
  tailFlip: number;
  topFinFold: number;
  topFinFlip: number;
}

interface Candidate {
  params: JetParams;
  draft: AuthoredBuildDraft;
  graph: BuildGraph;
  recognition: RecognitionBreakdown;
  silhouette: SilhouetteScore;
  /** Combined objective: structural recognizability + geometric silhouette match (un-gameable). */
  score: number;
}

interface GateCandidate extends Candidate {
  gate: GateBuildResult;
}

const OUT = "build-drafts/jet-aircraft.json";
const NOW = "2026-06-03T00:00:00.000Z";
const EVALUATIONS = 120;
const GATE_CANDIDATES = 80;
const NOSE_PORTS = ["frontBase", "rightBase", "backBase", "leftBase"] as const;
const COLORS = {
  body: "#118ab2",
  nose: "#8ecae6",
  wing: "#ef476f",
  tail: "#06d6a0",
  topFin: "#7b2cbf"
};
const EXPECTED_INVENTORY: Partial<Inventory> = {
  "small-square": 0,
  "equilateral-triangle": 0,
  "right-triangle": 0,
  "isosceles-triangle": 0,
  "large-square": 0
};

export const SEED: JetParams = {
  fuselageLength: 4,
  noseFold: 0,
  nosePortIndex: 0,
  noseFlip: 0,
  wingSpan: 3,
  wingSweep: 0,
  wingDihedral: (5 * Math.PI) / 12,
  wingAttachSegment: 2,
  wingFlip: 0,
  tailFinHeight: 1,
  tailFold: 0,
  tailFlip: 1,
  topFinFold: 0,
  topFinFlip: 1
};

export function buildJetDraft(params: Partial<JetParams> = SEED): AuthoredBuildDraft {
  const normalized = normalizeParams({ ...SEED, ...params });
  let build = labelMacro(
    box({
      id: "fuselage",
      width: normalized.fuselageLength,
      height: 1,
      depth: 1,
      openFaces: [],
      subassemblyId: "body",
      color: COLORS.body
    }),
    "body",
    "fuselage body square tube panel"
  );
  build = withPortAlias(build, "noseMount", "fuselage-right-1-1", 2);

  build = attachConnectedByPort(
    build,
    "fuselage.noseMount",
    labelMacro(squarePyramid({ id: "nose", subassemblyId: "nose", color: COLORS.nose, stepStart: 4 }), "nose", "pointed nose cone face"),
    NOSE_PORTS[normalized.nosePortIndex],
    { foldAngle: normalized.noseFold, flip: Boolean(normalized.noseFlip) }
  );

  const firstWingSegment = Math.min(
    normalized.wingAttachSegment,
    Math.max(1, normalized.fuselageLength - normalized.wingSpan + 1)
  );
  for (let offset = 0; offset < normalized.wingSpan; offset += 1) {
    const segment = firstWingSegment + offset;
    build = withPortAlias(build, `leftWingMount${segment}`, `fuselage-front-${segment}-1`, 0);
    build = attachConnectedByPort(
      build,
      `fuselage.leftWingMount${segment}`,
      buildWingMacro("left", segment, normalized.wingSweep),
      "root",
      { foldAngle: normalized.wingDihedral, flip: Boolean(normalized.wingFlip) }
    );

    build = withPortAlias(build, `rightWingMount${segment}`, `fuselage-back-${segment}-1`, 0);
    build = attachConnectedByPort(
      build,
      `fuselage.rightWingMount${segment}`,
      buildWingMacro("right", segment, normalized.wingSweep),
      "root",
      { foldAngle: Math.PI - normalized.wingDihedral, flip: Boolean(normalized.wingFlip) }
    );
  }

  let tail = tilePrimitive({
    id: "tail-fin-1",
    shape: "equilateral-triangle",
    plane: "vertical",
    color: COLORS.tail,
    stepStart: 8,
    role: "rear upright tail-fin vertical stabilizer",
    subassemblyId: "tail"
  });
  for (let index = 2; index <= normalized.tailFinHeight; index += 1) {
    tail = attachConnectedByPort(
      tail,
      `tail-fin-${index - 1}.left`,
      tilePrimitive({
        id: `tail-fin-${index}`,
        shape: "equilateral-triangle",
        plane: "vertical",
        color: COLORS.tail,
        stepStart: 8 + index,
        role: "stacked rear upright tail-fin vertical stabilizer",
        subassemblyId: "tail"
      }),
      "right",
      { foldAngle: 0, flip: true }
    );
  }
  build = attachConnectedByPort(
    build,
    "fuselage.topLeftEdge",
    tail,
    "base",
    { foldAngle: normalized.tailFold, flip: Boolean(normalized.tailFlip) }
  );

  build = attachConnectedByPort(
    build,
    "fuselage.topBackEdge",
    tilePrimitive({
      id: "top-fin",
      shape: "isosceles-triangle",
      plane: "vertical",
      color: COLORS.topFin,
      stepStart: 10,
      role: "forward upright top-fin tail accent",
      subassemblyId: "top-fin"
    }),
    "base",
    { foldAngle: normalized.topFinFold, flip: Boolean(normalized.topFinFlip) }
  );

  return macroToDraft(composeMacros(build));
}

export async function optimizeJet(evaluations = EVALUATIONS): Promise<GateCandidate> {
  const structurallyValid: Candidate[] = [];
  const seeds = seedNeighborhood();

  for (const params of seeds) {
    const candidate = evaluate(params);
    if (candidate) structurallyValid.push(candidate);
  }

  let current = structurallyValid[0]?.params ?? SEED;
  for (let index = 0; index < evaluations; index += 1) {
    const params = index === 0 ? SEED : mutate(current, index);
    const candidate = evaluate(params);
    if (!candidate) continue;
    structurallyValid.push(candidate);
    const currentScore = evaluate(current)?.score ?? 0;
    if (candidate.score >= currentScore || index % 17 === 0) {
      current = candidate.params;
    }
  }

  structurallyValid.sort((first, second) => second.score - first.score);

  const gatePassed: GateCandidate[] = [];
  for (const candidate of structurallyValid.slice(0, GATE_CANDIDATES)) {
    const gate = await gateBuild(candidate.graph);
    if (gate.passed) gatePassed.push({ ...candidate, gate });
  }

  if (gatePassed.length === 0) {
    throw new Error(
      `No gate-passing jet found among ${structurallyValid.length} strict candidates. Best combined score: ${
        structurallyValid[0]?.score.toFixed(3) ?? "none"
      }`
    );
  }

  gatePassed.sort((first, second) => second.score - first.score);
  return gatePassed[0];
}

function buildWingMacro(side: "left" | "right", segment: number, sweep: number): TileMacro {
  const rootPortName = Math.abs(sweep) > 0.001 ? "hypotenuse" : "legA";
  const wing = tilePrimitive({
    id: `${side}-wing-${segment}`,
    shape: "right-triangle",
    plane: "horizontal",
    color: COLORS.wing,
    stepStart: 5,
    role: `${side} broad low delta wing right-triangle panel`,
    subassemblyId: "wings"
  });

  const rootPort = wing.ports?.[`${side}-wing-${segment}.${rootPortName}`] ?? wing.ports?.[rootPortName];
  if (!rootPort) throw new Error(`wing ${side} is missing a root port`);
  return {
    ...wing,
    ports: {
      ...(wing.ports ?? {}),
      root: rootPort
    }
  };
}

function evaluate(params: JetParams): Candidate | null {
  try {
    const draft = buildJetDraft(params);
    const graph = assembleBuildGraph(draft, { strict: true });
    const recognition = scoreRecognition(graph, JET_RECOGNITION_TARGET);
    if (!recognition.overlapFree || recognition.connectivity < 1) return null;
    const silhouette = jetSilhouetteMatch(graph);
    const score = combinedScore(recognition.total, silhouette.total);
    return { params: normalizeParams(params), draft, graph, recognition, silhouette, score };
  } catch {
    return null;
  }
}

function seedNeighborhood(): JetParams[] {
  const candidates: JetParams[] = [];
  for (const noseFold of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    for (let nosePortIndex = 0; nosePortIndex < NOSE_PORTS.length; nosePortIndex += 1) {
      for (const noseFlip of [0, 1]) {
        for (const wingDihedral of [Math.PI / 2, (5 * Math.PI) / 12, (7 * Math.PI) / 12, Math.PI / 3, (2 * Math.PI) / 3]) {
          for (const wingSpan of [2, 3, 4]) {
            for (const wingAttachSegment of [1, 2, 3]) {
              candidates.push(
                normalizeParams({ ...SEED, noseFold, nosePortIndex, noseFlip, wingDihedral, wingSpan, wingAttachSegment })
              );
            }
          }
        }
      }
    }
  }
  return candidates;
}

function mutate(base: JetParams, index: number): JetParams {
  const random = mulberry32(0x51f15e + index * 7919);
  const next = { ...base };
  next.fuselageLength += randomStep(random, 1.1);
  next.noseFold += randomStep(random, Math.PI / 2);
  next.nosePortIndex += randomStep(random, 1.4);
  next.noseFlip = random() < 0.5 ? 0 : 1;
  next.wingSpan += randomStep(random, 1.1);
  next.wingSweep += randomStep(random, Math.PI / 8);
  next.wingDihedral += randomStep(random, Math.PI / 4);
  next.wingAttachSegment += randomStep(random, 1);
  next.wingFlip = random() < 0.5 ? 0 : 1;
  next.tailFinHeight += randomStep(random, 0.9);
  next.tailFold += randomStep(random, Math.PI / 3);
  next.tailFlip = random() < 0.5 ? 0 : 1;
  next.topFinFold += randomStep(random, Math.PI / 3);
  next.topFinFlip = random() < 0.5 ? 0 : 1;
  return normalizeParams(next);
}

function normalizeParams(params: JetParams): JetParams {
  return {
    fuselageLength: clampInt(params.fuselageLength, 3, 5),
    noseFold: snapFold(params.noseFold),
    nosePortIndex: clampInt(params.nosePortIndex, 0, NOSE_PORTS.length - 1),
    noseFlip: params.noseFlip >= 0.5 ? 1 : 0,
    wingSpan: clampInt(params.wingSpan, 2, 4),
    wingSweep: snapFold(params.wingSweep, [0, Math.PI / 6, -Math.PI / 6]),
    wingDihedral: snapFold(params.wingDihedral, [Math.PI / 2, (5 * Math.PI) / 12, (7 * Math.PI) / 12, Math.PI / 3, (2 * Math.PI) / 3]),
    wingAttachSegment: clampInt(params.wingAttachSegment, 1, 4),
    wingFlip: params.wingFlip >= 0.5 ? 1 : 0,
    tailFinHeight: clampInt(params.tailFinHeight, 1, 3),
    tailFold: snapFold(params.tailFold),
    tailFlip: params.tailFlip >= 0.5 ? 1 : 0,
    topFinFold: snapFold(params.topFinFold),
    topFinFlip: params.topFinFlip >= 0.5 ? 1 : 0
  };
}

function macroToDraft(macro: TileMacro): AuthoredBuildDraft {
  const bom = macroBom(macro);
  return {
    id: "jet-aircraft",
    title: "Jet Aircraft",
    prompt: "Jet Aircraft",
    family: "aircraft",
    inventoryPreset: "classic-100",
    status: "engine-valid",
    createdAt: NOW,
    updatedAt: NOW,
    notes: "Generated by scripts/generate-jet.ts from a connected parametric attachByPort jet template and recognition optimizer.",
    expectedInventory: { ...EXPECTED_INVENTORY, ...bom },
    referenceFrameSrcs: [
      "/reference-frames/jet-aircraft/steps/01-body-start.jpg",
      "/reference-frames/jet-aircraft/steps/04-nose.jpg",
      "/reference-frames/jet-aircraft/steps/07-wings-aligned.jpg",
      "/reference-frames/jet-aircraft/steps/10-top-fin.jpg",
      "/reference-frames/jet-aircraft/steps/12-final-side.jpg"
    ],
    visualSignoff: false,
    tiles: macro.tiles.map((tile): BuilderTile => ({
      ...roundTile(tile),
      authoredMode: "edge-snap",
      confirmed: true
    })),
    connections: macro.connections as MagneticConnection[]
  };
}

function labelMacro(macro: TileMacro, subassemblyId: string, role: string): TileMacro {
  return {
    ...macro,
    tiles: macro.tiles.map((tile) => ({ ...tile, subassemblyId, role: `${role} ${tile.id}` }))
  };
}

function withPortAlias(macro: TileMacro, name: string, tileId: string, edge: number): TileMacro {
  const tile = tileById(macro, tileId);
  const vertices = tileWorldVertices(tile);
  const start = vertices[edge];
  const end = vertices[(edge + 1) % vertices.length];
  const direction = normalize(subtract(end, start));
  const normal = tileNormal(tile);
  const port = {
    name,
    tileId,
    edge,
    frame: {
      anchor: start,
      start,
      end,
      direction,
      normal
    }
  };
  return {
    ...macro,
    ports: {
      ...(macro.ports ?? {}),
      [name]: port,
      [`fuselage.${name}`]: { ...port, name: `fuselage.${name}` }
    }
  };
}

function attachConnectedByPort(
  parent: TileMacro,
  parentPortName: string,
  child: TileMacro,
  childPortName: string,
  options: { foldAngle?: number; flip?: boolean } = {}
): TileMacro {
  const joined = attachByPort(parent, parentPortName, child, childPortName, options);
  if (Math.abs(options.foldAngle ?? 0) <= 0.0001) return joined;

  const parentPort = parent.ports?.[parentPortName];
  const childPort = child.ports?.[childPortName];
  if (!parentPort || !childPort) return joined;

  const parentTile = tileById(joined, parentPort.tileId);
  const childTile = tileById(joined, childPort.tileId);
  const initial = tilesIntersectAsPrisms(parentTile, childTile);
  if (!initial.overlaps || initial.penetration <= 0.03) return joined;

  const childIds = new Set(child.tiles.map((tile) => tile.id));
  const parentIds = new Set(parent.tiles.map((tile) => tile.id));
  const parentNormal = tileNormal(parentTile);
  const childNormal = tileNormal(childTile);
  const candidates = [-1, 1].flatMap((parentSign) =>
    [-1, 1].map((childSign) =>
      add(
        scale(parentNormal, (parentSign * 0.18) / 2),
        scale(childNormal, (childSign * 0.18) / 2)
      )
    )
  );

  const scored = candidates.map((offset) => {
    const shifted = shiftChildTiles(joined, childIds, offset);
    const maxPenetration = maxParentChildPenetration(shifted, parentIds, childIds);
    const shiftedChild = tileById(shifted, childPort.tileId);
    const match = findMagneticEdgeMatch(parentTile, shiftedChild);
    return {
      offset,
      maxPenetration,
      edgeDistance: match?.fromEdge === parentPort.edge && match.toEdge === childPort.edge
        ? match.midpointDistance
        : Number.POSITIVE_INFINITY
    };
  });

  scored.sort((first, second) =>
    first.maxPenetration - second.maxPenetration ||
    first.edgeDistance - second.edgeDistance ||
    first.offset.x - second.offset.x ||
    first.offset.y - second.offset.y ||
    first.offset.z - second.offset.z
  );

  return shiftChildTiles(joined, childIds, scored[0]?.offset ?? { x: 0, y: 0, z: 0 });
}

function shiftChildTiles(macro: TileMacro, childIds: Set<string>, offset: Vec3): TileMacro {
  return {
    ...macro,
    tiles: macro.tiles.map((tile) =>
      childIds.has(tile.id) ? { ...tile, position: add(tile.position, offset) } : tile
    )
  };
}

function maxParentChildPenetration(macro: TileMacro, parentIds: Set<string>, childIds: Set<string>): number {
  let maxPenetration = 0;
  const parents = macro.tiles.filter((tile) => parentIds.has(tile.id));
  const children = macro.tiles.filter((tile) => childIds.has(tile.id));
  parents.forEach((parent) => {
    children.forEach((child) => {
      const intersection = tilesIntersectAsPrisms(parent, child);
      if (intersection.overlaps) maxPenetration = Math.max(maxPenetration, intersection.penetration);
    });
  });
  return maxPenetration;
}

function tileById(macro: TileMacro, tileId: string): TileInstance {
  const tile = macro.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) throw new Error(`Missing tile ${tileId}`);
  return tile;
}

function add(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scale(point: Vec3, amount: number): Vec3 {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function normalize(point: Vec3): Vec3 {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return scale(point, 1 / length);
}

function formatSummary(candidate: GateCandidate): string {
  const bounds = buildBounds(candidate.graph.tiles);
  const extents = extentsFor(bounds);
  const bomBySubassembly = candidate.graph.tiles.reduce<Record<string, Record<string, number>>>((counts, tile) => {
    const subassembly = tile.subassemblyId ?? "unknown";
    counts[subassembly] ??= {};
    counts[subassembly][tile.shape] = (counts[subassembly][tile.shape] ?? 0) + 1;
    return counts;
  }, {});
  return [
    `best combined score: ${candidate.score.toFixed(3)} (structural ${candidate.recognition.total.toFixed(
      3
    )}, silhouette ${candidate.silhouette.total.toFixed(3)})`,
    `silhouette perView: ${JSON.stringify({
      top: round(candidate.silhouette.perView.top),
      side: round(candidate.silhouette.perView.side),
      front: round(candidate.silhouette.perView.front)
    })}`,
    `breakdown: ${JSON.stringify({
      subassemblyCoverage: round(candidate.recognition.subassemblyCoverage),
      roleCoverage: round(candidate.recognition.roleCoverage),
      foldCoverage: round(candidate.recognition.foldCoverage),
      silhouetteRules: round(candidate.recognition.silhouette),
      connectivity: round(candidate.recognition.connectivity),
      overlapFree: candidate.recognition.overlapFree,
      passedSilhouetteRules: candidate.recognition.passedSilhouetteRules,
      failedSilhouetteRules: candidate.recognition.failedSilhouetteRules
    })}`,
    `params: ${JSON.stringify(candidate.params)}`,
    `bounds X/Y/Z: ${extents.x.toFixed(3)} / ${extents.y.toFixed(3)} / ${extents.z.toFixed(3)}`,
    `gate.passed: ${candidate.gate.passed}`,
    `BOM by subassembly: ${JSON.stringify(bomBySubassembly)}`
  ].join("\n");
}

function extentsFor(bounds: { min: Vec3; max: Vec3 }): Vec3 {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z
  };
}

function roundTile(tile: TileInstance): TileInstance {
  return {
    ...tile,
    position: roundVec(tile.position),
    rotation: roundVec(tile.rotation),
    basis: tile.basis
      ? {
          xAxis: roundVec(tile.basis.xAxis),
          yAxis: roundVec(tile.basis.yAxis),
          zAxis: roundVec(tile.basis.zAxis)
        }
      : undefined,
    foldAngle: tile.foldAngle === undefined ? undefined : round(tile.foldAngle)
  };
}

function roundVec<T extends Vec3>(value: T): T {
  return { x: round(value.x), y: round(value.y), z: round(value.z) } as T;
}

function round(value: number): number {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function randomStep(random: () => number, scale: number): number {
  return (random() * 2 - 1) * scale;
}

function snapFold(value: number, choices = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 3, -Math.PI / 3]): number {
  return choices.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  );
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const best = await optimizeJet(EVALUATIONS);
  writeFileSync(OUT, `${JSON.stringify(best.draft, null, 2)}\n`);
  console.log(formatSummary(best));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
