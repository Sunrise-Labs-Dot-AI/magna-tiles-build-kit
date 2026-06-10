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
import { tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { magnetFractionsForLength, tileWorldMagnetPositions } from "@/lib/magnetic-tiles/magnets";
import type { TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import {
  addEdgeSnappedTile,
  addRootTile,
  createEmptyDraft,
  previewEdgeSnappedTile,
  type RootOrientation
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

/**
 * Map the fold controls onto a root-tile orientation. The same Q/E angle set drives
 * both flows: Flat lays the tile down, ±45° leans it, ±90° stands it upright on its
 * edge. Negative angles lean/stand facing the opposite way, and R (reverse) spins the
 * tile 180° about the vertical axis. Everything stays angle-snapped: the only inputs
 * are the five fold choices and a boolean flip.
 */
export function rootOrientationFromSettings(
  settings: Pick<PlacementSettings, "foldIndex" | "reverse">
): RootOrientation {
  const fold = foldAngleFromIndex(settings.foldIndex);
  const standAngle = Math.abs(fold);
  const yaw = (fold < 0 ? Math.PI : 0) + (settings.reverse ? Math.PI : 0);
  return { standAngle, yaw };
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
 * Place the first tile on the ground at the clicked point, in the orientation chosen by
 * the fold controls (flat by default — callers that omit foldIndex keep the old flat
 * behavior). The tile rests on the ground in any orientation; addRootTile computes the
 * resting height from the prism geometry. Only legal on an empty draft: every later
 * tile must edge-snap to an existing one.
 */
export function placeRootOnGround(
  draft: AuthoredBuildDraft,
  input: {
    shape: TileShape;
    color: string;
    point: { x: number; z: number };
    foldIndex?: number;
    reverse?: boolean;
  }
): { draft: AuthoredBuildDraft; placedTileId: string | null } {
  if (draft.tiles.length > 0) {
    return { draft, placedTileId: null };
  }
  const snapped = snapRootPosition(input.point);
  const orientation = rootOrientationFromSettings({
    foldIndex: input.foldIndex ?? FLAT_FOLD_INDEX,
    reverse: input.reverse ?? false
  });
  const next = addRootTile(draft, {
    shape: input.shape,
    color: input.color,
    position: { x: snapped.x, y: 0, z: snapped.z },
    orientation,
    role: "root panel",
    subassemblyId: "body"
  });
  return { draft: next, placedTileId: next.tiles[next.tiles.length - 1].id };
}

/** Index of the "Flat" entry in FOLD_CHOICES. */
export const FLAT_FOLD_INDEX = FOLD_CHOICES.findIndex((choice) => choice.radians === 0);

/**
 * Derive the root ghost: the exact tile a ground click would place right now.
 * WYSIWYG by construction — it runs the same placeRootOnGround the click runs.
 */
export function deriveRootGhost(
  draft: AuthoredBuildDraft,
  settings: PlacementSettings,
  point: { x: number; z: number } | null
): BuilderTile | null {
  if (!point || draft.tiles.length > 0) return null;
  const { draft: next } = placeRootOnGround(draft, {
    shape: settings.shape,
    color: settings.color,
    point,
    foldIndex: settings.foldIndex,
    reverse: settings.reverse
  });
  return next.tiles[0] ?? null;
}

/**
 * Derive the canonical "tile in hand": the held tile at the grid origin, oriented per
 * the current fold/flip controls and resting on the ground. The canvas offsets this
 * tile to follow the cursor; on an empty draft it is exactly the root ghost at (0,0).
 */
export function deriveHandTile(settings: PlacementSettings): BuilderTile {
  const { draft } = placeRootOnGround(createEmptyDraft("hand"), {
    shape: settings.shape,
    color: settings.color,
    point: { x: 0, z: 0 },
    foldIndex: settings.foldIndex,
    reverse: settings.reverse
  });
  return { ...draft.tiles[0], id: "hand-ghost" };
}

/* ------------------------------------------------------------------ */
/* Cursor-proximity snapping (the anti-flicker hover model)            */
/* ------------------------------------------------------------------ */

/**
 * Hover is derived from the cursor's world position — never from pointerenter/leave on
 * tiny meshes. The cursor within SNAP_RADIUS of a snap point acquires it; once held, the
 * hover survives until the cursor moves beyond SNAP_RELEASE_RADIUS (hysteresis), so a
 * ghost can't oscillate on micro-movements at the boundary.
 */
export const SNAP_RADIUS = 1.6;
export const SNAP_RELEASE_RADIUS = 2.3;

export interface SnapPoint {
  hover: MagnetHover;
  position: Vec3;
}

/** Stable identity for a hover target, for change detection. */
export function hoverKey(hover: MagnetHover | null): string {
  if (!hover) return "";
  return `${hover.tileId}:${hover.edge}:${hover.magnetIndex ?? "bar"}`;
}

/**
 * Every snappable point on the draft: each magnet pair on every edge, plus the edge
 * midpoint (the old edge-bar target). All placement still flows through the
 * edge-attachment APIs; these are only hover candidates.
 */
export function collectSnapPoints(draft: AuthoredBuildDraft): SnapPoint[] {
  return draft.tiles.flatMap((tile) => {
    const magnets = builderTileMagnetWorldPoints(tile).map((magnet) => ({
      hover: { tileId: tile.id, edge: magnet.edgeIndex, magnetIndex: magnet.magnetIndex, t: magnet.t },
      position: magnet.position
    }));
    const vertices = builderTileWorldVertices(tile);
    const midpoints = vertices.map((start, edgeIndex) => {
      const end = vertices[(edgeIndex + 1) % vertices.length];
      return {
        hover: { tileId: tile.id, edge: edgeIndex, t: 0.5 },
        position: {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
          z: (start.z + end.z) / 2
        }
      };
    });
    return [...magnets, ...midpoints];
  });
}

/**
 * Resolve the hover for the current cursor position with hysteresis. Pure and
 * deterministic: same cursor + same current hover → same answer.
 */
export function resolveSnapHover(
  points: SnapPoint[],
  cursor: Vec3 | null,
  current: MagnetHover | null
): MagnetHover | null {
  if (!cursor) return null;

  let best: SnapPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let currentDistance = Number.POSITIVE_INFINITY;
  const currentKey = hoverKey(current);
  for (const point of points) {
    const d = distance3(point.position, cursor);
    if (d < bestDistance) {
      best = point;
      bestDistance = d;
    }
    if (currentKey && hoverKey(point.hover) === currentKey) {
      currentDistance = d;
    }
  }

  if (best && bestDistance <= SNAP_RADIUS) return best.hover;
  if (current && currentDistance <= SNAP_RELEASE_RADIUS) return current;
  return null;
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

/* ------------------------------------------------------------------ */
/* Builder tile geometry (sizeOverride-aware), shared with the canvas  */
/* ------------------------------------------------------------------ */

/** Local polygon vertices, honoring a reference-encoder sizeOverride. */
export function builderTileLocalVertices(tile: {
  shape: TileShape;
  sizeOverride?: BuilderTile["sizeOverride"];
}): Vec3[] {
  if (!tile.sizeOverride) return tileLocalVertices(tile.shape);
  const halfW = tile.sizeOverride.width / 2;
  const halfH = tile.sizeOverride.height / 2;

  if (TILE_SPECS[tile.shape].maxEdges === 4) {
    return [
      { x: -halfW, y: -halfH, z: 0 },
      { x: halfW, y: -halfH, z: 0 },
      { x: halfW, y: halfH, z: 0 },
      { x: -halfW, y: halfH, z: 0 }
    ];
  }

  if (tile.shape === "right-triangle") {
    return [
      { x: -halfW, y: -halfH, z: 0 },
      { x: halfW, y: -halfH, z: 0 },
      { x: -halfW, y: halfH, z: 0 }
    ];
  }

  return [
    { x: -halfW, y: -halfH, z: 0 },
    { x: halfW, y: -halfH, z: 0 },
    { x: 0, y: halfH, z: 0 }
  ];
}

/** World polygon vertices, honoring sizeOverride. */
export function builderTileWorldVertices(tile: BuilderTile): Vec3[] {
  if (!tile.sizeOverride) return tileWorldVertices(tile);
  return builderTileLocalVertices(tile).map((point) => transformBuilderPoint(point, tile));
}

/** World magnet points for a builder tile, honoring sizeOverride. */
export function builderTileMagnetWorldPoints(
  tile: BuilderTile
): Array<{ edgeIndex: number; magnetIndex: number; position: Vec3; t: number }> {
  if (!tile.sizeOverride) {
    return tileWorldMagnetPositions(tile).map((magnet) => ({
      edgeIndex: magnet.edgeIndex,
      magnetIndex: magnet.magnetIndex,
      t: magnet.fraction,
      position: magnet.worldPoint
    }));
  }

  const vertices = builderTileWorldVertices(tile);
  return vertices.flatMap((start, edgeIndex) => {
    const end = vertices[(edgeIndex + 1) % vertices.length];
    const length = distance3(start, end);
    return magnetFractionsForLength(length).map((t, magnetIndex) => ({
      edgeIndex,
      magnetIndex,
      t,
      position: {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t
      }
    }));
  });
}

/** Apply a builder tile's basis (or Euler rotation) + position to a local point. */
export function transformBuilderPoint(point: Vec3, tile: BuilderTile): Vec3 {
  if (tile.basis) {
    return {
      x: tile.basis.xAxis.x * point.x + tile.basis.yAxis.x * point.y + tile.basis.zAxis.x * point.z + tile.position.x,
      y: tile.basis.xAxis.y * point.x + tile.basis.yAxis.y * point.y + tile.basis.zAxis.y * point.z + tile.position.y,
      z: tile.basis.xAxis.z * point.x + tile.basis.yAxis.z * point.y + tile.basis.zAxis.z * point.z + tile.position.z
    };
  }

  const cosZ = Math.cos(tile.rotation.z);
  const sinZ = Math.sin(tile.rotation.z);
  const zRotated = {
    x: point.x * cosZ - point.y * sinZ,
    y: point.x * sinZ + point.y * cosZ,
    z: point.z
  };
  const cosY = Math.cos(tile.rotation.y);
  const sinY = Math.sin(tile.rotation.y);
  const yRotated = {
    x: zRotated.x * cosY + zRotated.z * sinY,
    y: zRotated.y,
    z: -zRotated.x * sinY + zRotated.z * cosY
  };
  const cosX = Math.cos(tile.rotation.x);
  const sinX = Math.sin(tile.rotation.x);
  return {
    x: yRotated.x + tile.position.x,
    y: yRotated.y * cosX - yRotated.z * sinX + tile.position.y,
    z: yRotated.y * sinX + yRotated.z * cosX + tile.position.z
  };
}

function distance3(first: Vec3, second: Vec3): number {
  return Math.sqrt(
    (first.x - second.x) ** 2 + (first.y - second.y) ** 2 + (first.z - second.z) ** 2
  );
}
