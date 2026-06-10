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
import { RAW_OVERLAP_TOLERANCE, overlapsInvolvingTile } from "@/lib/engine/overlap";
import { tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import { tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { magnetFractionsForLength, tileWorldMagnetPositions } from "@/lib/magnetic-tiles/magnets";
import type { TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import {
  addEdgeSnappedTile,
  addRootTile,
  createEmptyDraft,
  previewEdgeSnappedTile,
  refoldTile,
  type RootOrientation
} from "./operations";
import type { AuthoredBuildDraft, BuilderTile } from "./types";

/** Preset fold angles for the builder, in cycling order (Q steps left, E steps right). */
export const FOLD_CHOICES = [
  { label: "-90°", radians: -Math.PI / 2 },
  { label: "-45°", radians: -Math.PI / 4 },
  { label: "Flat", radians: 0 },
  { label: "+45°", radians: Math.PI / 4 },
  { label: "+90°", radians: Math.PI / 2 }
] as const;

/** Default to a +90° fold: on a flat parent tile this raises a wall, the classic first move. */
export const DEFAULT_FOLD_INDEX = 4;

/** The preset angles Q/E cycles through. */
export const PRESET_FOLDS: number[] = FOLD_CHOICES.map((choice) => choice.radians);

/** Fine fold step for Shift+Q/E: hinges are physically continuous, 5° is the manual grain. */
export const FINE_FOLD_STEP = Math.PI / 36;

/** Manual folds live in [-90°, +90°]; the span solver may produce angles beyond this. */
export const FOLD_LIMIT = Math.PI / 2;

/** All manually reachable fold angles: presets plus 5° fine steps across the range. */
export function candidateFoldAngles(): number[] {
  const angles: number[] = [];
  for (let step = -18; step <= 18; step += 1) {
    angles.push(step * FINE_FOLD_STEP);
  }
  return angles;
}

/** Human label for any fold angle ("Flat", "+45°", "+30°", "-5°"). */
export function foldLabel(angle: number): string {
  const degrees = Math.round((angle * 180) / Math.PI);
  if (degrees === 0) return "Flat";
  return `${degrees > 0 ? "+" : ""}${degrees}°`;
}

function sameAngle(first: number, second: number): boolean {
  return Math.abs(first - second) < 0.0001;
}

/** Grid used to tidy up the root-tile ground click. Half a small tile edge. */
export const ROOT_SNAP_GRID = SMALL_EDGE / 2;

export interface PlacementSettings {
  shape: TileShape;
  color: string;
  /** Fold angle in radians (continuous; presets plus 5° fine steps). */
  foldAngle: number;
  reverse: boolean;
  childEdge: number;
}

/**
 * Map the fold controls onto a root-tile orientation. The same Q/E angle set drives
 * both flows: Flat lays the tile down, intermediate angles lean it, ±90° stands it
 * upright on its edge. Negative angles lean/stand facing the opposite way, and R
 * (reverse) spins the tile 180° about the vertical axis. The root always rests ON the
 * ground (addRootTile computes the resting height), so no angle can penetrate the floor.
 */
export function rootOrientationFromSettings(
  settings: Pick<PlacementSettings, "foldAngle" | "reverse">
): RootOrientation {
  const standAngle = Math.abs(settings.foldAngle);
  const yaw = (settings.foldAngle < 0 ? Math.PI : 0) + (settings.reverse ? Math.PI : 0);
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
  /** The fold angle actually used (auto-selected to the nearest valid angle). */
  effectiveFoldAngle: number;
  /** True when the requested fold was blocked and a nearby valid angle was substituted. */
  autoAngled: boolean;
  /** True when NO candidate angle fits at this edge: quiet no-fit state, click does nothing. */
  noFit: boolean;
  reason?: string;
}

export function defaultPlacementSettings(): PlacementSettings {
  return {
    shape: "small-square",
    color: "#118ab2",
    foldAngle: Math.PI / 2,
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
 * Derive the live ghost tile for the hovered magnet — invalid options are never offered.
 *
 * A candidate is placeable only if it neither interpenetrates an existing tile nor dips
 * below the floor (builds sit on a table; a tile cannot fold down through it — this is a
 * builder-mode rule layered on top of, never instead of, the engine gate). Resolution
 * order, all deterministic:
 *   1. the requested fold at the requested edge direction;
 *   2. the requested fold with the edge direction flipped (autoFlipped);
 *   3. the NEAREST valid fold angle from the candidate set, either direction (autoAngled);
 *   4. nothing fits → quiet no-fit ghost (valid=false, noFit=true); clicking does nothing.
 */
export function deriveGhostPreview(
  draft: AuthoredBuildDraft,
  hover: MagnetHover | null,
  settings: PlacementSettings
): GhostPreview | null {
  if (!hover) return null;

  const attempt = (angle: number): GhostPreview | null => {
    const requested = previewWithReverse(draft, hover, settings, settings.reverse, angle);
    if (requested && !ghostBlockedReason(draft, requested)) {
      return {
        tile: requested,
        valid: true,
        effectiveReverse: settings.reverse,
        autoFlipped: false,
        effectiveFoldAngle: angle,
        autoAngled: !sameAngle(angle, settings.foldAngle),
        noFit: false
      };
    }
    const flipped = previewWithReverse(draft, hover, settings, !settings.reverse, angle);
    if (flipped && !ghostBlockedReason(draft, flipped)) {
      return {
        tile: flipped,
        valid: true,
        effectiveReverse: !settings.reverse,
        autoFlipped: true,
        effectiveFoldAngle: angle,
        autoAngled: !sameAngle(angle, settings.foldAngle),
        noFit: false
      };
    }
    return null;
  };

  const direct = attempt(settings.foldAngle);
  if (direct) return direct;

  // Nearest valid angle to the current one, deterministic tie-break toward positive.
  const ordered = candidateFoldAngles()
    .filter((angle) => !sameAngle(angle, settings.foldAngle))
    .sort(
      (first, second) =>
        Math.abs(first - settings.foldAngle) - Math.abs(second - settings.foldAngle) ||
        second - first
    );
  for (const angle of ordered) {
    const hit = attempt(angle);
    if (hit) return hit;
  }

  const shown =
    previewWithReverse(draft, hover, settings, settings.reverse, settings.foldAngle) ??
    previewWithReverse(draft, hover, settings, !settings.reverse, settings.foldAngle);
  if (!shown) return null;
  return {
    tile: shown,
    valid: false,
    effectiveReverse: settings.reverse,
    autoFlipped: false,
    effectiveFoldAngle: settings.foldAngle,
    autoAngled: false,
    noFit: true,
    reason: "No angle fits on this edge — every fold would collide."
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
): { draft: AuthoredBuildDraft; placedTileId: string | null; effectiveFoldAngle?: number } {
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
    foldAngle: ghost.effectiveFoldAngle,
    edgeFit: "auto",
    reverse: ghost.effectiveReverse,
    color: settings.color
  });
  if (next.tiles.length === draft.tiles.length) {
    return { draft, placedTileId: null };
  }
  return {
    draft: next,
    placedTileId: next.tiles[next.tiles.length - 1].id,
    effectiveFoldAngle: ghost.effectiveFoldAngle
  };
}

/* ------------------------------------------------------------------ */
/* Valid-angle filtering: Q/E and Shift+Q/E never land on a collision  */
/* ------------------------------------------------------------------ */

/** Where the fold controls currently aim: a magnet hover, open ground, or nothing. */
export type FoldContext =
  | { kind: "hover"; hover: MagnetHover }
  | { kind: "root"; point: { x: number; z: number } }
  | { kind: "free" };

/** True when the given fold angle yields a placeable result in this context. */
export function foldAngleValid(
  draft: AuthoredBuildDraft,
  context: FoldContext,
  settings: PlacementSettings,
  angle: number
): boolean {
  if (context.kind === "free") return true;
  if (context.kind === "root") {
    const ghost = deriveRootGhost(draft, { ...settings, foldAngle: angle }, context.point);
    return ghost !== null && ghost.valid;
  }
  const requested = previewWithReverse(draft, context.hover, settings, settings.reverse, angle);
  if (requested && !ghostBlockedReason(draft, requested)) return true;
  const flipped = previewWithReverse(draft, context.hover, settings, !settings.reverse, angle);
  return Boolean(flipped && !ghostBlockedReason(draft, flipped));
}

/** Every candidate fold angle that is currently placeable in this context. */
export function validFoldAngles(
  draft: AuthoredBuildDraft,
  context: FoldContext,
  settings: PlacementSettings
): number[] {
  return candidateFoldAngles().filter((angle) => foldAngleValid(draft, context, settings, angle));
}

/**
 * Cycle the fold angle, SKIPPING angles that would collide in the current context.
 * Presets (Q/E) wrap; fine steps (Shift+Q/E) clamp at ±90°. When the aimed context has
 * NO valid angle at all (a no-fit spot — clicking does nothing there anyway), cycling
 * falls back to unfiltered so the fold control never dead-locks.
 */
export function cycleFold(
  draft: AuthoredBuildDraft,
  context: FoldContext,
  settings: PlacementSettings,
  direction: 1 | -1,
  fine = false
): number {
  if (context.kind !== "free" && validFoldAngles(draft, context, settings).length === 0) {
    return cycleFold(draft, { kind: "free" }, settings, direction, fine);
  }
  if (!fine) {
    const count = PRESET_FOLDS.length;
    const nearest = PRESET_FOLDS.reduce(
      (best, angle, index) =>
        Math.abs(angle - settings.foldAngle) < Math.abs(PRESET_FOLDS[best] - settings.foldAngle)
          ? index
          : best,
      0
    );
    for (let step = 1; step <= count; step += 1) {
      const candidate = PRESET_FOLDS[normalizeIndex(nearest + step * direction, count)];
      if (sameAngle(candidate, settings.foldAngle)) continue;
      if (foldAngleValid(draft, context, settings, candidate)) return candidate;
    }
    return settings.foldAngle;
  }

  const snapped = Math.round(settings.foldAngle / FINE_FOLD_STEP) * FINE_FOLD_STEP;
  for (let step = 1; step <= 36; step += 1) {
    const candidate = snapped + step * direction * FINE_FOLD_STEP;
    if (candidate < -FOLD_LIMIT - 0.0001 || candidate > FOLD_LIMIT + 0.0001) break;
    if (sameAngle(candidate, settings.foldAngle)) continue;
    if (foldAngleValid(draft, context, settings, candidate)) return candidate;
  }
  return settings.foldAngle;
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
 * Place a tile on the ground at the clicked point, in the orientation chosen by the
 * fold controls (flat by default). The tile rests ON the ground in any orientation
 * (addRootTile computes the resting height from the prism geometry, so the floor is
 * never penetrated). Clicking open ground ALWAYS starts a new root there — multiple
 * disconnected grounded islands coexist; each new root opens a fresh island. The only
 * refusal is physical: a root that would interpenetrate an existing tile is not placed.
 */
export function placeRootOnGround(
  draft: AuthoredBuildDraft,
  input: {
    shape: TileShape;
    color: string;
    point: { x: number; z: number };
    foldAngle?: number;
    reverse?: boolean;
  }
): { draft: AuthoredBuildDraft; placedTileId: string | null; reason?: string } {
  const snapped = snapRootPosition(input.point);
  const orientation = rootOrientationFromSettings({
    foldAngle: input.foldAngle ?? 0,
    reverse: input.reverse ?? false
  });
  const islandIndex = draft.tiles.filter((tile) => tile.root).length + 1;
  const next = addRootTile(draft, {
    shape: input.shape,
    color: input.color,
    position: { x: snapped.x, y: 0, z: snapped.z },
    orientation,
    role: "root panel",
    subassemblyId: `island-${islandIndex}`
  });
  const placed = next.tiles[next.tiles.length - 1];
  if (overlapsInvolvingTile(placed.id, next.tiles).length > 0) {
    return { draft, placedTileId: null, reason: "A tile is already there." };
  }
  return { draft: next, placedTileId: placed.id };
}

/** Index of the "Flat" entry in FOLD_CHOICES. */
export const FLAT_FOLD_INDEX = FOLD_CHOICES.findIndex((choice) => choice.radians === 0);

export interface RootGhost {
  tile: BuilderTile;
  valid: boolean;
  reason?: string;
}

/**
 * Derive the root ghost: the exact tile a ground click would place right now, with its
 * placeability. WYSIWYG by construction — it runs the same placeRootOnGround the click
 * runs (on a scratch copy), so ghost geometry and committed geometry cannot diverge.
 */
export function deriveRootGhost(
  draft: AuthoredBuildDraft,
  settings: PlacementSettings,
  point: { x: number; z: number } | null
): RootGhost | null {
  if (!point) return null;
  const result = placeRootOnGround(draft, {
    shape: settings.shape,
    color: settings.color,
    point,
    foldAngle: settings.foldAngle,
    reverse: settings.reverse
  });
  if (result.placedTileId) {
    return { tile: result.draft.tiles[result.draft.tiles.length - 1], valid: true };
  }
  // Rebuild the refused candidate on an empty draft so the no-fit ghost still shows.
  const scratch = placeRootOnGround(createEmptyDraft("root-ghost"), {
    shape: settings.shape,
    color: settings.color,
    point,
    foldAngle: settings.foldAngle,
    reverse: settings.reverse
  });
  const tile = scratch.draft.tiles[0];
  if (!tile) return null;
  return { tile, valid: false, reason: result.reason ?? "A tile is already there." };
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
    foldAngle: settings.foldAngle,
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

/* ------------------------------------------------------------------ */
/* Selection re-fold (Q/E on a selected tile, collision-filtered)      */
/* ------------------------------------------------------------------ */

/** True when the selected tile can be re-folded live (non-root with a full hinge record). */
export function canRefoldTile(draft: AuthoredBuildDraft, tileId: string | null): boolean {
  if (!tileId) return false;
  const tile = draft.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || !tile.parentTileId || tile.parentEdge === undefined || tile.childEdge === undefined) {
    return false;
  }
  return refoldTile(draft, tileId, tile.foldAngle ?? 0) !== null;
}

/** Candidate angles at which the selected tile's subtree re-derives without collision. */
export function validRefoldAngles(draft: AuthoredBuildDraft, tileId: string): number[] {
  return candidateFoldAngles().filter((angle) => refoldTile(draft, tileId, angle) !== null);
}

/**
 * Cycle the selected tile's fold angle through presets (or 5° fine steps), skipping
 * collision-invalid angles. Returns the updated draft, or null when no other valid
 * angle exists in that direction.
 */
export function cycleRefold(
  draft: AuthoredBuildDraft,
  tileId: string,
  direction: 1 | -1,
  fine = false
): { draft: AuthoredBuildDraft; foldAngle: number } | null {
  const tile = draft.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.foldAngle === undefined) return null;
  const current = tile.foldAngle;

  if (!fine) {
    const count = PRESET_FOLDS.length;
    const nearest = PRESET_FOLDS.reduce(
      (best, angle, index) =>
        Math.abs(angle - current) < Math.abs(PRESET_FOLDS[best] - current) ? index : best,
      0
    );
    for (let step = 1; step <= count; step += 1) {
      const candidate = PRESET_FOLDS[normalizeIndex(nearest + step * direction, count)];
      if (sameAngle(candidate, current)) continue;
      const next = refoldTile(draft, tileId, candidate);
      if (next) return { draft: next, foldAngle: candidate };
    }
    return null;
  }

  const snapped = Math.round(current / FINE_FOLD_STEP) * FINE_FOLD_STEP;
  for (let step = 1; step <= 36; step += 1) {
    const candidate = snapped + step * direction * FINE_FOLD_STEP;
    if (candidate < -FOLD_LIMIT - 0.0001 || candidate > FOLD_LIMIT + 0.0001) break;
    if (sameAngle(candidate, current)) continue;
    const next = refoldTile(draft, tileId, candidate);
    if (next) return { draft: next, foldAngle: candidate };
  }
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
  reverse: boolean,
  foldAngle = settings.foldAngle
): BuilderTile | null {
  return previewEdgeSnappedTile(draft, {
    parentTileId: hover.tileId,
    parentEdge: hover.edge,
    parentMagnetT: hover.t,
    childShape: settings.shape,
    childEdge: settings.childEdge,
    foldAngle,
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
    return "That fold would push the tile through the floor.";
  }
  // Targeted ghost-vs-existing check (same tolerance as the write-path guard, but it
  // skips the existing-vs-existing pairs, which cannot have changed).
  for (const tile of draft.tiles) {
    const intersection = tilesIntersectAsPrisms(ghost, tile);
    if (intersection.overlaps && intersection.penetration > RAW_OVERLAP_TOLERANCE) {
      return "Tiles would overlap here.";
    }
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
