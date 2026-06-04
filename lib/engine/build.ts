import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { findMagneticEdgeMatch, tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, MagneticConnection, TileBasis, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { TILE_MASS_KG, TILE_THICKNESS } from "./constants";
import { distance, midpoint, normalize, subtract } from "./math";

export interface EngineBuild {
  id: string;
  title?: string;
  family?: string;
  tiles: TileInstance[];
  connections: MagneticConnection[];
}

export interface TilePhysicalSpec {
  width: number;
  height: number;
  thickness: number;
  mass: number;
}

export interface EdgeGeometry {
  start: Vec3;
  end: Vec3;
  midpoint: Vec3;
  direction: Vec3;
  length: number;
}

export interface ValidatedConnection {
  id: string;
  connection: MagneticConnection;
  fromTile: TileInstance;
  toTile: TileInstance;
  fromEdge: EdgeGeometry;
  toEdge: EdgeGeometry;
  foldAngle: number;
}

export interface BuildValidation {
  validConnections: ValidatedConnection[];
  rejectedReasons: string[];
}

export function normalizeBuild(build: EngineBuild | BuildGraph): EngineBuild {
  return {
    id: build.id,
    title: "title" in build ? build.title : undefined,
    family: "family" in build ? build.family : undefined,
    tiles: build.tiles,
    connections: build.connections ?? []
  };
}

export function physicalSpecForTile(tile: TileInstance): TilePhysicalSpec {
  const spec = TILE_SPECS[tile.shape];
  const area = polygonArea(tileLocalVertices(tile.shape));
  const smallSquareArea = TILE_SPECS["small-square"].width * TILE_SPECS["small-square"].height;

  return {
    width: spec.width,
    height: spec.height,
    thickness: TILE_THICKNESS,
    mass: TILE_MASS_KG * (area / smallSquareArea)
  };
}

export function validateMagneticBuild(build: EngineBuild): BuildValidation {
  const byId = new Map(build.tiles.map((tile) => [tile.id, tile]));
  const connectionKeys = new Set<string>();
  const validConnections: ValidatedConnection[] = [];
  const rejectedReasons: string[] = [];

  for (const connection of build.connections) {
    const fromTile = byId.get(connection.fromTileId);
    const toTile = byId.get(connection.toTileId);
    if (!fromTile || !toTile) {
      rejectedReasons.push(`missing-tile:${connection.fromTileId}->${connection.toTileId}`);
      continue;
    }

    const match = findMagneticEdgeMatch(fromTile, toTile);
    if (!match || match.fromEdge !== connection.fromEdge || match.toEdge !== connection.toEdge) {
      rejectedReasons.push(`invalid-edge:${connection.fromTileId}:${connection.fromEdge}->${connection.toTileId}:${connection.toEdge}`);
      continue;
    }

    const id = connectionId(connection);
    if (connectionKeys.has(id)) continue;
    connectionKeys.add(id);
    validConnections.push({
      id,
      connection,
      fromTile,
      toTile,
      fromEdge: worldEdge(fromTile, connection.fromEdge),
      toEdge: worldEdge(toTile, connection.toEdge),
      foldAngle: foldAngleBetween(fromTile.basis ?? identityBasis(), toTile.basis ?? identityBasis())
    });
  }

  const connected = new Set<string>();
  if (build.tiles[0]) connected.add(build.tiles[0].id);

  let changed = true;
  while (changed) {
    changed = false;
    for (const { connection } of validConnections) {
      if (connected.has(connection.fromTileId) && !connected.has(connection.toTileId)) {
        connected.add(connection.toTileId);
        changed = true;
      }
      if (connected.has(connection.toTileId) && !connected.has(connection.fromTileId)) {
        connected.add(connection.fromTileId);
        changed = true;
      }
    }
  }

  for (const tile of build.tiles) {
    const isOnlyTile = build.tiles.length === 1;
    const isConnected = connected.has(tile.id);
    const hasParent = tile.parentTileId || tile.root || isOnlyTile;
    if (!isConnected) rejectedReasons.push(`disconnected-tile:${tile.id}`);
    if (!isOnlyTile && !hasParent) rejectedReasons.push(`unsnapped-tile:${tile.id}`);
  }

  if (build.tiles.length > 1 && validConnections.length === 0) {
    rejectedReasons.push("no-valid-magnetic-joints");
  }

  return { validConnections, rejectedReasons };
}

export function connectionId(connection: MagneticConnection): string {
  return `${connection.fromTileId}:${connection.fromEdge}->${connection.toTileId}:${connection.toEdge}`;
}

export function worldEdge(tile: TileInstance, edgeIndex: number): EdgeGeometry {
  const vertices = tileWorldVertices(tile);
  const start = vertices[edgeIndex];
  const end = vertices[(edgeIndex + 1) % vertices.length];
  const vector = subtract(end, start);
  return {
    start,
    end,
    midpoint: midpoint(start, end),
    direction: normalize(vector),
    length: distance(start, end)
  };
}

export function tilePrismPoints(tile: TileInstance): Float32Array {
  const points = tilePrismVertices(tile, TILE_THICKNESS).map((point) => subtract(point, tile.position));
  return new Float32Array(points.flatMap((point) => [point.x, point.y, point.z]));
}

export function driveSurfaceTiles(build: EngineBuild): TileInstance[] {
  const driveTiles = build.tiles.filter((tile) => isDriveSurfaceRole(tile.role));
  return driveTiles.length > 0
    ? driveTiles
    : build.tiles.filter((tile) => Math.abs((tile.basis?.zAxis.y ?? 0)) > 0.35 && !isSupportRole(tile.role));
}

function isDriveSurfaceRole(role: string): boolean {
  if (/wall|brace|leg|side|vertical/i.test(role)) return false;
  return /driv|deck|landing|runout|slope/i.test(role) || (/ramp/i.test(role) && !isSupportRole(role));
}

function isSupportRole(role: string): boolean {
  return /wall|brace|leg|side/i.test(role) || (/support/i.test(role) && !/driv|deck|landing|runout|slope/i.test(role));
}

export function buildBounds(tiles: TileInstance[]): { min: Vec3; max: Vec3 } {
  const vertices = tiles.flatMap((tile) => tilePrismVertices(tile, TILE_THICKNESS));
  return vertices.reduce(
    (bounds, point) => ({
      min: {
        x: Math.min(bounds.min.x, point.x),
        y: Math.min(bounds.min.y, point.y),
        z: Math.min(bounds.min.z, point.z)
      },
      max: {
        x: Math.max(bounds.max.x, point.x),
        y: Math.max(bounds.max.y, point.y),
        z: Math.max(bounds.max.z, point.z)
      }
    }),
    {
      min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
      max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY }
    }
  );
}

function polygonArea(points: Vec3[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function foldAngleBetween(first: TileBasis, second: TileBasis): number {
  const shared = normalize(crossOrFallback(first.zAxis, second.zAxis, first.xAxis));
  const sin = shared.y >= 0 ? distance(first.zAxis, second.zAxis) / 2 : -distance(first.zAxis, second.zAxis) / 2;
  const cos = first.zAxis.x * second.zAxis.x + first.zAxis.y * second.zAxis.y + first.zAxis.z * second.zAxis.z;
  return Math.atan2(Math.max(-1, Math.min(1, sin * 2)), cos);
}

function crossOrFallback(first: Vec3, second: Vec3, fallback: Vec3): Vec3 {
  const crossed = {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  };
  return distance(crossed, { x: 0, y: 0, z: 0 }) > 0.000001 ? crossed : fallback;
}

function identityBasis(): TileBasis {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 }
  };
}
