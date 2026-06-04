import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  composeMacros,
  coplanarFlatJoin,
  joinByPorts,
  macroBom,
  tilePrimitive,
  type TileMacro
} from "../lib/magnetic-tiles/macros";
import { assembleBuildGraph, draftToBuildGraph } from "../lib/builder/operations";
import { gateBuild, type GateBuildResult } from "../lib/engine";
import { buildBounds } from "../lib/engine/build";
import { findRawOverlaps } from "../lib/engine/overlap";
import { scoreRecognition, combinedScore, type RecognitionBreakdown } from "../lib/recognition/score";
import { jetSilhouetteMatch, type SilhouetteScore } from "../lib/recognition/silhouette";
import { JET_RECOGNITION_TARGET } from "../lib/recognition/targets";
import type { AuthoredBuildDraft, BuilderTile } from "../lib/builder/types";
import type { BuildGraph, Inventory, MagneticConnection, TileInstance, Vec3 } from "../lib/magnetic-tiles/types";

const OUT = "build-drafts/jet-aircraft.json";
const NOW = "2026-06-03T00:00:00.000Z";
const BODY_SEGMENTS = 4;
const SIDE_FOLD = Math.PI / 3;
const UPRIGHT_FOLD = -Math.PI / 2;

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

interface JetVariant {
  wingSegments: number[];
  wingFold: number;
  wingFlip: boolean;
  wingMount: "top-edge" | "side-keel";
  sideNose: boolean;
  tailPair: boolean;
  topFin: boolean;
}

interface Candidate {
  variant: JetVariant;
  draft: AuthoredBuildDraft;
  graph: BuildGraph;
  gate: GateBuildResult;
  recognition: RecognitionBreakdown;
  silhouette: SilhouetteScore;
  score: number;
}

const VARIANTS: JetVariant[] = [
  { wingSegments: [2, 3], wingFold: 0, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: false },
  { wingSegments: [2, 3, 4], wingFold: 0, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: false },
  { wingSegments: [1, 2, 3, 4], wingFold: 0, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: false },
  { wingSegments: [2, 3], wingFold: 0, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [2, 3, 4], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "side-keel", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [1, 2, 3, 4], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "side-keel", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [2, 3], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "side-keel", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [2, 3, 4], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [1, 2, 3, 4], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [2, 3, 4], wingFold: (2 * Math.PI) / 3, wingFlip: false, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [1, 2, 3, 4], wingFold: (2 * Math.PI) / 3, wingFlip: false, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [2, 3], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "top-edge", sideNose: true, tailPair: true, topFin: true },
  { wingSegments: [2, 3, 4], wingFold: SIDE_FOLD, wingFlip: true, wingMount: "top-edge", sideNose: false, tailPair: true, topFin: true }
];

export function buildJetReconstructionDraft(variant: JetVariant = VARIANTS[0]): AuthoredBuildDraft {
  let build = buildTriangularFuselage();
  build = attachNose(build, variant.sideNose);
  build = attachWings(build, variant);
  build = attachTail(build, variant);
  return macroToDraft(composeMacros(build));
}

async function findBestCandidate(): Promise<Candidate> {
  const gatePassed: Candidate[] = [];

  for (const variant of VARIANTS) {
    const draft = buildJetReconstructionDraft(variant);
    let graph: BuildGraph;
    try {
      graph = assembleBuildGraph(draft, { strict: true });
    } catch (error) {
      console.log(
        [
          `variant wings=${variant.wingSegments.join(",")} fold=${round(variant.wingFold)} flip=${variant.wingFlip}`,
          `mount=${variant.wingMount}`,
          "strict=false",
          error instanceof Error ? error.message : String(error)
        ].join(" ")
      );
      continue;
    }
    const gate = await gateBuild(graph);
    const recognition = scoreRecognition(graph, JET_RECOGNITION_TARGET);
    const silhouette = jetSilhouetteMatch(graph);
    const score = combinedScore(recognition.total, silhouette.total);
    const rawOverlaps = findRawOverlaps(graph.tiles);
    console.log(
      [
        `variant wings=${variant.wingSegments.join(",")} fold=${round(variant.wingFold)} flip=${variant.wingFlip}`,
        `mount=${variant.wingMount}`,
        `gate=${gate.passed}`,
        `overlaps=${rawOverlaps.length}`,
        `structural=${recognition.total.toFixed(3)}`,
        `silhouette=${silhouette.total.toFixed(3)}`
      ].join(" ")
    );
    if (gate.passed && rawOverlaps.length === 0) {
      gatePassed.push({ variant, draft, graph, gate, recognition, silhouette, score });
    }
  }

  if (gatePassed.length === 0) {
    throw new Error("No gate-passing reconstruction jet variant found.");
  }

  gatePassed.sort((first, second) => second.score - first.score);
  return gatePassed[0];
}

function buildTriangularFuselage(): TileMacro {
  let body = tilePrimitive({
    id: "body-top-1",
    shape: "small-square",
    plane: "horizontal",
    color: COLORS.body,
    subassemblyId: "body",
    role: "fuselage flat top square panel segment 1",
    stepStart: 1
  });

  for (let segment = 2; segment <= BODY_SEGMENTS; segment += 1) {
    body = joinByPorts(
      body,
      `body-top-${segment - 1}.right`,
      tilePrimitive({
        id: `body-top-${segment}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.body,
        subassemblyId: "body",
        role: `fuselage flat top square panel segment ${segment}`,
        stepStart: segment
      }),
      `body-top-${segment}.left`,
      { foldAngle: 0, flip: true }
    );
  }

  for (let segment = 1; segment <= BODY_SEGMENTS; segment += 1) {
    body = joinByPorts(
      body,
      `body-top-${segment}.bottom`,
      tilePrimitive({
        id: `body-left-${segment}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.body,
        subassemblyId: "body",
        role: `fuselage left angled square side panel segment ${segment}`,
        stepStart: segment + 4
      }),
      `body-left-${segment}.top`,
      { foldAngle: SIDE_FOLD }
    );
    body = joinByPorts(
      body,
      `body-top-${segment}.top`,
      tilePrimitive({
        id: `body-right-${segment}`,
        shape: "small-square",
        plane: "horizontal",
        color: COLORS.body,
        subassemblyId: "body",
        role: `fuselage right angled square side panel segment ${segment}`,
        stepStart: segment + 4
      }),
      `body-right-${segment}.top`,
      { foldAngle: SIDE_FOLD }
    );
  }

  body = joinByPorts(
    body,
    "body-top-1.left",
    tilePrimitive({
      id: "body-rear-cap",
      shape: "equilateral-triangle",
      plane: "horizontal",
      color: COLORS.body,
      subassemblyId: "body",
      role: "fuselage rear triangular end cap",
      stepStart: 8
    }),
    "body-rear-cap.base",
    { foldAngle: Math.PI / 2 }
  );

  body = joinByPorts(
    body,
    "body-top-4.right",
    tilePrimitive({
      id: "body-front-cap",
      shape: "equilateral-triangle",
      plane: "horizontal",
      color: COLORS.body,
      subassemblyId: "body",
      role: "fuselage front triangular end cap",
      stepStart: 8
    }),
    "body-front-cap.base",
    { foldAngle: Math.PI / 2 }
  );

  return composeMacros(body);
}

function attachNose(build: TileMacro, includeSidePanels: boolean): TileMacro {
  let result = joinByPorts(
    build,
    "body-top-4.right",
    tilePrimitive({
      id: "nose-top",
      shape: "isosceles-triangle",
      plane: "horizontal",
      color: COLORS.nose,
      subassemblyId: "nose",
      role: "long pointed nose top isosceles wedge panel",
      stepStart: 9
    }),
    "nose-top.base",
    { foldAngle: 0, flip: true }
  );

  if (!includeSidePanels) return result;

  result = joinByPorts(
    result,
    "body-left-4.edge3",
    tilePrimitive({
      id: "nose-left",
      shape: "isosceles-triangle",
      plane: "horizontal",
      color: COLORS.nose,
      subassemblyId: "nose",
      role: "long pointed nose left angled side wedge panel",
      stepStart: 10
    }),
    "nose-left.base",
    { foldAngle: 0, flip: true }
  );

  result = joinByPorts(
    result,
    "body-right-4.edge1",
    tilePrimitive({
      id: "nose-right",
      shape: "isosceles-triangle",
      plane: "horizontal",
      color: COLORS.nose,
      subassemblyId: "nose",
      role: "long pointed nose right angled side wedge panel",
      stepStart: 10
    }),
    "nose-right.base",
    { foldAngle: 0, flip: true }
  );

  return result;
}

function attachWings(build: TileMacro, variant: JetVariant): TileMacro {
  let result = build;
  for (const segment of variant.wingSegments) {
    const leftParentPort = variant.wingMount === "side-keel"
      ? `body-left-${segment}.bottom`
      : `body-top-${segment}.bottom`;
    const rightParentPort = variant.wingMount === "side-keel"
      ? `body-right-${segment}.bottom`
      : `body-top-${segment}.top`;

    const leftWing = tilePrimitive({
        id: `left-wing-${segment}`,
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.wing,
        subassemblyId: "wings",
        role: `left wide low delta wing isosceles panel segment ${segment}`,
        stepStart: 11 + segment
    });
    result = variant.wingMount === "top-edge" && Math.abs(variant.wingFold) < 0.0001
      ? coplanarFlatJoin(result, leftParentPort, leftWing, `left-wing-${segment}.base`)
      : joinByPorts(result, leftParentPort, leftWing, `left-wing-${segment}.base`, {
          foldAngle: variant.wingFold,
          flip: variant.wingFlip
        });

    const rightWing = tilePrimitive({
        id: `right-wing-${segment}`,
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.wing,
        subassemblyId: "wings",
        role: `right wide low delta wing isosceles panel segment ${segment}`,
        stepStart: 11 + segment
    });
    result = variant.wingMount === "top-edge" && Math.abs(variant.wingFold) < 0.0001
      ? coplanarFlatJoin(result, rightParentPort, rightWing, `right-wing-${segment}.base`)
      : joinByPorts(result, rightParentPort, rightWing, `right-wing-${segment}.base`, {
          foldAngle: variant.wingFold,
          flip: variant.wingFlip
        });
  }
  return result;
}

function attachTail(build: TileMacro, variant: JetVariant): TileMacro {
  let result = build;

  if (variant.tailPair) {
    result = joinByPorts(
      result,
      "body-top-1.bottom",
      tilePrimitive({
        id: "tail-left-fin",
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.tail,
        subassemblyId: variant.topFin ? "tail" : "top-fin",
        role: variant.topFin
          ? "left tall upright tail-fin vertical stabilizer"
          : "edge-on top-fin upright vertical stabilizer",
        stepStart: 16
      }),
      "tail-left-fin.base",
      { foldAngle: UPRIGHT_FOLD }
    );
    result = joinByPorts(
      result,
      "body-top-1.top",
      tilePrimitive({
        id: "tail-right-fin",
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.tail,
        subassemblyId: "tail",
        role: "right tall upright tail-fin vertical stabilizer",
        stepStart: 16
      }),
      "tail-right-fin.base",
      { foldAngle: UPRIGHT_FOLD }
    );
  }

  if (variant.topFin) {
    result = joinByPorts(
      result,
      "body-top-1.left",
      tilePrimitive({
        id: "top-fin",
        shape: "isosceles-triangle",
        plane: "horizontal",
        color: COLORS.topFin,
        subassemblyId: "top-fin",
        role: "center tall upright top-fin tail accent vertical stabilizer",
        stepStart: 17
      }),
      "top-fin.base",
      { foldAngle: UPRIGHT_FOLD }
    );
  }

  return result;
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
    notes: "Generated by scripts/generate-jet-reconstruction.ts from attach-system macros: keeled triangular-prism fuselage, long pointed nose, wide low delta wings, and upright tail fins.",
    expectedInventory: { ...EXPECTED_INVENTORY, ...bom },
    referenceFrameSrcs: [
      "/reference-frames/jet-aircraft/clean/final-side.jpg",
      "/reference-frames/jet-aircraft/clean/final-top-3q.jpg"
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

function formatSummary(candidate: Candidate): string {
  const bounds = buildBounds(candidate.graph.tiles);
  const extents = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z
  };
  const bomBySubassembly = candidate.graph.tiles.reduce<Record<string, Record<string, number>>>((counts, tile) => {
    const subassembly = tile.subassemblyId ?? "unknown";
    counts[subassembly] ??= {};
    counts[subassembly][tile.shape] = (counts[subassembly][tile.shape] ?? 0) + 1;
    return counts;
  }, {});
  return [
    `wrote ${OUT}`,
    `gate.passed: ${candidate.gate.passed}`,
    `raw overlaps: ${findRawOverlaps(candidate.graph.tiles).length}`,
    `structural score: ${candidate.recognition.total.toFixed(3)}`,
    `silhouette score: ${candidate.silhouette.total.toFixed(3)} ${JSON.stringify(roundObject(candidate.silhouette.perView))}`,
    `combined score: ${candidate.score.toFixed(3)}`,
    `BOM: ${JSON.stringify(candidate.draft.expectedInventory)}`,
    `BOM by subassembly: ${JSON.stringify(bomBySubassembly)}`,
    `bounds min/max: ${JSON.stringify({ min: roundVec(bounds.min), max: roundVec(bounds.max) })}`,
    `bounds extents X/Y/Z: ${extents.x.toFixed(3)} / ${extents.y.toFixed(3)} / ${extents.z.toFixed(3)}`,
    `gate reasons: ${candidate.gate.reasons.join(" | ")}`
  ].join("\n");
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

function roundObject<T extends Record<string, number>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, round(entry)])) as T;
}

function round(value: number): number {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

async function main(): Promise<void> {
  const best = await findBestCandidate();
  writeFileSync(OUT, `${JSON.stringify(best.draft, null, 2)}\n`);
  console.log(formatSummary(best));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
