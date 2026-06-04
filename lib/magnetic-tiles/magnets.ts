import { TILE_SPECS } from "./catalog";
import type { TileInstance, TileShape, Vec3 } from "./types";

export type MagnetEdgeClass = "short" | "hypotenuse" | "large-xl" | "isosceles-long";

export interface MagnetPosition {
  edgeIndex: number;
  magnetIndex: number;
  fraction: number;
  worldPoint: Vec3;
}

export const CORNER_MAGNET_OFFSET = TILE_SPECS["small-square"].edgeLength * 0.22;

export function magnetFractionsForEdge(shape: TileShape, edgeIndex: number): number[] {
  const vertices = localVertices(shape);
  const start = vertices[edgeIndex];
  const end = vertices[(edgeIndex + 1) % vertices.length];

  if (!start || !end) return [];

  return magnetFractionsForLength(distance(start, end));
}

export function magnetFractionsForLength(edgeLength: number): number[] {
  const insetFraction = Math.min(0.45, CORNER_MAGNET_OFFSET / edgeLength);
  return [insetFraction, 1 - insetFraction];
}

export function magnetPositionsForEdge(shape: TileShape, edgeIndex: number): MagnetPosition[];
export function magnetPositionsForEdge(tile: TileInstance, edgeIndex: number): MagnetPosition[];
export function magnetPositionsForEdge(tileOrShape: TileInstance | TileShape, edgeIndex: number): MagnetPosition[] {
  const shape = typeof tileOrShape === "string" ? tileOrShape : tileOrShape.shape;
  const vertices =
    typeof tileOrShape === "string"
      ? localVertices(shape)
      : localVertices(shape).map((point) => transformPoint(point, tileOrShape));
  const start = vertices[edgeIndex];
  const end = vertices[(edgeIndex + 1) % vertices.length];

  if (!start || !end) return [];

  return magnetFractionsForEdge(shape, edgeIndex).map((fraction, magnetIndex) => ({
    edgeIndex,
    magnetIndex,
    fraction,
    worldPoint: interpolate(start, end, fraction)
  }));
}

export function tileWorldMagnetPositions(tile: TileInstance): MagnetPosition[] {
  return localVertices(tile.shape).flatMap((_, edgeIndex) => magnetPositionsForEdge(tile, edgeIndex));
}

export function magnetEdgeClass(shape: TileShape, edgeIndex: number): MagnetEdgeClass {
  if (shape === "right-triangle" && edgeIndex === 1) return "hypotenuse";
  if (shape === "large-square" || shape === "xl-square") return "large-xl";
  if (shape === "isosceles-triangle" && edgeIndex !== 0) return "isosceles-long";

  const edgeCount = TILE_SPECS[shape].maxEdges;
  if (edgeIndex < 0 || edgeIndex >= edgeCount) {
    throw new Error(`Unsupported edge ${edgeIndex} for ${shape}.`);
  }

  return "short";
}

function interpolate(start: Vec3, end: Vec3, fraction: number): Vec3 {
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
    z: start.z + (end.z - start.z) * fraction
  };
}

function distance(start: Vec3, end: Vec3): number {
  return Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2 + (end.z - start.z) ** 2);
}

function localVertices(shape: TileShape): Vec3[] {
  const spec = TILE_SPECS[shape];
  const halfW = spec.width / 2;
  const halfH = spec.height / 2;

  if (spec.maxEdges === 4) {
    return [
      { x: -halfW, y: -halfH, z: 0 },
      { x: halfW, y: -halfH, z: 0 },
      { x: halfW, y: halfH, z: 0 },
      { x: -halfW, y: halfH, z: 0 }
    ];
  }

  if (shape === "right-triangle") {
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

function transformPoint(point: Vec3, tile: TileInstance): Vec3 {
  if (tile.basis) {
    return add(
      add(scale(tile.basis.xAxis, point.x), scale(tile.basis.yAxis, point.y)),
      add(scale(tile.basis.zAxis, point.z), tile.position)
    );
  }

  const zRotated = rotateZ(point, tile.rotation.z);
  const yRotated = rotateY(zRotated, tile.rotation.y);
  const xRotated = rotateX(yRotated, tile.rotation.x);

  return add(xRotated, tile.position);
}

function rotateX(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cos - point.z * sin,
    z: point.y * sin + point.z * cos
  };
}

function rotateY(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos + point.z * sin,
    y: point.y,
    z: -point.x * sin + point.z * cos
  };
}

function rotateZ(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
    z: point.z
  };
}

function add(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z
  };
}

function scale(point: Vec3, amount: number): Vec3 {
  return {
    x: point.x * amount,
    y: point.y * amount,
    z: point.z * amount
  };
}
