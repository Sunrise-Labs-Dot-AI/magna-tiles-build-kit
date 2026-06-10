/**
 * Pure placement state machine for the Minecraft-like builder experience.
 *
 * Every placement here flows through the edge-attachment APIs in
 * lib/builder/operations.ts (previewEdgeSnappedTile / addEdgeSnappedTile / addRootTile),
 * so overlap stays impossible by construction. This module never positions a tile by
 * free coordinates: the only coordinate input is the sanctioned root-tile ground click,
 * which is restricted to an empty draft.
 */
import { SMALL_EDGE, TILE_SPECS, TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";
import { overlapsInvolvingTile } from "@/lib/engine/overlap";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import {
  addEdgeSnappedTile,
  addRootTile,
  previewEdgeSnappedTile
} from "./operations";
import type { AuthoredBuildDraft, BuilderTile } from "./types";

/** Valid fold angles for the builder, in cycling order (Q steps left, E steps right). */
export const FOLD_CHOICES = [
  { label: "-90°", radians: -Math.PI / 2 },
  { label: "-45°", radians: -Math.PI / 4 },
  { label: "Flat", radians: 0 },
  { label: "+45°", radians: Math.PI / 4 },
  { label: "+90°", radians: Math.PI / 2 }
] as const;

/** Default to a +90° fold: on a flat parent tile this raises a wall, the classic first move. */
export const DEFAULT_FOLD_INDEX = 4;

/** Grid used to tidy up the root-tile ground click. Half a small tile edge. */
export const ROOT_SNAP_GRID = SMALL_EDGE / 2;

export interface PlacementSettings {
  shape: TileShape;
  color: string;
  foldIndex: number;
  reverse: boolean;
  childEdge: number;
}

/** The magnet dot (or edge) currently hovered in the canvas. */
export interface MagnetHover {
  tileId: string;
  edge: number;
  magnetIndex?: number;
  t?: number;
}

export interface GhostPreview {
  tile: BuilderTile;
  valid: boolean;
  /** The reverse value actually used (may differ from settings when auto-resolved). */
  effectiveReverse: boolean;
  /** True when the requested orientation overlapped and flipping reverse fixed it. */
  autoFlipped: boolean;
  reason?: string;
}

export function defaultPlacementSettings(): PlacementSettings {
  return {
    shape: "small-square",
    color: "#118ab2",
    foldIndex: DEFAULT_FOLD_INDEX,
    reverse: false,
    childEdge: 0
  };
}

export function foldAngleFromIndex(foldIndex: number): number {
  return FOLD_CHOICES[normalizeIndex(foldIndex, FOLD_CHOICES.length)].radians;
}

export function foldLabelFromIndex(foldIndex: number): string {
  return FOLD_CHOICES[normalizeIndex(foldIndex, FOLD_CHOICES.length)].label;
}

/** Cycle the fold angle through the valid options, wrapping at both ends. */
export function cycleFoldIndex(current: number, direction: 1 | -1): number {
  return normalizeIndex(current + direction, FOLD_CHOICES.length);
}

/** Cycle which child edge attaches, wrapping at the shape's edge count. */
export function cycleChildEdge(shape: TileShape, current: number, direction: 1 | -1): number {
  return normalizeIndex(current + direction, TILE_SPECS[shape].maxEdges);
}

/** Keep the child edge in range when the selected shape changes. */
export function clampChildEdge(shape: TileShape, edge: number): number {
  const max = TILE_SPECS[shape].maxEdges;
  return edge >= 0 && edge < max ? edge : 0;
}

/**
 * Derive the live ghost tile for the hovered magnet.
 *
 * A candidate is placeable only if it neither interpenetrates an existing tile nor dips
 * below the floor (builds sit on a table; a tile cannot fold down through it — this is a
 * builder-mode rule layered on top of, never instead of, the engine gate). If the
 * requested orientation is blocked but flipping the edge direction works, the flipped
 * orientation is used (autoFlipped) so the common "extend outward" case just works.
 * If neither orientation is physically possible the ghost is returned with valid=false
 * so the UI can paint it as blocked.
 */
export function deriveGhostPreview(
  draft: AuthoredBuildDraft,
  hover: MagnetHover | null,
  settings: PlacementSettings
): GhostPreview | null {
  if (!hover) return null;

  const requested = previewWithReverse(draft, hover, settings, settings.reverse);
  if (requested && !ghostBlockedReason(draft, requested)) {
    return { tile: requested, valid: true, effectiveReverse: settings.reverse, autoFlipped: false };
  }

  const flipped = previewWithReverse(draft, hover, settings, !settings.reverse);
  if (flipped && !ghostBlockedReason(draft, flipped)) {
    return { tile: flipped, valid: true, effectiveReverse: !settings.reverse, autoFlipped: true };
  }

  const shown = requested ?? flipped;
  if (!shown) return null;
  return {
    tile: shown,
    valid: false,
    effectiveReverse: settings.reverse,
    autoFlipped: false,
    reason: ghostBlockedReason(draft, shown) ?? "Tiles would overlap here."
  };
}

/**
 * Confirm the ghost: place the tile through addEdgeSnappedTile (the only write path).
 * Returns the unchanged draft and a null id when the placement is blocked.
 */
export function confirmGhostPlacement(
  draft: AuthoredBuildDraft,
  hover: MagnetHover | null,
  settings: PlacementSettings
): { draft: AuthoredBuildDraft; placedTileId: string | null } {
  const ghost = deriveGhostPreview(draft, hover, settings);
  if (!hover || !ghost || !ghost.valid) {
    return { draft, placedTileId: null };
  }

  const next = addEdgeSnappedTile(draft, {
    parentTileId: hover.tileId,
    parentEdge: hover.edge,
    parentMagnetT: hover.t,
    childShape: settings.shape,
    childEdge: settings.childEdge,
    foldAngle: foldAngleFromIndex(settings.foldIndex),
    edgeFit: "auto",
    reverse: ghost.effectiveReverse,
    color: settings.color
  });
  if (next.tiles.length === draft.tiles.length) {
    return { draft, placedTileId: null };
  }
  return { draft: next, placedTileId: next.tiles[next.tiles.length - 1].id };
}

/** Snap a ground click to a tidy grid for the root tile. */
export function snapRootPosition(point: { x: number; z: number }, grid = ROOT_SNAP_GRID): Vec3 {
  return {
    x: Math.round(point.x / grid) * grid,
    y: TILE_THICKNESS / 2,
    z: Math.round(point.z / grid) * grid
  };
}

/**
 * Place the first tile flat on the ground at the clicked point.
 * Only legal on an empty draft: every later tile must edge-snap to an existing one.
 */
export function placeRootOnGround(
  draft: AuthoredBuildDraft,
  input: { shape: TileShape; color: string; point: { x: number; z: number } }
): { draft: AuthoredBuildDraft; placedTileId: string | null } {
  if (draft.tiles.length > 0) {
    return { draft, placedTileId: null };
  }
  const next = addRootTile(draft, {
    shape: input.shape,
    color: input.color,
    position: snapRootPosition(input.point),
    flat: true,
    role: "root panel",
    subassemblyId: "body"
  });
  return { draft: next, placedTileId: next.tiles[next.tiles.length - 1].id };
}

/**
 * Collect a tile and every descendant attached through it (parentTileId chain).
 * Deleting a mid-structure tile would orphan its children's attachment lineage, so the
 * builder always deletes the whole subtree, with the count surfaced as an affordance.
 */
export function collectTileSubtree(draft: AuthoredBuildDraft, tileId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const tile of draft.tiles) {
    if (!tile.parentTileId) continue;
    const siblings = childrenByParent.get(tile.parentTileId) ?? [];
    siblings.push(tile.id);
    childrenByParent.set(tile.parentTileId, siblings);
  }

  if (!draft.tiles.some((tile) => tile.id === tileId)) return [];

  const ordered: string[] = [];
  const queue = [tileId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    ordered.push(current);
    for (const child of childrenByParent.get(current) ?? []) {
      queue.push(child);
    }
  }
  return ordered;
}

function previewWithReverse(
  draft: AuthoredBuildDraft,
  hover: MagnetHover,
  settings: PlacementSettings,
  reverse: boolean
): BuilderTile | null {
  return previewEdgeSnappedTile(draft, {
    parentTileId: hover.tileId,
    parentEdge: hover.edge,
    parentMagnetT: hover.t,
    childShape: settings.shape,
    childEdge: settings.childEdge,
    foldAngle: foldAngleFromIndex(settings.foldIndex),
    edgeFit: "auto",
    reverse,
    color: settings.color
  });
}

/** How far below the table a ghost vertex may sit before the placement is rejected. */
const FLOOR_EPSILON = 0.05;

/** Returns a human-readable blocker, or null when the ghost is placeable. */
export function ghostBlockedReason(draft: AuthoredBuildDraft, ghost: BuilderTile): string | null {
  if (tileWorldVertices(ghost).some((vertex) => vertex.y < -FLOOR_EPSILON)) {
    return "That fold would push the tile through the floor. Q/E changes the fold angle.";
  }
  if (overlapsInvolvingTile(ghost.id, [...draft.tiles, ghost]).length > 0) {
    return "Tiles would overlap here. Try Q/E to change the fold, or T for another edge.";
  }
  return null;
}

function normalizeIndex(value: number, length: number): number {
  return ((value % length) + length) % length;
}
