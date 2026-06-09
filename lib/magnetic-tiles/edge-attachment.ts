import { TILE_THICKNESS } from "./catalog";
import { findMagneticEdgeMatch, tileLocalVertices } from "./magnet-geometry";
import { tilesIntersectAsPrisms } from "./prism-geometry";
import type { TileBasis, TileInstance, TileShape, Vec3 } from "./types";

const FOLD_EPSILON = 0.0001;

export interface EdgePlacedTile {
  key: string;
  shape: TileShape;
  position: Vec3;
  basis: TileBasis;
  color?: string;
  step: number;
  role: string;
  subassemblyId?: string;
  parentTileId?: string;
  parentEdge?: number;
  childEdge?: number;
  foldAngle?: number;
  root?: boolean;
}

export interface EdgeAttachment {
  key: string;
  shape: TileShape;
  attachTo: string;
  parentEdge: number;
  childEdge: number;
  foldAngle: number;
  edgeAlign?: "start" | "center";
  edgeOffset?: number;
  reverse?: boolean;
  color?: string;
  step: number;
  role: string;
  subassemblyId?: string;
}

export function makeAnchorTile(
  key: string,
  shape: TileShape,
  position: Vec3,
  basis: TileBasis = identityBasis(),
  step = 1,
  role = "anchor",
  color?: string
): EdgePlacedTile {
  return { key, shape, position, basis, step, role, color, root: true };
}

export function attachTile(parent: EdgePlacedTile, attachment: EdgeAttachment): EdgePlacedTile {
  const parentEdge = worldEdge(parent, attachment.parentEdge);
  const parentDirection = normalize(subtract(parentEdge.end, parentEdge.start));
  const childNormal = normalize(rotateAroundAxis(parent.basis.zAxis, parentDirection, attachment.foldAngle));
  const childVertices = tileLocalVertices(attachment.shape);
  const childStart = childVertices[attachment.childEdge];
  const childEnd = childVertices[(attachment.childEdge + 1) % childVertices.length];
  const childEdgeVector = subtract(childEnd, childStart);
  const childEdgeLengthSquared = dot(childEdgeVector, childEdgeVector);
  const directedParentStart = attachment.reverse ? parentEdge.end : parentEdge.start;
  const directedParentEnd = attachment.reverse ? parentEdge.start : parentEdge.end;
  const targetDirection = normalize(subtract(directedParentEnd, directedParentStart));
  const targetStart =
    attachment.edgeAlign === "center"
      ? subtract(
          add(scale(add(directedParentStart, directedParentEnd), 0.5), scale(targetDirection, attachment.edgeOffset ?? 0)),
          scale(targetDirection, Math.sqrt(childEdgeLengthSquared) / 2)
        )
      : directedParentStart;
  const childPerpendicular = { x: -childEdgeVector.y, y: childEdgeVector.x, z: 0 };
  const childPerpendicularLengthSquared = dot(childPerpendicular, childPerpendicular);
  const worldPerpendicular = scale(
    normalize(cross(childNormal, targetDirection)),
    Math.sqrt(childPerpendicularLengthSquared)
  );
  const worldEdgeVector = scale(targetDirection, Math.sqrt(childEdgeLengthSquared));
  const basis = basisFromEdgeMapping(childEdgeVector, worldEdgeVector, childPerpendicular, worldPerpendicular, childNormal);
  const positionedChildEdgeStart = add(
    add(scale(basis.xAxis, childStart.x), scale(basis.yAxis, childStart.y)),
    scale(basis.zAxis, childStart.z)
  );
  const position = subtract(targetStart, positionedChildEdgeStart);
  const unoffsetChild = {
    key: attachment.key,
    shape: attachment.shape,
    position,
    basis,
    color: attachment.color,
    step: attachment.step,
    role: attachment.role,
    subassemblyId: attachment.subassemblyId ?? parent.subassemblyId,
    parentTileId: attachment.attachTo,
    parentEdge: attachment.parentEdge,
    childEdge: attachment.childEdge,
    foldAngle: attachment.foldAngle
  };
  const physicalPosition = resolveFoldThicknessOffset(parent, unoffsetChild, attachment.foldAngle);

  return {
    key: attachment.key,
    shape: attachment.shape,
    position: physicalPosition,
    basis,
    color: attachment.color,
    step: attachment.step,
    role: attachment.role,
    subassemblyId: attachment.subassemblyId ?? parent.subassemblyId,
    parentTileId: attachment.attachTo,
    parentEdge: attachment.parentEdge,
    childEdge: attachment.childEdge,
    foldAngle: attachment.foldAngle
  };
}

function resolveFoldThicknessOffset(
  parent: EdgePlacedTile,
  child: EdgePlacedTile,
  foldAngle: number
): Vec3 {
  if (Math.abs(foldAngle) <= FOLD_EPSILON) return child.position;

  const parentTile = edgePlacedToTile(parent);
  const childTile = edgePlacedToTile(child);
  if (!tilesIntersectAsPrisms(parentTile, childTile).overlaps) return child.position;

  const parentNormal = parent.basis.zAxis;
  const childNormal = child.basis.zAxis;
  const candidates = [-1, 1].flatMap((parentSign) =>
    [-1, 1].map((childSign) => {
      const offset = add(
        scale(parentNormal, (parentSign * TILE_THICKNESS) / 2),
        scale(childNormal, (childSign * TILE_THICKNESS) / 2)
      );
      const candidateTile = {
        ...childTile,
        position: add(child.position, offset)
      };
      const intersection = tilesIntersectAsPrisms(parentTile, candidateTile);
      const edgeMatch = findMagneticEdgeMatch(parentTile, candidateTile);
      return {
        position: candidateTile.position,
        penetration: intersection.overlaps ? intersection.penetration : 0,
        edgeDistance: edgeMatch?.midpointDistance ?? Number.POSITIVE_INFINITY
      };
    })
  );

  candidates.sort((first, second) =>
    first.penetration - second.penetration ||
    first.edgeDistance - second.edgeDistance ||
    first.position.x - second.position.x ||
    first.position.y - second.position.y ||
    first.position.z - second.position.z
  );

  return candidates[0]?.position ?? child.position;
}

function edgePlacedToTile(tile: EdgePlacedTile): TileInstance {
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

export function worldEdge(tile: EdgePlacedTile, edgeIndex: number): { start: Vec3; end: Vec3 } {
  const vertices = tileLocalVertices(tile.shape).map((point) => transform(point, tile.position, tile.basis));
  return {
    start: vertices[edgeIndex],
    end: vertices[(edgeIndex + 1) % vertices.length]
  };
}

export function identityBasis(): TileBasis {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: 0, y: 0, z: 1 }
  };
}

export function basisFromEuler(rx = 0, ry = 0, rz = 0): TileBasis {
  return {
    xAxis: rotateEuler({ x: 1, y: 0, z: 0 }, rx, ry, rz),
    yAxis: rotateEuler({ x: 0, y: 1, z: 0 }, rx, ry, rz),
    zAxis: rotateEuler({ x: 0, y: 0, z: 1 }, rx, ry, rz)
  };
}

function basisFromEdgeMapping(
  localEdge: Vec3,
  worldEdgeVector: Vec3,
  localPerpendicular: Vec3,
  worldPerpendicular: Vec3,
  worldNormal: Vec3
): TileBasis {
  const determinant = localEdge.x * localPerpendicular.y - localEdge.y * localPerpendicular.x;
  const xAxis = add(
    scale(worldEdgeVector, localPerpendicular.y / determinant),
    scale(worldPerpendicular, -localEdge.y / determinant)
  );
  const yAxis = add(
    scale(worldEdgeVector, -localPerpendicular.x / determinant),
    scale(worldPerpendicular, localEdge.x / determinant)
  );

  return {
    xAxis: normalize(xAxis),
    yAxis: normalize(yAxis),
    zAxis: worldNormal
  };
}

function transform(point: Vec3, position: Vec3, basis: TileBasis): Vec3 {
  return add(add(scale(basis.xAxis, point.x), scale(basis.yAxis, point.y)), add(scale(basis.zAxis, point.z), position));
}

function rotateEuler(point: Vec3, rx: number, ry: number, rz: number): Vec3 {
  const z = rotateZ(point, rz);
  const y = rotateY(z, ry);
  return rotateX(y, rx);
}

function rotateAroundAxis(point: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(add(scale(point, cos), scale(cross(unit, point), sin)), scale(unit, dot(unit, point) * (1 - cos)));
}

function rotateX(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x, y: point.y * cos - point.z * sin, z: point.y * sin + point.z * cos };
}

function rotateY(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos + point.z * sin, y: point.y, z: -point.x * sin + point.z * cos };
}

function rotateZ(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos, z: point.z };
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

function normalize(point: Vec3): Vec3 {
  const length = Math.sqrt(dot(point, point));
  return scale(point, 1 / Math.max(length, 0.000001));
}
