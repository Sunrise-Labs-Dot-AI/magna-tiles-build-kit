import {
  box,
  boundsForTiles,
  composeMacros,
  mirrorMacro,
  placeMacro,
  squarePyramid,
  tilePrimitive,
  type TileMacro
} from "../../lib/magnetic-tiles/macros";
import { SMALL_EDGE } from "../../lib/magnetic-tiles/catalog";
import { findRawOverlaps } from "../../lib/engine/overlap";
import { assembleBuildGraph } from "../../lib/builder/operations";
import type { AuthoredBuildDraft, BuilderTile } from "../../lib/builder/types";
import type { BuildGraph, MagneticConnection } from "../../lib/magnetic-tiles/types";

interface JetParams {
  fuselageLength: number;
  noseDepth: number;
  wingSpan: number;
}

interface Evaluation {
  params: JetParams;
  score: number;
  recognizability: number;
  penalty: number;
  overlapPenalty: number;
  disconnectedPenalty: number;
  overlapCount: number;
  disconnectedTiles: number;
  bounds: BuildGraph["bounds"];
}

const SETTINGS: JetParams[] = [
  { fuselageLength: 3, noseDepth: 1, wingSpan: 2 },
  { fuselageLength: 5, noseDepth: 2, wingSpan: 3 },
  { fuselageLength: 2, noseDepth: 1, wingSpan: 1 }
];

function jetTemplate(params: JetParams): AuthoredBuildDraft {
  const fuselageLength = clampInt(params.fuselageLength, 2, 6);
  const noseDepth = clampInt(params.noseDepth, 1, 3);
  const wingSpan = clampInt(params.wingSpan, 1, 4);

  const fuselage = box({
    id: "fuselage",
    width: 1,
    height: 1,
    depth: fuselageLength,
    openFaces: ["front", "back"],
    subassemblyId: "body",
    color: "#118ab2"
  });

  const nose = placeMacro(
    squarePyramid({
      id: "nose",
      subassemblyId: "nose",
      color: "#ffb703"
    }),
    { x: 0, y: 0, z: -SMALL_EDGE * (noseDepth + 1) }
  );

  const leftWingSegments: TileMacro[] = [];
  for (let index = 0; index < wingSpan; index += 1) {
    leftWingSegments.push(
      placeMacro(
        tilePrimitive({
          id: `left-wing-${index + 1}`,
          shape: "right-triangle",
          plane: "horizontal",
          role: "left wing panel",
          subassemblyId: "wings",
          color: "#ef476f"
        }),
        {
          x: -SMALL_EDGE * (index + 1.5),
          y: 0,
          z: SMALL_EDGE * (Math.max(1, fuselageLength - 1) / 2 + index * 0.15)
        }
      )
    );
  }

  const leftWing = composeMacros(...leftWingSegments);
  const wings = composeMacros(leftWing, mirrorMacro(leftWing, "x", SMALL_EDGE / 2));
  const macro = composeMacros(fuselage, nose, wings);

  return macroToDraft(macro, "Parametric optimizer POC");
}

function evaluate(params: JetParams): Evaluation {
  const draft = jetTemplate(params);
  const graph = assembleBuildGraph(draft, { strict: false });
  const overlaps = findRawOverlaps(graph.tiles);
  const bounds = boundsForTiles(graph.tiles);
  const overlapDepth = overlaps.reduce((total, overlap) => total + overlap.penetration, 0);
  const disconnectedTiles = countDisconnectedTiles(graph);

  const aspectRatio = bounds.depth === 0 ? 0 : bounds.width / bounds.depth;
  const aspectScore = 45 * clamp01((aspectRatio - 0.9) / 0.7);
  const fuselageScore = graph.tiles.some((tile) => tile.subassemblyId === "body") ? 15 : 0;
  const noseScore = graph.tiles.some((tile) => tile.subassemblyId === "nose") ? 12 : 0;
  const wingTiles = graph.tiles.filter((tile) => tile.subassemblyId === "wings").length;
  const wingScore = 30 * clamp01(wingTiles / 6);
  const lengthScore = 8 * clamp01((params.fuselageLength - 2) / 3);
  const recognizability = aspectScore + fuselageScore + noseScore + wingScore + lengthScore;

  const overlapPenalty = overlapDepth * 30;
  const disconnectedPenalty = disconnectedTiles * 0.6;
  const penalty = overlapPenalty + disconnectedPenalty;
  const score = recognizability - penalty;

  return {
    params,
    score,
    recognizability,
    penalty,
    overlapPenalty,
    disconnectedPenalty,
    overlapCount: overlaps.length,
    disconnectedTiles,
    bounds
  };
}

function macroToDraft(macro: TileMacro, title: string): AuthoredBuildDraft {
  const now = "2026-06-03T00:00:00.000Z";
  return {
    id: "optimizer-poc",
    title,
    prompt: title,
    family: "aircraft",
    inventoryPreset: "classic-100",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    referenceFrameSrcs: [],
    visualSignoff: false,
    tiles: macro.tiles.map(
      (tile): BuilderTile => ({
        ...tile,
        authoredMode: "edge-snap",
        confirmed: true
      })
    ),
    connections: macro.connections as MagneticConnection[]
  };
}

function countDisconnectedTiles(graph: BuildGraph): number {
  if (graph.tiles.length === 0) return 0;

  const adjacency = new Map<string, Set<string>>();
  graph.tiles.forEach((tile) => adjacency.set(tile.id, new Set()));
  graph.connections.forEach((connection) => {
    adjacency.get(connection.fromTileId)?.add(connection.toTileId);
    adjacency.get(connection.toTileId)?.add(connection.fromTileId);
  });

  const visited = new Set<string>([graph.tiles[0].id]);
  const queue = [graph.tiles[0].id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    adjacency.get(current)?.forEach((next) => {
      if (visited.has(next)) return;
      visited.add(next);
      queue.push(next);
    });
  }

  return graph.tiles.length - visited.size;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatEvaluation(evaluation: Evaluation): string {
  const { params, bounds } = evaluation;
  return [
    `params=${JSON.stringify(params)}`,
    `score=${evaluation.score.toFixed(2)}`,
    `recognizability=${evaluation.recognizability.toFixed(2)}`,
    `penalty=${evaluation.penalty.toFixed(2)}`,
    `overlaps=${evaluation.overlapCount}`,
    `disconnected=${evaluation.disconnectedTiles}`,
    `bounds=${bounds.width.toFixed(2)}w/${bounds.height.toFixed(2)}h/${bounds.depth.toFixed(2)}d`
  ].join(" ");
}

function run(): void {
  console.log("Parametric optimizer POC evaluations");
  SETTINGS.map(evaluate)
    .sort((first, second) => second.score - first.score)
    .forEach((evaluation, index) => {
      console.log(`${index + 1}. ${formatEvaluation(evaluation)}`);
    });
}

run();
