import { TILE_THICKNESS } from "./catalog";
import { tileWorldVertices } from "./magnet-geometry";
import type { TileInstance, Vec3 } from "./types";

const AXIS_EPSILON = 0.0001;
const CONTACT_TOLERANCE = 0.03;

interface Projection {
  min: number;
  max: number;
}

export interface PrismIntersection {
  overlaps: boolean;
  penetration: number;
}

export function tilePrismVertices(tile: TileInstance, thickness = TILE_THICKNESS): Vec3[] {
  const normal = tileNormal(tile);
  const offset = scale(normal, thickness / 2);
  const face = tileWorldVertices(tile);

  return [
    ...face.map((point) => add(point, offset)),
    ...face.map((point) => subtract(point, offset))
  ];
}

export function tilesIntersectAsPrisms(first: TileInstance, second: TileInstance): PrismIntersection {
  const firstVertices = tilePrismVertices(first);
  const secondVertices = tilePrismVertices(second);
  const axes = uniqueAxes([
    ...tileSeparatingAxes(first),
    ...tileSeparatingAxes(second),
    ...crossProductAxes(tileEdgeDirections(first), tileEdgeDirections(second))
  ]);

  let minimumPenetration = Number.POSITIVE_INFINITY;

  for (const axis of axes) {
    const firstProjection = project(firstVertices, axis);
    const secondProjection = project(secondVertices, axis);
    const penetration = intervalPenetration(firstProjection, secondProjection);

    if (penetration <= CONTACT_TOLERANCE) {
      return { overlaps: false, penetration: 0 };
    }

    minimumPenetration = Math.min(minimumPenetration, penetration);
  }

  return {
    overlaps: Number.isFinite(minimumPenetration),
    penetration: Number.isFinite(minimumPenetration) ? minimumPenetration : 0
  };
}

export function tileNormal(tile: TileInstance): Vec3 {
  if (tile.basis) return normalize(tile.basis.zAxis);

  const vertices = tileWorldVertices(tile);
  const firstEdge = subtract(vertices[1], vertices[0]);
  const secondEdge = subtract(vertices[2], vertices[1]);
  return normalize(cross(firstEdge, secondEdge));
}

function tileSeparatingAxes(tile: TileInstance): Vec3[] {
  const normal = tileNormal(tile);
  return [
    normal,
    ...tileEdgeDirections(tile).map((edge) => cross(edge, normal))
  ].map(normalize).filter((axis) => magnitude(axis) > AXIS_EPSILON);
}

function tileEdgeDirections(tile: TileInstance): Vec3[] {
  const vertices = tileWorldVertices(tile);
  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    return normalize(subtract(end, start));
  });
}

function crossProductAxes(firstAxes: Vec3[], secondAxes: Vec3[]): Vec3[] {
  return firstAxes.flatMap((first) =>
    secondAxes.map((second) => cross(first, second)).filter((axis) => magnitude(axis) > AXIS_EPSILON)
  );
}

function uniqueAxes(axes: Vec3[]): Vec3[] {
  return axes.reduce<Vec3[]>((unique, axis) => {
    const normalized = normalize(axis);
    if (magnitude(normalized) <= AXIS_EPSILON) return unique;
    const alreadyPresent = unique.some((candidate) => Math.abs(dot(candidate, normalized)) > 0.995);
    if (!alreadyPresent) unique.push(normalized);
    return unique;
  }, []);
}

function project(vertices: Vec3[], axis: Vec3): Projection {
  const values = vertices.map((vertex) => dot(vertex, axis));
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function intervalPenetration(first: Projection, second: Projection): number {
  return Math.min(first.max, second.max) - Math.max(first.min, second.min);
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
  if (length <= AXIS_EPSILON) return { x: 0, y: 0, z: 0 };
  return scale(point, 1 / length);
}
