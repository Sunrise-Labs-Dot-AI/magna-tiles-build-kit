/**
 * Solved-angle span placement: anchor a tile's hinge edge on one magnet edge, pick a
 * second magnet edge anywhere else (any tile, any island), and SOLVE the fold angle and
 * edge alignment so the tile's opposite edge lands on the target edge within magnetic
 * tolerance. This is how a ramp bridges two towers of different heights: the solved
 * angle is whatever the geometry dictates (e.g. ≈30° for a one-square drop across an
 * XL square), not a preset.
 *
 * Everything here is deterministic geometry. If the gap between the edges does not
 * match the tile's span within magnetic tolerance, the solver REFUSES with the measured
 * gap — it never force-snaps. Committing flows through addEdgeSnappedTile (the only
 * write path), so overlap stays impossible by construction.
 */
import { TILE_SPECS, TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";
import { findMagneticEdgeMatch, tileLocalVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal } from "@/lib/magnetic-tiles/prism-geometry";
import type { TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import {
  addEdgeSnappedTile,
  previewEdgeSnappedTile,
  withContactConnections
} from "./operations";
import { builderTileWorldVertices, ghostBlockedReason } from "./placement";
import type { AuthoredBuildDraft, BuilderTile } from "./types";

/**
 * How far the solved seat may be from a perfect edge-to-edge meeting. This matches the
 * magnetic edge-match tolerance in magnet-geometry (EDGE_TOLERANCE = 0.68): a seat the
 * magnets would not actually grab is refused, never fudged.
 */
export const SPAN_SEAT_TOLERANCE = 0.68;

/** Edges must be near-parallel for a hinged tile to seat on both (same as magnet matching). */
const SPAN_PARALLEL_TOLERANCE = 0.92;

export interface SpanEdgeRef {
  tileId: string;
  edge: number;
}

export interface SpanSolution {
  ok: true;
  tile: BuilderTile;
  foldAngle: number;
  reverse: boolean;
  edgeOffset: number;
  /** Local edge index of the placed tile that seats on the target edge. */
  oppositeEdge: number;
  /** Measured distance between the seated edge midpoints (within tolerance). */
  seatDistance: number;
}

export interface SpanRefusal {
  ok: false;
  reason: string;
  /** Measured gap between required span and available distance, when that is the blocker. */
  gap?: number;
}

export type SpanResult = SpanSolution | SpanRefusal;

/**
 * Solve the placement of `shape` hinged on `anchor` so its opposite edge seats on
 * `target`. Deterministic: same inputs, same answer.
 */
export function solveSpanPlacement(
  draft: AuthoredBuildDraft,
  anchor: SpanEdgeRef,
  target: SpanEdgeRef,
  options: { shape: TileShape; childEdge?: number; color: string }
): SpanResult {
  const anchorTile = draft.tiles.find((tile) => tile.id === anchor.tileId);
  const targetTile = draft.tiles.find((tile) => tile.id === target.tileId);
  if (!anchorTile || !targetTile) return { ok: false, reason: "Anchor or target tile is gone." };
  if (anchor.tileId === target.tileId && anchor.edge === target.edge) {
    return { ok: false, reason: "Pick a different edge for the far side." };
  }

  const spec = TILE_SPECS[options.shape];
  if (spec.maxEdges !== 4) {
    return { ok: false, reason: "Span placement needs a four-sided tile." };
  }
  const childEdge = options.childEdge ?? 0;
  const oppositeEdge = (childEdge + 2) % 4;
  const span = localEdgeSeparation(options.shape, childEdge, oppositeEdge);

  const anchorEdge = worldEdgeOf(anchorTile, anchor.edge);
  const targetEdge = worldEdgeOf(targetTile, target.edge);
  const hingeDirection = normalize(subtract(anchorEdge.end, anchorEdge.start));
  const targetDirection = normalize(subtract(targetEdge.end, targetEdge.start));
  if (Math.abs(dot(hingeDirection, targetDirection)) < SPAN_PARALLEL_TOLERANCE) {
    return { ok: false, reason: "The two edges are not parallel — a hinged tile cannot seat on both." };
  }

  const hingeMid = midpoint(anchorEdge.start, anchorEdge.end);
  const targetMid = midpoint(targetEdge.start, targetEdge.end);
  const toTarget = subtract(targetMid, hingeMid);
  const perpendicular = subtract(toTarget, scale(hingeDirection, dot(toTarget, hingeDirection)));
  const reach = magnitude(perpendicular);
  const gap = Math.abs(reach - span);
  if (gap > SPAN_SEAT_TOLERANCE) {
    return {
      ok: false,
      reason: `Doesn't reach: the edges are ${reach.toFixed(2)} apart but this tile spans ${span.toFixed(2)} (gap ${gap.toFixed(2)}).`,
      gap: Number(gap.toFixed(3))
    };
  }
  if (reach < 0.001) {
    return { ok: false, reason: "The edges are on top of each other." };
  }

  const aimDirection = scale(perpendicular, 1 / reach);
  const parentNormal = tileNormal(anchorTile);
  // The tile may overshoot or undershoot by up to the tolerance; grazing candidates tilt
  // it just enough that the face rests on the target edge instead of biting into it.
  const graze = Math.asin(Math.min(1, (TILE_THICKNESS / 2 + 0.015) / reach));

  let best: SpanSolution | null = null;
  let blockedReason: string | null = null;
  for (const reverse of [false, true]) {
    const directedStart = reverse ? anchorEdge.end : anchorEdge.start;
    const directedEnd = reverse ? anchorEdge.start : anchorEdge.end;
    const directedDirection = normalize(subtract(directedEnd, directedStart));
    // u(theta) = rotate(sign * baseLateral, hingeDirection, theta); solve u(theta) = aim.
    const lateralZero = normalize(cross(parentNormal, directedDirection));
    const sinTheta = dot(hingeDirection, cross(lateralZero, aimDirection));
    const cosTheta = dot(lateralZero, aimDirection);
    const solved = Math.atan2(sinTheta, cosTheta);
    const edgeOffset = dot(subtract(targetMid, hingeMid), directedDirection);

    for (const candidate of [solved, solved + graze, solved - graze]) {
      const tile = previewEdgeSnappedTile(draft, {
        parentTileId: anchor.tileId,
        parentEdge: anchor.edge,
        childShape: options.shape,
        childEdge,
        foldAngle: candidate,
        edgeAlign: "center",
        edgeOffset,
        reverse,
        color: options.color,
        role: "span panel"
      });
      if (!tile) continue;
      const blocker = ghostBlockedReason(draft, tile);
      if (blocker) {
        blockedReason = blocker;
        continue;
      }
      const match = findMagneticEdgeMatch(tile, targetTile);
      if (!match || match.fromEdge !== oppositeEdge || match.toEdge !== target.edge) continue;
      if (match.midpointDistance > SPAN_SEAT_TOLERANCE) continue;
      if (!best || match.midpointDistance < best.seatDistance) {
        best = {
          ok: true,
          tile,
          foldAngle: candidate,
          reverse,
          edgeOffset,
          oppositeEdge,
          seatDistance: Number(match.midpointDistance.toFixed(4))
        };
      }
    }
  }

  if (best) return best;
  return {
    ok: false,
    reason: blockedReason
      ? `No collision-free span: ${blockedReason}`
      : "The solved tile does not seat on the far edge within magnetic tolerance.",
    gap: Number(gap.toFixed(3))
  };
}

/**
 * Commit a solved span through addEdgeSnappedTile (the only write path) and record the
 * second magnetic joint to the target edge so the engine simulates both hinges.
 */
export function commitSpanPlacement(
  draft: AuthoredBuildDraft,
  anchor: SpanEdgeRef,
  target: SpanEdgeRef,
  solution: SpanSolution,
  options: { shape: TileShape; childEdge?: number; color: string }
): { draft: AuthoredBuildDraft; placedTileId: string | null } {
  const next = addEdgeSnappedTile(draft, {
    parentTileId: anchor.tileId,
    parentEdge: anchor.edge,
    childShape: options.shape,
    childEdge: options.childEdge ?? 0,
    foldAngle: solution.foldAngle,
    edgeAlign: "center",
    edgeOffset: solution.edgeOffset,
    reverse: solution.reverse,
    color: options.color,
    role: "span panel"
  });
  if (next.tiles.length === draft.tiles.length) {
    return { draft, placedTileId: null };
  }
  const placed = next.tiles[next.tiles.length - 1];
  const connected = withContactConnections(next, [placed.id]);
  return { draft: connected, placedTileId: placed.id };
}

/* ------------------------------------------------------------------ */

function worldEdgeOf(tile: BuilderTile, edge: number): { start: Vec3; end: Vec3 } {
  const vertices = builderTileWorldVertices(tile);
  return { start: vertices[edge % vertices.length], end: vertices[(edge + 1) % vertices.length] };
}

/** Perpendicular distance between two (parallel) local edges of a shape. */
function localEdgeSeparation(shape: TileShape, firstEdge: number, secondEdge: number): number {
  const vertices = tileLocalVertices(shape);
  const firstMid = midpoint(vertices[firstEdge], vertices[(firstEdge + 1) % vertices.length]);
  const secondMid = midpoint(vertices[secondEdge], vertices[(secondEdge + 1) % vertices.length]);
  const along = normalize(subtract(vertices[(firstEdge + 1) % vertices.length], vertices[firstEdge]));
  const offset = subtract(secondMid, firstMid);
  const lateral = subtract(offset, scale(along, dot(offset, along)));
  return magnitude(lateral);
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

function midpoint(first: Vec3, second: Vec3): Vec3 {
  return scale(add(first, second), 0.5);
}

function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  };
}

function magnitude(point: Vec3): number {
  return Math.sqrt(dot(point, point));
}

function normalize(point: Vec3): Vec3 {
  const length = magnitude(point);
  return length < 0.000001 ? { x: 0, y: 0, z: 0 } : scale(point, 1 / length);
}
