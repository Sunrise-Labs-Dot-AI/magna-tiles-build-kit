import { SHAPE_ORDER, SMALL_EDGE, TILE_SPECS, TILE_THICKNESS, emptyInventory } from "@/lib/magnetic-tiles/catalog";
import { attachTile, basisFromEuler, identityBasis, makeAnchorTile, worldEdge, type EdgePlacedTile } from "@/lib/magnetic-tiles/edge-attachment";
import { assertNoRawOverlaps, overlapsInvolvingTile } from "@/lib/engine/overlap";
import { findMagneticEdgeMatch, tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type {
  BuildBounds,
  BuildFamily,
  BuildGraph,
  GeneratedBuildResponse,
  Inventory,
  MagneticConnection,
  Rotation,
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
const COLORS = ["#118ab2", "#ffb703", "#06d6a0", "#ef476f", "#7b2cbf", "#8ecae6"];

export type EdgeFitMode = "auto" | "flush" | "magnet-overlap";

interface EdgeSnapInput {
  parentTileId: string;
  parentEdge: number;
  parentMagnetT?: number;
  childShape: TileShape;
  childEdge: number;
  foldAngle: number;
  edgeFit?: EdgeFitMode;
  reverse?: boolean;
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

export function addRootTile(
  draft: AuthoredBuildDraft,
  input: {
    shape: TileShape;
    color?: string;
    position?: Vec3;
    role?: string;
    subassemblyId?: string;
    step?: number;
  }
): AuthoredBuildDraft {
  const key = nextTileId(draft, input.shape);
  const placed = makeAnchorTile(
    key,
    input.shape,
    input.position ?? { x: 0, y: TILE_SPECS[input.shape].height / 2, z: 0 },
    identityBasis(),
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
  if (!target || target.locked || draft.tiles.some((tile) => tile.parentTileId === tileId)) return draft;

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
            // Capture nearby edges, not tiles several inches away. Preserve the user's
            // orientation when two candidates are equally close, and never waive SAT.
            const parentMatch = findMagneticEdgeMatch(parent, preview);
            if (!parentMatch || parentMatch.fromEdge !== parentEdge || parentMatch.toEdge !== childEdge) return;
            if (score > 0.75 || overlapsOtherTiles(preview, draft.tiles.filter((tile) => tile.id !== tileId))) return;
            const currentNormal = tileToEdgePlaced(target).basis.zAxis;
            const nextNormal = preview.basis!.zAxis;
            const orientationPenalty = 0.5 * (1 - Math.abs(currentNormal.x * nextNormal.x + currentNormal.y * nextNormal.y + currentNormal.z * nextNormal.z));
            matches.push({ tile: { ...preview, id: target.id }, parentId: parent.id, parentEdge, childEdge, score: score + orientationPenalty });
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
