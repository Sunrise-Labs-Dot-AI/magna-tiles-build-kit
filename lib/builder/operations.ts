import { SHAPE_ORDER, SMALL_EDGE, TILE_SPECS, TILE_THICKNESS, emptyInventory } from "@/lib/magnetic-tiles/catalog";
import { attachTile, basisFromEuler, identityBasis, makeAnchorTile, worldEdge, type EdgePlacedTile } from "@/lib/magnetic-tiles/edge-attachment";
import { assertNoRawOverlaps, overlapsInvolvingTile } from "@/lib/engine/overlap";
import {
  connectionWithMagneticEdges,
  findMagneticEdgeMatch,
  tileLocalVertices,
  tileWorldVertices
} from "@/lib/magnetic-tiles/magnet-geometry";
import { tilePrismVertices, tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type {
  BuildBounds,
  BuildFamily,
  BuildGraph,
  GeneratedBuildResponse,
  Inventory,
  MagneticConnection,
  Rotation,
  TileBasis,
  TileShape,
  Vec3
} from "@/lib/magnetic-tiles/types";
import type {
  AuthoredBuildDraft,
  BuilderDraftStatus,
  BuilderTile,
  ReviewReadinessReport
} from "./types";

const SNAP_FOLDS = [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI / 3, -Math.PI / 3];
/** The Magna-Tiles classic palette used across the app (blue, yellow, green, magenta, purple, ice). */
export const CLASSIC_TILE_COLORS = ["#118ab2", "#ffb703", "#06d6a0", "#ef476f", "#7b2cbf", "#8ecae6"];
const COLORS = CLASSIC_TILE_COLORS;

export type EdgeFitMode = "auto" | "flush" | "magnet-overlap";

export interface EdgeSnapInput {
  parentTileId: string;
  parentEdge: number;
  parentMagnetT?: number;
  childShape: TileShape;
  childEdge: number;
  foldAngle: number;
  edgeFit?: EdgeFitMode;
  reverse?: boolean;
  /** Explicit edge alignment (used by the span solver and re-fold); wins over edgeFit. */
  edgeAlign?: "start" | "center";
  edgeOffset?: number;
  color?: string;
  role?: string;
  subassemblyId?: string;
  step?: number;
}

export function createEmptyDraft(title = "Untitled Build"): AuthoredBuildDraft {
  const now = new Date().toISOString();
  return {
    id: slugify(title) || "untitled-build",
    title,
    prompt: title,
    family: "house",
    inventoryPreset: "classic-100",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    referenceFrameSrcs: [],
    visualSignoff: false,
    tiles: [],
    connections: []
  };
}

export function createDraftFromGenerated(
  response: GeneratedBuildResponse,
  options: {
    id?: string;
    status?: BuilderDraftStatus;
    referenceFrameSrcs?: string[];
    visualSignoff?: boolean;
  } = {}
): AuthoredBuildDraft {
  const now = new Date().toISOString();
  return {
    id: options.id ?? response.build.id.replace(/^build-/, ""),
    title: response.build.title,
    prompt: response.build.prompt,
    family: response.build.family,
    inventoryPreset: response.build.inventoryPreset ?? "classic-100",
    status: options.status ?? "draft",
    createdAt: now,
    updatedAt: now,
    expectedInventory: response.validation.usedInventory,
    referenceFrameSrcs: options.referenceFrameSrcs ?? [],
    visualSignoff: options.visualSignoff ?? false,
    tiles: response.build.tiles.map((tile) => ({
      ...tile,
      authoredMode: tile.parentTileId || tile.root ? "edge-snap" : "freeform",
      confirmed: Boolean(tile.parentTileId || tile.root)
    })),
    connections: response.build.connections
  };
}

export function draftToBuildGraph(draft: AuthoredBuildDraft): BuildGraph {
  const tiles = draft.tiles.map(builderTileToTile);
  return {
    id: `draft-${draft.id}`,
    prompt: draft.prompt,
    title: draft.title,
    family: draft.family,
    inventoryPreset: draft.inventoryPreset,
    seed: 0,
    summary: `${draft.title} authored in the build workbench.`,
    tiles,
    connections: draft.connections,
    bounds: calculateBounds(tiles)
  };
}

/**
 * Assemble a build graph and REFUSE to produce one whose tiles physically interpenetrate.
 *
 * Physical magnetic tiles cannot occupy the same space, so an overlapping build is not a valid
 * build at all. `draftToBuildGraph` stays lenient for in-progress authoring/rendering; this strict
 * path is the hard boundary used wherever a build is treated as real (publish, library validity,
 * tests). It throws `RawOverlapError` listing the offending pairs rather than silently emitting a
 * geometrically impossible build.
 */
export function assembleBuildGraph(
  draft: AuthoredBuildDraft,
  options: { strict?: boolean } = {}
): BuildGraph {
  const graph = draftToBuildGraph(draft);
  if (options.strict !== false) {
    assertNoRawOverlaps(graph.tiles);
  }
  return graph;
}

/**
 * Snapped root-tile orientation: how the first tile meets the ground.
 * - standAngle: radians up from the ground plane — 0 lays the tile flat (normal up),
 *   PI/4 leans it, PI/2 stands it upright on its bottom edge.
 * - yaw: rotation about the world Y axis (multiples of PI from the placement flow).
 * No free rotation: callers derive these from the discrete fold/flip controls.
 */
export interface RootOrientation {
  standAngle: number;
  yaw: number;
}

/** Basis for a root orientation: world = Ry(yaw) ∘ Rx(standAngle - PI/2) on an upright tile. */
export function rootOrientationBasis(orientation: RootOrientation): TileBasis {
  const theta = orientation.standAngle - Math.PI / 2;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cosY = Math.cos(orientation.yaw);
  const sinY = Math.sin(orientation.yaw);
  return {
    xAxis: { x: cosY, y: 0, z: -sinY },
    yAxis: { x: sinT * sinY, y: cosT, z: sinT * cosY },
    zAxis: { x: cosT * sinY, y: -sinT, z: cosT * cosY }
  };
}

/** Center height at which a tile with this basis rests exactly on the ground plane. */
export function rootRestingHeight(shape: TileShape, basis: TileBasis): number {
  const probe: BuilderTile = {
    id: "resting-probe",
    shape,
    color: "#000000",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    basis,
    step: 1,
    role: "probe",
    authoredMode: "edge-snap",
    confirmed: false
  };
  const minY = Math.min(...tilePrismVertices(probe, TILE_THICKNESS).map((point) => point.y));
  return -minY;
}

export function addRootTile(
  draft: AuthoredBuildDraft,
  input: {
    shape: TileShape;
    color?: string;
    position?: Vec3;
    role?: string;
    subassemblyId?: string;
    step?: number;
    /** Lay the root tile flat on the ground plane (normal up) instead of standing upright. */
    flat?: boolean;
    /**
     * Snapped ground orientation (flat / leaning / standing). When given, it wins over
     * `flat`, and the tile's y is recomputed so the prism rests exactly on the ground
     * (input.position supplies only x/z).
     */
    orientation?: RootOrientation;
  }
): AuthoredBuildDraft {
  const key = nextTileId(draft, input.shape);
  const defaultPosition = input.flat
    ? { x: 0, y: TILE_THICKNESS / 2, z: 0 }
    : { x: 0, y: TILE_SPECS[input.shape].height / 2, z: 0 };
  const basis = input.orientation
    ? rootOrientationBasis(input.orientation)
    : input.flat
      ? basisFromEuler(-Math.PI / 2, 0, 0)
      : identityBasis();
  const requestedPosition = input.position ?? defaultPosition;
  const position = input.orientation
    ? { x: requestedPosition.x, y: rootRestingHeight(input.shape, basis), z: requestedPosition.z }
    : requestedPosition;
  const placed = makeAnchorTile(
    key,
    input.shape,
    position,
    basis,
    input.step ?? 1,
    input.role ?? "root panel",
    input.color ?? COLORS[draft.tiles.length % COLORS.length]
  );

  return touch({
    ...draft,
    tiles: [
      ...draft.tiles,
      {
        ...edgePlacedToBuilderTile(placed),
        subassemblyId: input.subassemblyId,
        authoredMode: "edge-snap",
        confirmed: true
      }
    ]
  });
}

export function previewEdgeSnappedTile(
  draft: AuthoredBuildDraft,
  input: EdgeSnapInput
): BuilderTile | null {
  const parent = draft.tiles.find((tile) => tile.id === input.parentTileId);
  if (!parent) return null;
  const placedParent = tileToEdgePlaced(parent);
  const alignment = resolveEdgeAlignment(placedParent, input);

  const placed = attachTile(placedParent, {
    key: nextTileId(draft, input.childShape),
    shape: input.childShape,
    attachTo: parent.id,
    parentEdge: input.parentEdge,
    childEdge: input.childEdge,
    foldAngle: input.foldAngle,
    edgeAlign: alignment.edgeAlign,
    edgeOffset: alignment.edgeOffset,
    reverse: input.reverse,
    color: input.color ?? COLORS[draft.tiles.length % COLORS.length],
    step: input.step ?? parent.step,
    role: input.role ?? `${TILE_SPECS[input.childShape].shortLabel.toLowerCase()} attached panel`,
    subassemblyId: input.subassemblyId ?? parent.subassemblyId
  });

  return {
    ...edgePlacedToBuilderTile(placed),
    authoredMode: "edge-snap",
    confirmed: true
  };
}

export function addEdgeSnappedTile(
  draft: AuthoredBuildDraft,
  input: EdgeSnapInput
): AuthoredBuildDraft {
  const tile = previewEdgeSnappedTile(draft, input);
  if (!tile) return draft;

  // Construction-time guard: a derived edge-snap must never interpenetrate an existing tile.
  // If this placement would overlap (a bad edge/fold choice), refuse it instead of producing a
  // geometrically impossible draft. Face-to-face contact with the parent is below the hairline.
  if (overlapsInvolvingTile(tile.id, [...draft.tiles, tile]).length > 0) {
    return draft;
  }

  return touch({
    ...draft,
    tiles: [...draft.tiles, tile],
    connections: [
      ...draft.connections,
      {
        fromTileId: input.parentTileId,
        fromEdge: input.parentEdge,
        toTileId: tile.id,
        toEdge: input.childEdge,
        kind: "edge"
      }
    ]
  });
}

function resolveEdgeAlignment(
  parent: EdgePlacedTile,
  input: EdgeSnapInput
): { edgeAlign?: "start" | "center"; edgeOffset?: number } {
  if (input.edgeAlign !== undefined) {
    return { edgeAlign: input.edgeAlign, edgeOffset: input.edgeOffset };
  }
  if (input.edgeFit === "flush" || input.parentMagnetT === undefined) {
    return {};
  }

  const parentEdge = worldEdge(parent, input.parentEdge);
  const parentLength = distance(parentEdge.start, parentEdge.end);
  const childLength = localEdgeLength(input.childShape, input.childEdge);
  const directedMagnetT = input.reverse ? 1 - input.parentMagnetT : input.parentMagnetT;
  const flatJoin = Math.abs(Math.sin(input.foldAngle)) < 0.08;
  const alignToClickedMagnet =
    input.edgeFit === "magnet-overlap" ||
    !flatJoin ||
    parentLength > childLength + 0.4;

  if (!alignToClickedMagnet) {
    return {};
  }

  return {
    edgeAlign: "center",
    edgeOffset: (directedMagnetT - 0.5) * parentLength
  };
}

/**
 * Re-fold a non-root tile around its existing hinge. The tile and its whole attached
 * subtree re-derive through the edge-attachment math (attachTile) at the new angle, so
 * overlap stays impossible by construction: any angle whose result would interpenetrate
 * a tile or the floor is refused (returns null) rather than applied.
 */
export function refoldTile(
  draft: AuthoredBuildDraft,
  tileId: string,
  newFoldAngle: number
): AuthoredBuildDraft | null {
  const byId = new Map(draft.tiles.map((tile) => [tile.id, tile]));
  const target = byId.get(tileId);
  if (
    !target ||
    !target.parentTileId ||
    target.parentEdge === undefined ||
    target.childEdge === undefined ||
    !byId.get(target.parentTileId)
  ) {
    return null;
  }

  const childrenByParent = new Map<string, BuilderTile[]>();
  for (const tile of draft.tiles) {
    if (!tile.parentTileId) continue;
    const list = childrenByParent.get(tile.parentTileId) ?? [];
    list.push(tile);
    childrenByParent.set(tile.parentTileId, list);
  }

  // Breadth-first subtree order guarantees parents re-derive before their children.
  const order: BuilderTile[] = [];
  const queue: BuilderTile[] = [target];
  while (queue.length > 0) {
    const tile = queue.shift()!;
    order.push(tile);
    for (const child of childrenByParent.get(tile.id) ?? []) queue.push(child);
  }

  // Derive every subtree member's hinge alignment from CURRENT geometry before moving.
  const alignments = new Map<string, { reverse: boolean; edgeOffset: number }>();
  for (const tile of order) {
    const tileParent = byId.get(tile.parentTileId ?? "");
    if (!tileParent || tile.parentEdge === undefined || tile.childEdge === undefined) return null;
    if (tile.id !== tileId && tile.foldAngle === undefined) return null;
    const alignment = deriveAttachmentAlignment(tileParent, tile);
    if (!alignment) return null;
    alignments.set(tile.id, alignment);
  }

  const updated = new Map<string, BuilderTile>();
  const poseOf = (id: string): BuilderTile => updated.get(id) ?? byId.get(id)!;
  for (const tile of order) {
    const alignment = alignments.get(tile.id)!;
    const parentPose = poseOf(tile.parentTileId!);
    const fold = tile.id === tileId ? newFoldAngle : tile.foldAngle!;
    const placed = attachTile(tileToEdgePlaced(parentPose), {
      key: tile.id,
      shape: tile.shape,
      attachTo: parentPose.id,
      parentEdge: tile.parentEdge!,
      childEdge: tile.childEdge!,
      foldAngle: fold,
      edgeAlign: "center",
      edgeOffset: alignment.edgeOffset,
      reverse: alignment.reverse,
      color: tile.color,
      step: tile.step,
      role: tile.role,
      subassemblyId: tile.subassemblyId
    });
    updated.set(tile.id, {
      ...tile,
      position: placed.position,
      basis: placed.basis,
      rotation: { x: 0, y: 0, z: 0 },
      foldAngle: fold
    });
  }

  const movedIds = new Set(updated.keys());
  const nextTiles = draft.tiles.map((tile) => updated.get(tile.id) ?? tile);

  for (const tile of updated.values()) {
    if (tileWorldVertices(tile).some((vertex) => vertex.y < -0.05)) return null;
  }
  const overlaps = findRawOverlapsAmong(nextTiles);
  if (overlaps.some((pair) => movedIds.has(pair.firstTileId) || movedIds.has(pair.secondTileId))) {
    return null;
  }

  // Prune connections that the move broke (hinges within the subtree stay matched by
  // construction; stale contact joins to the rest of the build are dropped honestly).
  const tilesById = new Map(nextTiles.map((tile) => [tile.id, tile]));
  const connections = draft.connections.filter((connection) => {
    const first = tilesById.get(connection.fromTileId);
    const second = tilesById.get(connection.toTileId);
    if (!first || !second) return false;
    if (!movedIds.has(first.id) && !movedIds.has(second.id)) return true;
    return findMagneticEdgeMatch(first, second) !== null;
  });

  return touch({ ...draft, tiles: nextTiles, connections });
}

/**
 * Derive the hinge alignment (edge direction + lateral offset) of an attached tile from
 * its current world geometry, so a re-fold reproduces the exact same seating.
 */
function deriveAttachmentAlignment(
  parent: BuilderTile,
  child: BuilderTile
): { reverse: boolean; edgeOffset: number } | null {
  if (child.parentEdge === undefined || child.childEdge === undefined) return null;
  const parentEdge = worldEdge(tileToEdgePlaced(parent), child.parentEdge);
  const childEdge = worldEdge(tileToEdgePlaced(child), child.childEdge);
  const parentVector = subtractVec(parentEdge.end, parentEdge.start);
  const childVector = subtractVec(childEdge.end, childEdge.start);
  const parentLength = Math.sqrt(dotVec(parentVector, parentVector));
  if (parentLength < 0.001) return null;
  const reverse = dotVec(parentVector, childVector) < 0;
  const direction = scaleVec(reverse ? scaleVec(parentVector, -1) : parentVector, 1 / parentLength);
  const parentMid = midpointVec(parentEdge.start, parentEdge.end);
  const childMid = midpointVec(childEdge.start, childEdge.end);
  const edgeOffset = dotVec(subtractVec(childMid, parentMid), direction);
  return { reverse, edgeOffset };
}

/** Raw overlap pairs among the given tiles (hairline tolerance, same as the gate). */
function findRawOverlapsAmong(tiles: BuilderTile[]): Array<{ firstTileId: string; secondTileId: string }> {
  const overlaps: Array<{ firstTileId: string; secondTileId: string }> = [];
  for (let firstIndex = 0; firstIndex < tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tiles.length; secondIndex += 1) {
      const intersection = tilesIntersectAsPrisms(tiles[firstIndex], tiles[secondIndex]);
      if (intersection.overlaps && intersection.penetration > 0.03) {
        overlaps.push({ firstTileId: tiles[firstIndex].id, secondTileId: tiles[secondIndex].id });
      }
    }
  }
  return overlaps;
}

/**
 * Add explicit connections for every magnetic edge contact involving the given tiles
 * that is not already recorded (ring closures, prefab seams, stacked module rims). The
 * gate validates each one against the real geometry, so this can never fabricate joints.
 */
export function withContactConnections(draft: AuthoredBuildDraft, tileIds: string[]): AuthoredBuildDraft {
  const focus = new Set(tileIds);
  const recorded = new Set(
    draft.connections.flatMap((connection) => [
      `${connection.fromTileId}|${connection.toTileId}`,
      `${connection.toTileId}|${connection.fromTileId}`
    ])
  );
  const additions: MagneticConnection[] = [];
  for (let firstIndex = 0; firstIndex < draft.tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < draft.tiles.length; secondIndex += 1) {
      const first = draft.tiles[firstIndex];
      const second = draft.tiles[secondIndex];
      if (!focus.has(first.id) && !focus.has(second.id)) continue;
      if (recorded.has(`${first.id}|${second.id}`)) continue;
      const connection = connectionWithMagneticEdges(first, second);
      if (!connection) continue;
      additions.push(connection);
      recorded.add(`${first.id}|${second.id}`);
      recorded.add(`${second.id}|${first.id}`);
    }
  }
  if (additions.length === 0) return draft;
  return touch({ ...draft, connections: [...draft.connections, ...additions] });
}

function subtractVec(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scaleVec(point: Vec3, amount: number): Vec3 {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function dotVec(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function midpointVec(first: Vec3, second: Vec3): Vec3 {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 };
}

export function addFreeformTile(
  draft: AuthoredBuildDraft,
  input: {
    shape: TileShape;
    color?: string;
    position?: Vec3;
    rotation?: Rotation;
    role?: string;
    subassemblyId?: string;
    step?: number;
  }
): AuthoredBuildDraft {
  const shape = input.shape;
  const tile: BuilderTile = {
    id: nextTileId(draft, shape),
    shape,
    color: input.color ?? COLORS[draft.tiles.length % COLORS.length],
    position: input.position ?? { x: 0, y: TILE_SPECS[shape].height / 2, z: 0 },
    rotation: input.rotation ?? { x: 0, y: 0, z: 0 },
    step: input.step ?? 1,
    role: input.role ?? "freeform panel",
    subassemblyId: input.subassemblyId,
    authoredMode: "freeform",
    confirmed: false
  };

  return touch({ ...draft, tiles: [...draft.tiles, tile] });
}

export function transformFreeformTile(
  draft: AuthoredBuildDraft,
  tileId: string,
  delta: Partial<Vec3 & { rx: number; ry: number; rz: number }>
): AuthoredBuildDraft {
  return touch({
    ...draft,
    tiles: draft.tiles.map((tile) => {
      if (tile.id !== tileId) return tile;
      return {
        ...tile,
        authoredMode: "freeform",
        confirmed: false,
        basis: undefined,
        position: {
          x: round(tile.position.x + (delta.x ?? 0)),
          y: round(tile.position.y + (delta.y ?? 0)),
          z: round(tile.position.z + (delta.z ?? 0))
        },
        rotation: {
          x: round(tile.rotation.x + (delta.rx ?? 0)),
          y: round(tile.rotation.y + (delta.ry ?? 0)),
          z: round(tile.rotation.z + (delta.rz ?? 0))
        }
      };
    }),
    connections: draft.connections.filter(
      (connection) => connection.fromTileId !== tileId && connection.toTileId !== tileId
    )
  });
}

export function updateBuilderTile(
  draft: AuthoredBuildDraft,
  tileId: string,
  patch: Partial<Pick<BuilderTile, "role" | "subassemblyId" | "step" | "color" | "confirmed">>
): AuthoredBuildDraft {
  return touch({
    ...draft,
    tiles: draft.tiles.map((tile) => (tile.id === tileId ? { ...tile, ...patch } : tile))
  });
}

export function deleteBuilderTiles(draft: AuthoredBuildDraft, tileIds: string[]): AuthoredBuildDraft {
  const deleted = new Set(tileIds);
  return touch({
    ...draft,
    tiles: draft.tiles.filter((tile) => !deleted.has(tile.id)),
    connections: draft.connections.filter(
      (connection) => !deleted.has(connection.fromTileId) && !deleted.has(connection.toTileId)
    )
  });
}

export function duplicateBuilderTiles(draft: AuthoredBuildDraft, tileIds: string[]): AuthoredBuildDraft {
  const selected = draft.tiles.filter((tile) => tileIds.includes(tile.id));
  const copies = selected.map((tile, index) => ({
    ...tile,
    id: `${tile.id}-copy-${Date.now().toString(36)}-${index + 1}`,
    position: { ...tile.position, x: round(tile.position.x + SMALL_EDGE), z: round(tile.position.z + SMALL_EDGE) },
    authoredMode: "freeform" as const,
    confirmed: false,
    parentTileId: undefined,
    parentEdge: undefined,
    childEdge: undefined,
    root: false
  }));
  return touch({ ...draft, tiles: [...draft.tiles, ...copies] });
}

export function mirrorBuilderTiles(draft: AuthoredBuildDraft, tileIds: string[]): AuthoredBuildDraft {
  const selected = draft.tiles.filter((tile) => tileIds.includes(tile.id));
  const copies = selected.map((tile, index) => ({
    ...tile,
    id: `${tile.id}-mirror-${Date.now().toString(36)}-${index + 1}`,
    position: { ...tile.position, x: round(-tile.position.x) },
    basis: tile.basis
      ? {
          xAxis: { ...tile.basis.xAxis, x: -tile.basis.xAxis.x },
          yAxis: { ...tile.basis.yAxis, x: -tile.basis.yAxis.x },
          zAxis: { ...tile.basis.zAxis, x: -tile.basis.zAxis.x }
        }
      : undefined,
    rotation: tile.basis ? tile.rotation : { ...tile.rotation, y: round(-tile.rotation.y), z: round(-tile.rotation.z) },
    role: tile.role.replace(/\bleft\b/i, "TEMP_SIDE").replace(/\bright\b/i, "left").replace(/TEMP_SIDE/i, "right"),
    authoredMode: "freeform" as const,
    confirmed: false,
    parentTileId: undefined,
    parentEdge: undefined,
    childEdge: undefined,
    root: false
  }));
  return touch({ ...draft, tiles: [...draft.tiles, ...copies] });
}

export function snapNearestEdge(draft: AuthoredBuildDraft, tileId: string): AuthoredBuildDraft {
  const target = draft.tiles.find((tile) => tile.id === tileId);
  if (!target) return draft;

  const candidates = draft.tiles.filter((tile) => tile.id !== tileId);
  const matches: Array<{ tile: BuilderTile; parentId: string; parentEdge: number; childEdge: number; score: number }> = [];

  candidates.forEach((parent) => {
    for (let parentEdge = 0; parentEdge < TILE_SPECS[parent.shape].maxEdges; parentEdge += 1) {
      for (let childEdge = 0; childEdge < TILE_SPECS[target.shape].maxEdges; childEdge += 1) {
        SNAP_FOLDS.forEach((foldAngle) => {
          [false, true].forEach((reverse) => {
            const preview = previewEdgeSnappedTile(draft, {
              parentTileId: parent.id,
              parentEdge,
              childShape: target.shape,
              childEdge,
              foldAngle,
              reverse,
              color: target.color,
              role: target.role,
              subassemblyId: target.subassemblyId,
              step: target.step
            });
            if (!preview) return;
            const score = distance(preview.position, target.position);
            if (score > SMALL_EDGE + 0.25 || overlapsOtherTiles(preview, draft.tiles.filter((tile) => tile.id !== tileId))) return;
            matches.push({ tile: { ...preview, id: target.id }, parentId: parent.id, parentEdge, childEdge, score });
          });
        });
      }
    }
  });

  const bestMatch = matches.sort((first, second) => first.score - second.score)[0];
  if (!bestMatch) return draft;

  const connections = draft.connections.filter(
    (connection) => connection.fromTileId !== tileId && connection.toTileId !== tileId
  );

  return touch({
    ...draft,
    tiles: draft.tiles.map((tile) => (tile.id === tileId ? bestMatch.tile : tile)),
    connections: [
      ...connections,
      {
        fromTileId: bestMatch.parentId,
        fromEdge: bestMatch.parentEdge,
        toTileId: tileId,
        toEdge: bestMatch.childEdge,
        kind: "edge"
      }
    ]
  });
}

export function evaluateReviewReadiness(draft: AuthoredBuildDraft): ReviewReadinessReport {
  const build = draftToBuildGraph(draft);
  const validation = validateBuild(build);
  const physicalCodes = new Set(["inventory-overrun", "tile-overlap", "floating-tiles", "duplicate-placement", "magnet-constraint", "no-magnetic-joins"]);
  const physicalIssues = validation.issues.filter((issue) => physicalCodes.has(issue.code));
  const unconfirmed = draft.tiles.filter((tile) => !tile.confirmed || tile.authoredMode === "freeform");
  const missingSteps = draft.tiles.filter((tile) => !Number.isFinite(tile.step) || tile.step < 1);
  const missingLabels = draft.tiles.filter((tile) => !tile.role.trim() || !tile.subassemblyId?.trim());
  const bomMismatch = inventoryMismatch(validation.usedInventory, draft.expectedInventory);
  const blockingReasons = [
    ...physicalIssues.map((issue) => issue.message),
    unconfirmed.length ? `${unconfirmed.length} tile(s) are not magnet-confirmed` : "",
    missingSteps.length ? `${missingSteps.length} tile(s) need build steps` : "",
    missingLabels.length ? `${missingLabels.length} tile(s) need role and subassembly labels` : "",
    bomMismatch ? "Bill of materials does not match the reference" : "",
    !draft.visualSignoff ? "Human visual signoff is still missing" : ""
  ].filter(Boolean);
  const geometryValid = physicalIssues.length === 0;
  const reviewReady = geometryValid && unconfirmed.length === 0 && missingSteps.length === 0 && missingLabels.length === 0 && !bomMismatch && draft.visualSignoff;
  return {
    status: reviewReady ? "review-ready" : geometryValid ? "geometry-valid" : "draft",
    geometryValid,
    reviewReady,
    blockingReasons,
    validation
  };
}

export function expectedInventoryFromTiles(tiles: BuilderTile[]): Inventory {
  const inventory = emptyInventory();
  tiles.forEach((tile) => {
    inventory[tile.shape] += 1;
  });
  return inventory;
}

function builderTileToTile(tile: BuilderTile) {
  const { authoredMode, confirmed, locked, ...plain } = tile;
  return plain;
}

function edgePlacedToBuilderTile(tile: EdgePlacedTile): BuilderTile {
  return {
    id: tile.key,
    shape: tile.shape,
    color: tile.color ?? "#118ab2",
    position: tile.position,
    rotation: { x: 0, y: 0, z: 0 },
    basis: tile.basis,
    step: tile.step,
    role: tile.role,
    subassemblyId: tile.subassemblyId,
    parentTileId: tile.parentTileId,
    parentEdge: tile.parentEdge,
    childEdge: tile.childEdge,
    foldAngle: tile.foldAngle,
    root: tile.root,
    authoredMode: "edge-snap",
    confirmed: true
  };
}

function tileToEdgePlaced(tile: BuilderTile): EdgePlacedTile {
  return {
    key: tile.id,
    shape: tile.shape,
    position: tile.position,
    basis: tile.basis ?? basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z),
    color: tile.color,
    step: tile.step,
    role: tile.role,
    subassemblyId: tile.subassemblyId,
    parentTileId: tile.parentTileId,
    parentEdge: tile.parentEdge,
    childEdge: tile.childEdge,
    foldAngle: tile.foldAngle,
    root: tile.root
  };
}

function inventoryMismatch(usedInventory: Inventory, expectedInventory?: Partial<Inventory>): boolean {
  if (!expectedInventory) return false;
  return SHAPE_ORDER.some((shape) => usedInventory[shape] !== (expectedInventory[shape] ?? 0));
}

function overlapsOtherTiles(tile: BuilderTile, others: BuilderTile[]): boolean {
  return others.some((other) => {
    if (findMagneticEdgeMatch(tile, other)) return false;
    return tilesIntersectAsPrisms(tile, other).overlaps;
  });
}

function calculateBounds(tiles: Array<{ shape: TileShape; position: Vec3; rotation: Rotation; basis?: BuilderTile["basis"] }>): BuildBounds {
  if (tiles.length === 0) return { width: 0, height: 0, depth: 0 };
  const extents = tiles.map((tile) => {
    const vertices = tileWorldVertices(tile as BuilderTile);
    const xs = vertices.map((vertex) => vertex.x);
    const ys = vertices.map((vertex) => vertex.y);
    const zs = vertices.map((vertex) => vertex.z);
    return {
      minX: Math.min(...xs) - TILE_THICKNESS / 2,
      maxX: Math.max(...xs) + TILE_THICKNESS / 2,
      minY: Math.min(...ys) - TILE_THICKNESS / 2,
      maxY: Math.max(...ys) + TILE_THICKNESS / 2,
      minZ: Math.min(...zs) - TILE_THICKNESS / 2,
      maxZ: Math.max(...zs) + TILE_THICKNESS / 2
    };
  });

  return {
    width: round(Math.max(...extents.map((item) => item.maxX)) - Math.min(...extents.map((item) => item.minX))),
    height: round(Math.max(...extents.map((item) => item.maxY)) - Math.min(...extents.map((item) => item.minY))),
    depth: round(Math.max(...extents.map((item) => item.maxZ)) - Math.min(...extents.map((item) => item.minZ)))
  };
}

function nextTileId(draft: AuthoredBuildDraft, shape: TileShape): string {
  const base = shape.replace("-triangle", "-tri").replace("-square", "-sq");
  let index = draft.tiles.length + 1;
  let id = `${base}-${index}`;
  const existing = new Set(draft.tiles.map((tile) => tile.id));
  while (existing.has(id)) {
    index += 1;
    id = `${base}-${index}`;
  }
  return id;
}

function localEdgeLength(shape: TileShape, edgeIndex: number): number {
  const vertices = tileLocalVertices(shape);
  const start = vertices[edgeIndex];
  const end = vertices[(edgeIndex + 1) % vertices.length];
  return distance(start, end);
}

function touch(draft: AuthoredBuildDraft): AuthoredBuildDraft {
  return {
    ...draft,
    updatedAt: new Date().toISOString()
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function distance(first: Vec3, second: Vec3): number {
  return Math.sqrt(
    (first.x - second.x) ** 2 +
      (first.y - second.y) ** 2 +
      (first.z - second.z) ** 2
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
