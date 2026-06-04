import { attachTile, identityBasis, makeAnchorTile } from "./edge-attachment";
import { tileWorldVertices } from "./magnet-geometry";
import { tileNormal } from "./prism-geometry";
import type { MagneticConnection, TileBasis, TileInstance, TileShape, Vec3 } from "./types";

export interface RecipeRootTile {
  key: string;
  shape: TileShape;
  color: string;
  position: Vec3;
  basis?: TileBasis;
  step: number;
  role: string;
  subassemblyId?: string;
}

export interface RecipeAttachedTile {
  key: string;
  shape: TileShape;
  color: string;
  attachTo: string;
  parentEdge: number;
  childEdge: number;
  foldAngle: number;
  edgeAlign?: "start" | "center";
  edgeOffset?: number;
  reverse?: boolean;
  step: number;
  role: string;
  subassemblyId?: string;
}

export type RecipeTile = RecipeRootTile | RecipeAttachedTile;

export interface RecipeSubassemblyAttachment {
  kind: "attach-subassembly";
  tileIds: string[];
  anchorTileId: string;
  parentTileId: string;
  parentEdge: number;
  childEdge: number;
  foldAngle: number;
  reverse?: boolean;
}

export interface BuildRecipe {
  id: string;
  tiles: RecipeTile[];
  operations?: RecipeSubassemblyAttachment[];
}

export interface CompiledRecipe {
  tiles: TileInstance[];
  connections: MagneticConnection[];
}

export function compileBuildRecipe(recipe: BuildRecipe): CompiledRecipe {
  const placed = new Map<string, ReturnType<typeof makeAnchorTile>>();
  const tiles: TileInstance[] = [];
  const connections: MagneticConnection[] = [];

  recipe.tiles.forEach((tile) => {
    if ("position" in tile) {
      const root = makeAnchorTile(
        tile.key,
        tile.shape,
        tile.position,
        tile.basis ?? identityBasis(),
        tile.step,
        tile.role,
        tile.color
      );
      root.subassemblyId = tile.subassemblyId;
      placed.set(tile.key, root);
      tiles.push(edgePlacedToTile(root));
      return;
    }

    const parent = placed.get(tile.attachTo);
    if (!parent) {
      throw new Error(`Recipe ${recipe.id} references missing parent tile: ${tile.attachTo}`);
    }

    const child = attachTile(parent, {
      key: tile.key,
      shape: tile.shape,
      attachTo: tile.attachTo,
      parentEdge: tile.parentEdge,
      childEdge: tile.childEdge,
      foldAngle: tile.foldAngle,
      edgeAlign: tile.edgeAlign,
      edgeOffset: tile.edgeOffset,
      reverse: tile.reverse,
      color: tile.color,
      step: tile.step,
      role: tile.role,
      subassemblyId: tile.subassemblyId
    });

    placed.set(tile.key, child);
    tiles.push(edgePlacedToTile(child));
    connections.push({
      fromTileId: tile.attachTo,
      fromEdge: tile.parentEdge,
      toTileId: tile.key,
      toEdge: tile.childEdge,
      kind: "edge"
    });
  });

  recipe.operations?.forEach((operation) => {
    attachSubassembly(operation, tiles, connections, recipe.id);
  });

  return { tiles, connections };
}

function edgePlacedToTile(tile: ReturnType<typeof makeAnchorTile>): TileInstance {
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
    root: tile.root
  };
}

function attachSubassembly(
  operation: RecipeSubassemblyAttachment,
  tiles: TileInstance[],
  connections: MagneticConnection[],
  recipeId: string
): void {
  const parent = tiles.find((tile) => tile.id === operation.parentTileId);
  const anchor = tiles.find((tile) => tile.id === operation.anchorTileId);

  if (!parent) {
    throw new Error(`Recipe ${recipeId} references missing subassembly parent tile: ${operation.parentTileId}`);
  }

  if (!anchor) {
    throw new Error(`Recipe ${recipeId} references missing subassembly anchor tile: ${operation.anchorTileId}`);
  }

  const sourceEdge = tileEdge(anchor, operation.childEdge);
  const targetEdge = tileEdge(parent, operation.parentEdge);
  const sourceStart = sourceEdge.start;
  const sourceEnd = sourceEdge.end;
  const targetStart = operation.reverse ? targetEdge.end : targetEdge.start;
  const targetEnd = operation.reverse ? targetEdge.start : targetEdge.end;
  const sourceFrame = frameFromEdge(sourceStart, sourceEnd, tileNormal(anchor));
  const targetDirection = normalize(subtract(targetEnd, targetStart));
  const targetNormal = normalize(rotateAroundAxis(tileNormal(parent), targetDirection, operation.foldAngle));
  const targetFrame = frameFromEdge(targetStart, targetEnd, targetNormal);
  const affected = new Set(operation.tileIds);

  tiles.forEach((tile, index) => {
    if (!affected.has(tile.id)) return;
    const transformed = transformTile(tile, sourceFrame, targetFrame, sourceStart, targetStart);
    tiles[index] =
      tile.id === operation.anchorTileId
        ? {
            ...transformed,
            parentTileId: operation.parentTileId,
            parentEdge: operation.parentEdge,
            childEdge: operation.childEdge,
            foldAngle: operation.foldAngle,
            root: false
          }
        : transformed;
  });

  connections.push({
    fromTileId: operation.parentTileId,
    fromEdge: operation.parentEdge,
    toTileId: operation.anchorTileId,
    toEdge: operation.childEdge,
    kind: "edge"
  });
}

interface OrthonormalFrame {
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
}

function transformTile(
  tile: TileInstance,
  sourceFrame: OrthonormalFrame,
  targetFrame: OrthonormalFrame,
  sourceOrigin: Vec3,
  targetOrigin: Vec3
): TileInstance {
  return {
    ...tile,
    position: transformPoint(tile.position, sourceFrame, targetFrame, sourceOrigin, targetOrigin),
    basis: {
      xAxis: normalize(transformVector(tile.basis?.xAxis ?? { x: 1, y: 0, z: 0 }, sourceFrame, targetFrame)),
      yAxis: normalize(transformVector(tile.basis?.yAxis ?? { x: 0, y: 1, z: 0 }, sourceFrame, targetFrame)),
      zAxis: normalize(transformVector(tile.basis?.zAxis ?? { x: 0, y: 0, z: 1 }, sourceFrame, targetFrame))
    }
  };
}

function transformPoint(
  point: Vec3,
  sourceFrame: OrthonormalFrame,
  targetFrame: OrthonormalFrame,
  sourceOrigin: Vec3,
  targetOrigin: Vec3
): Vec3 {
  return add(targetOrigin, transformVector(subtract(point, sourceOrigin), sourceFrame, targetFrame));
}

function transformVector(vector: Vec3, sourceFrame: OrthonormalFrame, targetFrame: OrthonormalFrame): Vec3 {
  const x = dot(vector, sourceFrame.xAxis);
  const y = dot(vector, sourceFrame.yAxis);
  const z = dot(vector, sourceFrame.zAxis);
  return add(add(scale(targetFrame.xAxis, x), scale(targetFrame.yAxis, y)), scale(targetFrame.zAxis, z));
}

function frameFromEdge(start: Vec3, end: Vec3, normal: Vec3): OrthonormalFrame {
  const xAxis = normalize(subtract(end, start));
  const zAxis = normalize(normal);
  const yAxis = normalize(cross(zAxis, xAxis));

  return { xAxis, yAxis, zAxis };
}

function tileEdge(tile: TileInstance, edgeIndex: number): { start: Vec3; end: Vec3 } {
  const vertices = tileWorldVertices(tile);
  return {
    start: vertices[edgeIndex],
    end: vertices[(edgeIndex + 1) % vertices.length]
  };
}

function rotateAroundAxis(point: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(add(scale(point, cos), scale(cross(unit, point), sin)), scale(unit, dot(unit, point) * (1 - cos)));
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
  if (length < 0.0001) return { x: 0, y: 0, z: 0 };
  return scale(point, 1 / length);
}
