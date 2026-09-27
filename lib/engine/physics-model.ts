import { buildBounds, driveSurfaceTiles, normalizeBuild, physicalSpecForTile, tilePrismPoints, validateMagneticBuild, type EdgeGeometry, type EngineBuild, type ValidatedConnection } from "./build";
import {
  DROP_HEIGHT,
  EDGE_BREAK_DAMPING,
  EDGE_BREAK_DISTANCE,
  EDGE_BREAK_STIFFNESS,
  ENGINE_UNITS_PER_METER,
  MAGNET_HOLD_FORCE,
  ROLL_BALL_RADIUS
} from "./constants";
import { add, distance, dot, magnitude, midpoint, normalize, quaternionToBasis, scale, subtract, transformLocal } from "./math";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";

export interface PhysicsBodyModel {
  tile: TileInstance;
  translation: Vec3;
  targetPosition: Vec3;
  localHullPoints: Float32Array;
  mass: number;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
}

export interface PhysicsGroundModel {
  position: Vec3;
  halfExtents: Vec3;
}

export interface PhysicsJointModel {
  id: string;
  connection: ValidatedConnection;
  fromTileId: string;
  toTileId: string;
  fromLocalAnchor: Vec3;
  toLocalAnchor: Vec3;
  axis: Vec3;
  fromLocal: EdgeGeometry;
  toLocal: EdgeGeometry;
}

export interface MagneticPhysicsModel {
  build: EngineBuild;
  bodies: PhysicsBodyModel[];
  joints: PhysicsJointModel[];
  ground: PhysicsGroundModel;
  rejectedReasons: string[];
}

export interface JointBreakSample {
  midpointDistance: number;
  estimatedForce: number;
  shouldBreak: boolean;
}

export interface RollTestPlan {
  start: Vec3;
  clearanceStart: Vec3;
  bottom: Vec3;
  axis: Vec3;
  downhill: Vec3;
  length: number;
  halfWidth: number;
  radius: number;
}

export function createMagneticPhysicsModel(input: EngineBuild, options: { drop?: boolean; floorY?: number } = {}): MagneticPhysicsModel {
  const build = normalizeBuild(input);
  const validation = validateMagneticBuild(build);
  if (options.floorY !== undefined && !Number.isFinite(options.floorY)) throw new Error("Invalid assembly floor");
  const targetOffsetY = options.floorY === undefined ? computeGroundOffset(build.tiles) : -options.floorY;
  const offsetY = targetOffsetY + (options.drop ?? true ? DROP_HEIGHT : 0);
  const bodies = build.tiles.map((tile) => createBodyModel(tile, offsetY, targetOffsetY));
  const byId = new Map(bodies.map((body) => [body.tile.id, body]));

  return {
    build,
    bodies,
    joints: validation.validConnections.flatMap((connection) => {
      const from = byId.get(connection.connection.fromTileId);
      const to = byId.get(connection.connection.toTileId);
      if (!from || !to) return [];
      return [createJointModel(from.tile, to.tile, connection)];
    }),
    ground: createGroundModel(build.tiles),
    rejectedReasons: validation.rejectedReasons
  };
}

export function gravityVector(): Vec3 {
  return { x: 0, y: -9.81 * ENGINE_UNITS_PER_METER, z: 0 };
}

export function sampleJointBreak(
  fromEdge: EdgeGeometry,
  toEdge: EdgeGeometry,
  previousDistance: number,
  timestepSeconds: number
): JointBreakSample {
  const midpointDistance = distance(fromEdge.midpoint, toEdge.midpoint);
  const relativeSpeed = Math.abs(midpointDistance - previousDistance) / timestepSeconds;
  const estimatedForce = EDGE_BREAK_STIFFNESS * midpointDistance + EDGE_BREAK_DAMPING * relativeSpeed;

  return {
    midpointDistance,
    estimatedForce,
    shouldBreak: midpointDistance > EDGE_BREAK_DISTANCE || estimatedForce > MAGNET_HOLD_FORCE
  };
}

export function currentWorldEdgeFromBody(
  translation: Vec3,
  rotation: { x: number; y: number; z: number; w: number },
  localEdge: EdgeGeometry
): EdgeGeometry {
  const basis = quaternionToBasis(rotation);
  const start = transformLocal(localEdge.start, translation, basis);
  const end = transformLocal(localEdge.end, translation, basis);
  const edgeVector = subtract(end, start);
  return {
    start,
    end,
    midpoint: midpoint(start, end),
    direction: normalize(edgeVector),
    length: magnitude(edgeVector)
  };
}

export function createRollTestPlan(build: EngineBuild): RollTestPlan | null {
  const drive = driveSurfaceTiles(normalizeBuild(build));
  if (drive.length === 0) return null;
  const slopedDrive = drive.filter((tile) => tileVerticalSpan(tile) > ROLL_BALL_RADIUS);
  if (slopedDrive.length === 0) return null;
  const points = slopedDrive.flatMap((tile) => tileWorldVertices(tile));
  if (points.length === 0) return null;
  const maxY = Math.max(...points.map((point) => point.y));
  const minY = Math.min(...points.map((point) => point.y));
  const top = averagePoints(points.filter((point) => maxY - point.y <= 0.08));
  const bottom = averagePoints(points.filter((point) => point.y - minY <= 0.08));
  const surfaceDownhill = normalize(subtract(bottom, top));
  const surfaceAxis = normalize({ x: surfaceDownhill.x, y: 0, z: surfaceDownhill.z });
  if (magnitude(surfaceAxis) <= 0.000001) return null;
  const start = add(top, scale(surfaceDownhill, 0.25));
  const clearanceStart = add(top, scale(surfaceAxis, -(ROLL_BALL_RADIUS + 0.15)));
  const downhill = normalize(subtract(bottom, start));
  const axis = normalize({ x: downhill.x, y: 0, z: downhill.z });
  const lateralAxis = normalize({ x: -axis.z, y: 0, z: axis.x });
  const lateralCoordinates = points.map((point) => dot(point, lateralAxis));
  const halfWidth = Math.max(
    0.8,
    (Math.max(...lateralCoordinates) - Math.min(...lateralCoordinates)) / 2
  );

  return {
    start,
    clearanceStart: { ...clearanceStart, y: Math.max(clearanceStart.y, maxY) },
    bottom,
    axis,
    downhill,
    length: Math.max(0.001, dot(subtract(bottom, start), axis)),
    halfWidth,
    radius: ROLL_BALL_RADIUS
  };
}

function tileVerticalSpan(tile: TileInstance): number {
  const vertices = tileWorldVertices(tile);
  return Math.max(...vertices.map((point) => point.y)) - Math.min(...vertices.map((point) => point.y));
}

function averagePoints(points: Vec3[]): Vec3 {
  return scale(
    points.reduce((sum, point) => add(sum, point), { x: 0, y: 0, z: 0 }),
    1 / Math.max(1, points.length)
  );
}

export function isFunctionalRamp(build: EngineBuild): boolean {
  if (build.family === "ramp") return true;
  return build.tiles.some((tile) => /driv|deck|ramp|landing|runout|slope/i.test(tile.role));
}

function createBodyModel(tile: TileInstance, offsetY: number, targetOffsetY: number): PhysicsBodyModel {
  return {
    tile,
    translation: { x: tile.position.x, y: tile.position.y + offsetY, z: tile.position.z },
    targetPosition: { x: tile.position.x, y: tile.position.y + targetOffsetY, z: tile.position.z },
    localHullPoints: tilePrismPoints(tile),
    mass: physicalSpecForTile(tile).mass,
    linearVelocity: { x: imperfection(tile.id, 0.018), y: 0, z: imperfection(`${tile.id}:z`, 0.018) },
    angularVelocity: {
      x: imperfection(`${tile.id}:rx`, 0.01),
      y: imperfection(`${tile.id}:ry`, 0.012),
      z: imperfection(`${tile.id}:rz`, 0.01)
    }
  };
}

function createJointModel(from: TileInstance, to: TileInstance, connection: ValidatedConnection): PhysicsJointModel {
  const shared = sharedEdgePoint(connection.fromEdge, connection.toEdge);
  return {
    id: connection.id,
    connection,
    fromTileId: connection.connection.fromTileId,
    toTileId: connection.connection.toTileId,
    fromLocalAnchor: subtract(shared, from.position),
    toLocalAnchor: subtract(shared, to.position),
    axis: normalize(connection.fromEdge.direction),
    fromLocal: edgePointToLocal(shared, from),
    toLocal: edgePointToLocal(shared, to)
  };
}

function sharedEdgePoint(first: EdgeGeometry, second: EdgeGeometry): Vec3 {
  if (first.length > second.length + 0.05) return second.midpoint;
  if (second.length > first.length + 0.05) return first.midpoint;
  const axis = normalize(first.direction);
  const firstStart = dot(first.start, axis);
  const firstEnd = dot(first.end, axis);
  const secondStart = dot(second.start, axis);
  const secondEnd = dot(second.end, axis);
  const overlapMin = Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd));
  const overlapMax = Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd));
  const coordinate = overlapMin <= overlapMax ? (overlapMin + overlapMax) / 2 : (firstStart + firstEnd + secondStart + secondEnd) / 4;
  const reference = midpoint(first.midpoint, second.midpoint);
  const referenceCoordinate = dot(reference, axis);
  return add(reference, scale(axis, coordinate - referenceCoordinate));
}

function edgePointToLocal(point: Vec3, tile: TileInstance): EdgeGeometry {
  const local = subtract(point, tile.position);
  return {
    start: local,
    end: local,
    midpoint: local,
    direction: { x: 0, y: 0, z: 0 },
    length: 0
  };
}

function createGroundModel(tiles: TileInstance[]): PhysicsGroundModel {
  const bounds = buildBounds(tiles);
  const width = Math.max(24, bounds.max.x - bounds.min.x + 18);
  const depth = Math.max(24, bounds.max.z - bounds.min.z + 18);
  return {
    position: {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: -0.08,
      z: (bounds.min.z + bounds.max.z) / 2
    },
    halfExtents: { x: width / 2, y: 0.08, z: depth / 2 }
  };
}

function computeGroundOffset(tiles: TileInstance[]): number {
  const bounds = buildBounds(tiles);
  return Number.isFinite(bounds.min.y) ? -bounds.min.y : 0;
}

function imperfection(id: string, amplitude: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return ((hash % 2001) / 1000 - 1) * amplitude;
}
