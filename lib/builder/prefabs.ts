/**
 * Prefabs: pre-configured multi-tile shapes that drop in like a single tile.
 *
 * Each prefab is a deterministic arrangement of edge-attached tiles (reusing the
 * engine-proven macro generators in lib/magnetic-tiles/macros.ts, or a replayed
 * sequence of builder ops) instantiated from an anchor:
 *  - ground placement starts a new island at the clicked point;
 *  - magnet-edge placement seats the prefab's anchor edge on the hovered edge through
 *    previewEdgeSnappedTile, then carries the rest of the prefab rigidly with it —
 *    stacking a tower module on the top edge of the one below just works.
 *
 * Placement is all-or-nothing: the WHOLE prefab is collision-checked against the draft
 * before commit; a prefab that cannot fit places nothing.
 */
import { TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import { tilePrismVertices, tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import { box, wedgePrism } from "@/lib/magnetic-tiles/macros";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import type {
  MagneticConnection,
  TileBasis,
  TileInstance,
  TileShape,
  Vec3
} from "@/lib/magnetic-tiles/types";
import {
  addEdgeSnappedTile,
  addRootTile,
  createEmptyDraft,
  previewEdgeSnappedTile,
  withContactConnections
} from "./operations";
import { snapRootPosition, type MagnetHover } from "./placement";
import type { AuthoredBuildDraft, BuilderTile } from "./types";

export type PrefabId = "open-cube" | "closed-box" | "tower-module" | "wedge-ramp" | "roof-prism";

export interface PrefabSpec {
  id: PrefabId;
  label: string;
  description: string;
  /** Macro-local tile + edge that seats on a hovered magnet edge. */
  anchorTileId: string;
  anchorShape: TileShape;
  /** Local edge of the anchor tile that mates with the hovered edge. */
  anchorChildEdge: number;
  build(color: string): { tiles: TileInstance[]; connections: MagneticConnection[] };
}

export const PREFAB_ORDER: PrefabId[] = [
  "open-cube",
  "tower-module",
  "closed-box",
  "wedge-ramp",
  "roof-prism"
];

export const PREFAB_SPECS: Record<PrefabId, PrefabSpec> = {
  "open-cube": {
    id: "open-cube",
    label: "Open cube",
    description: "4 squares on edges — two parallel sides missing",
    anchorTileId: "cube-front-1-1",
    anchorShape: "small-square",
    anchorChildEdge: 0,
    build: (color) => {
      const macro = box({ id: "cube", width: 1, height: 1, depth: 1, openFaces: ["top", "bottom"], color });
      return { tiles: macro.tiles, connections: macro.connections };
    }
  },
  "tower-module": {
    id: "tower-module",
    label: "Tower module",
    description: "Open cube built to stack — snap the next one on its top edges",
    anchorTileId: "tower-front-1-1",
    anchorShape: "small-square",
    anchorChildEdge: 0,
    build: (color) => {
      const macro = box({ id: "tower", width: 1, height: 1, depth: 1, openFaces: ["top", "bottom"], color });
      return { tiles: macro.tiles, connections: macro.connections };
    }
  },
  "closed-box": {
    id: "closed-box",
    label: "Closed box",
    description: "Floor, four walls, and a lid",
    anchorTileId: "boxp-front-1-1",
    anchorShape: "small-square",
    anchorChildEdge: 0,
    build: (color) => {
      const macro = box({ id: "boxp", width: 1, height: 1, depth: 1, openFaces: [], color });
      return { tiles: macro.tiles, connections: macro.connections };
    }
  },
  "wedge-ramp": {
    id: "wedge-ramp",
    label: "Wedge ramp",
    description: "Sloped square on triangle sides (a lone flap would collapse)",
    anchorTileId: "wedge-deck-1-1",
    anchorShape: "small-square",
    anchorChildEdge: 3,
    build: (color) => {
      const macro = wedgePrism({
        id: "wedge",
        deckLength: 1,
        width: 1,
        sideShape: "isosceles-triangle",
        includeFloor: false,
        colors: { side: "#ffb703", deck: color }
      });
      return { tiles: macro.tiles, connections: macro.connections };
    }
  },
  "roof-prism": {
    id: "roof-prism",
    label: "Roof prism",
    description: "Two 45° squares meeting at a ridge",
    anchorTileId: "roof-a",
    anchorShape: "small-square",
    anchorChildEdge: 0,
    build: (color) => buildRoofPrism(color)
  }
};

/**
 * The roof prism as a replayed builder-op sequence: a square leaning at 45° and a
 * second square folded over its top edge, descending at 45° on the far side.
 */
function buildRoofPrism(color: string): { tiles: TileInstance[]; connections: MagneticConnection[] } {
  let draft = createEmptyDraft("roof-prism-prefab");
  draft = addRootTile(draft, {
    shape: "small-square",
    color,
    position: { x: 0, y: 0, z: 0 },
    orientation: { standAngle: Math.PI / 4, yaw: 0 },
    role: "roof prism left pitch",
    subassemblyId: "roof-prism"
  });
  const root = draft.tiles[0];
  draft = addEdgeSnappedTile(draft, {
    parentTileId: root.id,
    parentEdge: 2,
    childShape: "small-square",
    childEdge: 0,
    foldAngle: -Math.PI / 2,
    edgeFit: "flush",
    color,
    role: "roof prism right pitch",
    subassemblyId: "roof-prism"
  });
  if (draft.tiles.length !== 2) {
    throw new Error("roof prism prefab failed to assemble");
  }
  const renamed = new Map([
    [draft.tiles[0].id, "roof-a"],
    [draft.tiles[1].id, "roof-b"]
  ]);
  const tiles = draft.tiles.map((tile) => ({
    ...tile,
    id: renamed.get(tile.id)!,
    parentTileId: tile.parentTileId ? renamed.get(tile.parentTileId) : undefined
  }));
  const connections = draft.connections.map((connection) => ({
    ...connection,
    fromTileId: renamed.get(connection.fromTileId)!,
    toTileId: renamed.get(connection.toTileId)!
  }));
  return { tiles, connections };
}

/* ------------------------------------------------------------------ */
/* Instantiation                                                       */
/* ------------------------------------------------------------------ */

export interface PrefabGhost {
  tiles: BuilderTile[];
  valid: boolean;
  reason?: string;
}

export interface PrefabPlacementResult {
  draft: AuthoredBuildDraft;
  placedTileIds: string[];
  reason?: string;
}

interface PrefabInstance {
  tiles: BuilderTile[];
  connections: MagneticConnection[];
}

/** Ghost preview of a prefab anchored to open ground at the clicked point. */
export function prefabGhostOnGround(
  draft: AuthoredBuildDraft,
  prefabId: PrefabId,
  point: { x: number; z: number },
  color: string
): PrefabGhost {
  const instance = instantiateOnGround(draft, prefabId, point, color);
  const reason = instanceBlockedReason(draft, instance);
  return { tiles: instance.tiles, valid: reason === null, reason: reason ?? undefined };
}

/** Commit a prefab as a new grounded island (all-or-nothing). */
export function placePrefabOnGround(
  draft: AuthoredBuildDraft,
  prefabId: PrefabId,
  point: { x: number; z: number },
  color: string
): PrefabPlacementResult {
  const instance = instantiateOnGround(draft, prefabId, point, color);
  return commitInstance(draft, instance);
}

/** Ghost preview of a prefab seated on the hovered magnet edge. */
export function prefabGhostOnEdge(
  draft: AuthoredBuildDraft,
  prefabId: PrefabId,
  hover: MagnetHover,
  color: string
): PrefabGhost | null {
  const instance = instantiateOnEdge(draft, prefabId, hover, color);
  if (!instance) return null;
  const reason = instanceBlockedReason(draft, instance);
  return { tiles: instance.tiles, valid: reason === null, reason: reason ?? undefined };
}

/** Commit a prefab seated on the hovered magnet edge (all-or-nothing). */
export function placePrefabOnEdge(
  draft: AuthoredBuildDraft,
  prefabId: PrefabId,
  hover: MagnetHover,
  color: string
): PrefabPlacementResult {
  const instance = instantiateOnEdge(draft, prefabId, hover, color);
  if (!instance) {
    return { draft, placedTileIds: [], reason: "The prefab cannot seat on that edge." };
  }
  return commitInstance(draft, instance);
}

function instantiateOnGround(
  draft: AuthoredBuildDraft,
  prefabId: PrefabId,
  point: { x: number; z: number },
  color: string
): PrefabInstance {
  const spec = PREFAB_SPECS[prefabId];
  const built = spec.build(color);
  const center = footprintCenter(built.tiles);
  const snapped = snapRootPosition(point);
  const offset = { x: snapped.x - center.x, y: groundLift(built.tiles), z: snapped.z - center.z };
  const moved = built.tiles.map((tile) => ({
    ...tile,
    position: addVec(tile.position, offset)
  }));
  return finalizeInstance(draft, spec.id, spec.anchorChildEdge, moved, built.connections, null);
}

/** Ground placement clamps the whole assembly so no tile penetrates the floor. */
function groundLift(tiles: TileInstance[]): number {
  const minY = Math.min(...tiles.flatMap((tile) => prismVerticesOf(tile).map((point) => point.y)));
  return minY < 0 ? -minY : 0;
}

/**
 * Import an arbitrary deterministic tile assembly (e.g. a macro from
 * lib/magnetic-tiles/macros.ts) into the draft as a new island at an exact offset.
 * Same all-or-nothing physical gating as prefab placement.
 */
export function placeTilesAsIsland(
  draft: AuthoredBuildDraft,
  built: { tiles: TileInstance[]; connections: MagneticConnection[] },
  offset: Vec3,
  label = "import"
): PrefabPlacementResult {
  const lifted = { ...offset, y: offset.y + groundLift(built.tiles) };
  const moved = built.tiles.map((tile) => ({ ...tile, position: addVec(tile.position, lifted) }));
  const instance = finalizeInstance(draft, label, 0, moved, built.connections, null);
  return commitInstance(draft, instance);
}

function instantiateOnEdge(
  draft: AuthoredBuildDraft,
  prefabId: PrefabId,
  hover: MagnetHover,
  color: string
): PrefabInstance | null {
  const spec = PREFAB_SPECS[prefabId];
  const built = spec.build(color);
  const anchor = built.tiles.find((tile) => tile.id === spec.anchorTileId);
  if (!anchor) return null;

  // Both edge directions are geometrically legal; the better seat is the one that makes
  // MORE magnetic contact with the existing structure (an aligned stacked module touches
  // every rim edge of the module below; a mirrored one only shares the anchor hinge).
  let best: { instance: PrefabInstance; contacts: number } | null = null;
  let fallback: PrefabInstance | null = null;
  for (const reverse of [false, true]) {
    const placedAnchor = previewEdgeSnappedTile(draft, {
      parentTileId: hover.tileId,
      parentEdge: hover.edge,
      childShape: spec.anchorShape,
      childEdge: spec.anchorChildEdge,
      foldAngle: 0,
      edgeFit: "flush",
      reverse,
      color
    });
    if (!placedAnchor || !placedAnchor.basis) continue;

    const anchorBasis = anchor.basis ?? identityBasis();
    const moved = built.tiles.map((tile) => {
      const basis = tile.basis ?? identityBasis();
      return {
        ...tile,
        position: addVec(
          placedAnchor.position,
          rotateBetween(anchorBasis, placedAnchor.basis!, subtractVec(tile.position, anchor.position))
        ),
        basis: {
          xAxis: rotateBetween(anchorBasis, placedAnchor.basis!, basis.xAxis),
          yAxis: rotateBetween(anchorBasis, placedAnchor.basis!, basis.yAxis),
          zAxis: rotateBetween(anchorBasis, placedAnchor.basis!, basis.zAxis)
        },
        rotation: { x: 0, y: 0, z: 0 }
      };
    });
    const instance = finalizeInstance(draft, spec.id, spec.anchorChildEdge, moved, built.connections, {
      hover,
      placedAnchorId: spec.anchorTileId
    });
    fallback = instance;
    if (instanceBlockedReason(draft, instance) !== null) continue;
    const contacts = contactCount(draft, instance);
    if (!best || contacts > best.contacts) best = { instance, contacts };
  }
  // Return the best valid seat, or the last attempt so the ghost can show no-fit.
  return best?.instance ?? fallback;
}

/** How many magnetic edge contacts the instance makes with the existing draft. */
function contactCount(draft: AuthoredBuildDraft, instance: PrefabInstance): number {
  let contacts = 0;
  for (const tile of instance.tiles) {
    for (const existing of draft.tiles) {
      if (findMagneticEdgeMatch(tile, existing)) contacts += 1;
    }
  }
  return contacts;
}

/** Remap ids to a fresh prefix, convert to BuilderTiles, synthesize parent lineage. */
function finalizeInstance(
  draft: AuthoredBuildDraft,
  label: string,
  anchorChildEdge: number,
  tiles: TileInstance[],
  connections: MagneticConnection[],
  edgeAnchor: { hover: MagnetHover; placedAnchorId: string } | null
): PrefabInstance {
  const prefix = nextPrefabPrefix(draft);
  const rename = new Map(tiles.map((tile) => [tile.id, `${prefix}-${tile.id}`]));
  const remappedConnections = connections.map((connection) => ({
    ...connection,
    fromTileId: rename.get(connection.fromTileId) ?? connection.fromTileId,
    toTileId: rename.get(connection.toTileId) ?? connection.toTileId
  }));

  // Synthesize parent lineage over the prefab's connection graph so subtree selection,
  // deletion, and the engine's unsnapped-tile check all see a coherent build tree.
  const anchorId = edgeAnchor ? edgeAnchor.placedAnchorId : tiles[0].id;
  const parentByTile = new Map<string, { parent: string; parentEdge: number; childEdge: number }>();
  const adjacency = new Map<string, Array<{ other: string; selfEdge: number; otherEdge: number }>>();
  for (const connection of connections) {
    adjacency.set(connection.fromTileId, [
      ...(adjacency.get(connection.fromTileId) ?? []),
      { other: connection.toTileId, selfEdge: connection.fromEdge, otherEdge: connection.toEdge }
    ]);
    adjacency.set(connection.toTileId, [
      ...(adjacency.get(connection.toTileId) ?? []),
      { other: connection.fromTileId, selfEdge: connection.toEdge, otherEdge: connection.fromEdge }
    ]);
  }
  const visited = new Set<string>([anchorId]);
  const queue = [anchorId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const link of adjacency.get(current) ?? []) {
      if (visited.has(link.other)) continue;
      visited.add(link.other);
      parentByTile.set(link.other, { parent: current, parentEdge: link.selfEdge, childEdge: link.otherEdge });
      queue.push(link.other);
    }
  }

  const builderTiles: BuilderTile[] = tiles.map((tile) => {
    const lineage = parentByTile.get(tile.id);
    const isAnchor = tile.id === anchorId;
    return {
      ...tile,
      id: rename.get(tile.id)!,
      authoredMode: "edge-snap",
      confirmed: true,
      root: edgeAnchor ? false : isAnchor ? true : tile.root ?? false,
      parentTileId: edgeAnchor && isAnchor
        ? edgeAnchor.hover.tileId
        : lineage
          ? rename.get(lineage.parent)
          : tile.parentTileId
            ? rename.get(tile.parentTileId)
            : undefined,
      parentEdge: edgeAnchor && isAnchor ? edgeAnchor.hover.edge : lineage?.parentEdge ?? tile.parentEdge,
      childEdge: edgeAnchor && isAnchor ? anchorChildEdge : lineage?.childEdge ?? tile.childEdge,
      foldAngle: edgeAnchor && isAnchor ? 0 : tile.foldAngle,
      subassemblyId: `${prefix}-${label}`
    };
  });

  const allConnections = edgeAnchor
    ? [
        ...remappedConnections,
        {
          fromTileId: edgeAnchor.hover.tileId,
          fromEdge: edgeAnchor.hover.edge,
          toTileId: rename.get(anchorId)!,
          toEdge: anchorChildEdge,
          kind: "edge" as const
        }
      ]
    : remappedConnections;

  return { tiles: builderTiles, connections: allConnections };
}

/** All-or-nothing physical check: floor penetration or any overlap blocks the whole prefab. */
function instanceBlockedReason(draft: AuthoredBuildDraft, instance: PrefabInstance): string | null {
  for (const tile of instance.tiles) {
    const minY = Math.min(...prismVerticesOf(tile).map((point) => point.y));
    if (minY < -0.05) return "The prefab would sink through the floor here.";
  }
  for (const tile of instance.tiles) {
    for (const existing of draft.tiles) {
      const intersection = tilesIntersectAsPrisms(tile, existing);
      if (intersection.overlaps && intersection.penetration > RAW_OVERLAP_TOLERANCE) {
        return "The prefab would overlap an existing tile.";
      }
    }
  }
  for (let firstIndex = 0; firstIndex < instance.tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < instance.tiles.length; secondIndex += 1) {
      const intersection = tilesIntersectAsPrisms(instance.tiles[firstIndex], instance.tiles[secondIndex]);
      if (intersection.overlaps && intersection.penetration > RAW_OVERLAP_TOLERANCE) {
        return "The prefab geometry is self-colliding in this orientation.";
      }
    }
  }
  return null;
}

function commitInstance(draft: AuthoredBuildDraft, instance: PrefabInstance): PrefabPlacementResult {
  const reason = instanceBlockedReason(draft, instance);
  if (reason) return { draft, placedTileIds: [], reason };
  const placedIds = instance.tiles.map((tile) => tile.id);
  const merged: AuthoredBuildDraft = {
    ...draft,
    tiles: [...draft.tiles, ...instance.tiles],
    connections: [...draft.connections, ...instance.connections],
    updatedAt: new Date().toISOString()
  };
  return { draft: withContactConnections(merged, placedIds), placedTileIds: placedIds };
}

/* ------------------------------------------------------------------ */

function nextPrefabPrefix(draft: AuthoredBuildDraft): string {
  let index = 1;
  const existing = draft.tiles.map((tile) => tile.id);
  while (existing.some((id) => id.startsWith(`pf${index}-`))) index += 1;
  return `pf${index}`;
}

function footprintCenter(tiles: TileInstance[]): Vec3 {
  const points = tiles.flatMap((tile) => prismVerticesOf(tile));
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: 0,
    z: (Math.min(...zs) + Math.max(...zs)) / 2
  };
}

function prismVerticesOf(tile: TileInstance): Vec3[] {
  return tilePrismVertices(tile, TILE_THICKNESS);
}

function identityBasis(): TileBasis {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 }
  };
}

/** Apply the rotation that carries `fromBasis` onto `toBasis` to a vector. */
function rotateBetween(fromBasis: TileBasis, toBasis: TileBasis, vector: Vec3): Vec3 {
  // R = toBasis ∘ fromBasisᵀ (both orthonormal).
  const local = {
    x: dotVec(fromBasis.xAxis, vector),
    y: dotVec(fromBasis.yAxis, vector),
    z: dotVec(fromBasis.zAxis, vector)
  };
  return {
    x: toBasis.xAxis.x * local.x + toBasis.yAxis.x * local.y + toBasis.zAxis.x * local.z,
    y: toBasis.xAxis.y * local.x + toBasis.yAxis.y * local.y + toBasis.zAxis.y * local.z,
    z: toBasis.xAxis.z * local.x + toBasis.yAxis.z * local.y + toBasis.zAxis.z * local.z
  };
}

function addVec(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtractVec(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function dotVec(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
