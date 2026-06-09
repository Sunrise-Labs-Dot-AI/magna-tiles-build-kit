import { TILE_SPECS } from "./catalog";
import { tileWorldMagnetPositions } from "./magnets";
import type { MagneticConnection, TileInstance, TileShape, Vec3 } from "./types";

interface MagneticEdge {
  index: number;
  start: Vec3;
  end: Vec3;
  midpoint: Vec3;
  direction: Vec3;
  length: number;
}

export interface MagneticEdgeMatch {
  fromEdge: number;
  toEdge: number;
  midpointDistance: number;
  parallelScore: number;
}

export interface TileMagnetPoint {
  edgeIndex: number;
  magnetIndex: number;
  position: Vec3;
  t: number;
}

const EDGE_TOLERANCE = 0.68;
const PARALLEL_TOLERANCE = 0.92;

export function findMagneticEdgeMatch(
  first: TileInstance,
  second: TileInstance
): MagneticEdgeMatch | null {
  let best: MagneticEdgeMatch | null = null;

  tileMagneticEdges(first).forEach((firstEdge) => {
    tileMagneticEdges(second).forEach((secondEdge) => {
      const parallelScore = Math.abs(dot(firstEdge.direction, secondEdge.direction));
      if (parallelScore < PARALLEL_TOLERANCE) return;

      const midpointDistance = distance(firstEdge.midpoint, secondEdge.midpoint);
      const endpointDistance = Math.min(
        distance(firstEdge.start, secondEdge.end) + distance(firstEdge.end, secondEdge.start),
        distance(firstEdge.start, secondEdge.start) + distance(firstEdge.end, secondEdge.end)
      );
      const edgeLength = Math.max(firstEdge.length, secondEdge.length, 0.001);
      const lengthDelta = Math.abs(firstEdge.length - secondEdge.length);
      const normalizedEndpointDistance = endpointDistance / edgeLength;
      const centeredPartialEdgeMatch =
        lengthDelta > EDGE_TOLERANCE &&
        midpointDistance <= lengthDelta / 2 + EDGE_TOLERANCE &&
        normalizedEndpointDistance <= 0.58;

      if (midpointDistance > EDGE_TOLERANCE && normalizedEndpointDistance > 0.42 && !centeredPartialEdgeMatch) return;

      const candidate = {
        fromEdge: firstEdge.index,
        toEdge: secondEdge.index,
        midpointDistance,
        parallelScore
      };

      if (!best || score(candidate) < score(best)) {
        best = candidate;
      }
    });
  });

  return best;
}

export function connectionWithMagneticEdges(
  first: TileInstance,
  second: TileInstance,
  kind: MagneticConnection["kind"] = "edge"
): MagneticConnection | null {
  const match = findMagneticEdgeMatch(first, second);
  if (!match) return null;

  return {
    fromTileId: first.id,
    fromEdge: match.fromEdge,
    toTileId: second.id,
    toEdge: match.toEdge,
    kind
  };
}

export function tileWorldVertices(tile: TileInstance): Vec3[] {
  return tileLocalVertices(tile.shape).map((point) => transformPoint(point, tile));
}

export function tileWorldMagnetPoints(tile: TileInstance): TileMagnetPoint[] {
  return tileWorldMagnetPositions(tile).map((magnet) => ({
    edgeIndex: magnet.edgeIndex,
    magnetIndex: magnet.magnetIndex,
    t: magnet.fraction,
    position: magnet.worldPoint
  }));
}

function tileMagneticEdges(tile: TileInstance): MagneticEdge[] {
  const vertices = tileWorldVertices(tile);

  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const vector = subtract(end, start);
    const length = magnitude(vector);
    return {
      index,
      start,
      end,
      midpoint: scale(add(start, end), 0.5),
      direction: scale(vector, 1 / Math.max(length, 0.001)),
      length
    };
  });
}

export function tileLocalVertices(shape: TileShape): Vec3[] {
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

function score(match: MagneticEdgeMatch): number {
  return match.midpointDistance + (1 - match.parallelScore);
}

function add(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z
  };
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z
  };
}

function scale(point: Vec3, amount: number): Vec3 {
  return {
    x: point.x * amount,
    y: point.y * amount,
    z: point.z * amount
  };
}

function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function magnitude(point: Vec3): number {
  return Math.sqrt(dot(point, point));
}

function distance(first: Vec3, second: Vec3): number {
  return magnitude(subtract(first, second));
}
