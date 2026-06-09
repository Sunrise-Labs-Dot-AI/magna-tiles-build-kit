import { findRawOverlaps } from "@/lib/engine/overlap";
import type { ReferenceIntentSpec } from "@/lib/reference-encoder/reference-acceptance";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

/**
 * Recognizability scorer (Phase 2 keystone).
 *
 * gateBuild proves a build is physically valid; it says nothing about whether the build LOOKS like
 * its target. This module supplies the missing quantitative resemblance signal: given a build graph
 * and a target intent spec, return a 0..1 score plus a breakdown. It is pure and fast (no rendering,
 * no physics), so a generator/optimizer can call it in an inner loop. The slower pixel-level
 * silhouette-IoU half (rendered-frame comparison) is a separate concern layered on top later.
 *
 * The score is a structural proxy for "reads as the thing": does it have the required parts
 * (subassemblies + roles), the expected fold variety, the right gross silhouette, is it connected,
 * and is it overlap-free. It is deliberately a ranking signal, not an acceptance gate — gateBuild +
 * human/vision signoff remain the floors.
 */

export interface RecognitionWeights {
  subassembly: number;
  role: number;
  fold: number;
  silhouette: number;
  connectivity: number;
}

export const DEFAULT_RECOGNITION_WEIGHTS: RecognitionWeights = {
  subassembly: 0.3,
  role: 0.15,
  fold: 0.1,
  silhouette: 0.35,
  connectivity: 0.1
};

export interface RecognitionBreakdown {
  /** 0..1 overall recognizability proxy. 0 if the build has raw overlaps (a non-build). */
  total: number;
  subassemblyCoverage: number;
  roleCoverage: number;
  foldCoverage: number;
  silhouette: number;
  connectivity: number;
  overlapFree: boolean;
  missingSubassemblies: string[];
  passedSilhouetteRules: string[];
  failedSilhouetteRules: string[];
}

/**
 * Combine the structural recognizability proxy with the geometric silhouette match. Silhouette is
 * weighted higher because the structural term alone is gameable (token tiles satisfy part-presence +
 * bounds); the silhouette term forces the tiles to actually fill the target's outline.
 */
export function combinedScore(
  structuralTotal: number,
  silhouetteTotal: number,
  silhouetteWeight = 0.55
): number {
  const w = Math.max(0, Math.min(1, silhouetteWeight));
  return (1 - w) * structuralTotal + w * silhouetteTotal;
}

/** Quarter-turn normalization, matching reference-acceptance's fold bucketing. */
function normalizeFoldAngle(angle: number): string {
  return (Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)).toFixed(2);
}

function fraction(matched: number, total: number): number {
  return total === 0 ? 1 : matched / total;
}

/** Fraction of graph tiles reachable from the first tile via magnetic connections. */
function connectedFraction(graph: BuildGraph): number {
  if (graph.tiles.length === 0) return 1;
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
  return visited.size / graph.tiles.length;
}

export function scoreRecognition(
  graph: BuildGraph,
  spec: ReferenceIntentSpec,
  weights: RecognitionWeights = DEFAULT_RECOGNITION_WEIGHTS
): RecognitionBreakdown {
  const tiles = graph.tiles;

  // Subassembly coverage: which required parts are present at all.
  const presentSubassemblies = new Set(tiles.map((tile) => tile.subassemblyId).filter(Boolean));
  const missingSubassemblies = spec.requiredSubassemblies.filter(
    (id) => !presentSubassemblies.has(id)
  );
  const subassemblyCoverage = fraction(
    spec.requiredSubassemblies.length - missingSubassemblies.length,
    spec.requiredSubassemblies.length
  );

  // Role coverage: required role/subassembly text patterns matched by some tile.
  const roleMatched = spec.requiredRolePatterns.filter((pattern) =>
    tiles.some((tile) => pattern.test(`${tile.role} ${tile.subassemblyId ?? ""}`))
  ).length;
  const roleCoverage = fraction(roleMatched, spec.requiredRolePatterns.length);

  // Fold coverage: required fold-angle buckets that appear among attached tiles.
  const presentFolds = new Set(
    tiles
      .filter((tile) => tile.parentTileId)
      .map((tile) => normalizeFoldAngle(tile.foldAngle ?? 0))
  );
  const foldMatched = spec.requiredFoldAngles.filter((angle) =>
    presentFolds.has(normalizeFoldAngle(angle))
  ).length;
  const foldCoverage = fraction(foldMatched, spec.requiredFoldAngles.length);

  // Silhouette: fraction of gross-shape predicates the bounding box satisfies.
  const passedSilhouetteRules: string[] = [];
  const failedSilhouetteRules: string[] = [];
  for (const rule of spec.silhouetteRules) {
    if (rule.predicate(graph.bounds)) passedSilhouetteRules.push(rule.description);
    else failedSilhouetteRules.push(rule.description);
  }
  const silhouette = fraction(passedSilhouetteRules.length, spec.silhouetteRules.length);

  const connectivity = connectedFraction(graph);
  const overlapFree = findRawOverlaps(tiles).length === 0;

  const weighted =
    weights.subassembly * subassemblyCoverage +
    weights.role * roleCoverage +
    weights.fold * foldCoverage +
    weights.silhouette * silhouette +
    weights.connectivity * connectivity;
  const weightSum =
    weights.subassembly + weights.role + weights.fold + weights.silhouette + weights.connectivity;
  // Raw overlap means it is not a physical build at all -> zero out the recognizability proxy.
  const total = overlapFree ? weighted / weightSum : 0;

  return {
    total,
    subassemblyCoverage,
    roleCoverage,
    foldCoverage,
    silhouette,
    connectivity,
    overlapFree,
    missingSubassemblies,
    passedSilhouetteRules,
    failedSilhouetteRules
  };
}
