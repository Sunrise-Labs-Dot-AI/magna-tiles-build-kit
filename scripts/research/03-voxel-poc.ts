import { findRawOverlaps } from "@/lib/engine/overlap";
import { SMALL_EDGE, TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";
import { tileLocalVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { TileBasis, TileInstance, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";

const VOXEL = 0.5;
const HALF = SMALL_EDGE / 2;
const BODY_Z_MIN = -6;
const BODY_Z_MAX = 6;
const BODY_Y_MIN = 0;
const BODY_Y_MAX = SMALL_EDGE;
const WING_Y = 0.35;
const SHELL_RADIUS = Math.max(TILE_THICKNESS / 2, VOXEL / 2);

interface Score {
  name: string;
  targetVoxels: number;
  buildVoxels: number;
  intersection: number;
  union: number;
  iou: number;
  targetCoverage: number;
  excessRatio: number;
  rawOverlapPairs: number;
}

const HORIZONTAL_BASIS: TileBasis = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 0, z: 1 },
  zAxis: { x: 0, y: 1, z: 0 }
};

const TOP_BASIS: TileBasis = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 0, z: 1 },
  zAxis: { x: 0, y: -1, z: 0 }
};

const LEFT_SIDE_BASIS: TileBasis = {
  xAxis: { x: 0, y: 0, z: 1 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: -1, y: 0, z: 0 }
};

const RIGHT_SIDE_BASIS: TileBasis = {
  xAxis: { x: 0, y: 0, z: 1 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 1, y: 0, z: 0 }
};

const LEFT_WING_BASIS: TileBasis = {
  xAxis: { x: -1, y: 0, z: 0 },
  yAxis: { x: 0, y: 0, z: 1 },
  zAxis: { x: 0, y: 1, z: 0 }
};

const RIGHT_WING_BASIS: TileBasis = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 0, z: 1 },
  zAxis: { x: 0, y: 1, z: 0 }
};

function tile(id: string, shape: TileShape, position: Vec3, basis: TileBasis): TileInstance {
  return {
    id,
    shape,
    color: "#118ab2",
    position,
    rotation: { x: 0, y: 0, z: 0 },
    basis,
    step: 1,
    role: `${id} scoring tile`
  };
}

function bodyTiles(): TileInstance[] {
  const centers = [-4.5, -1.5, 1.5, 4.5];
  return centers.flatMap((z, index) => [
    tile(`body-bottom-${index + 1}`, "small-square", { x: 0, y: BODY_Y_MIN + TILE_THICKNESS / 2, z }, HORIZONTAL_BASIS),
    tile(`body-top-${index + 1}`, "small-square", { x: 0, y: BODY_Y_MAX - TILE_THICKNESS / 2, z }, TOP_BASIS),
    tile(`body-left-${index + 1}`, "small-square", { x: -HALF + TILE_THICKNESS / 2, y: HALF, z }, LEFT_SIDE_BASIS),
    tile(`body-right-${index + 1}`, "small-square", { x: HALF - TILE_THICKNESS / 2, y: HALF, z }, RIGHT_SIDE_BASIS)
  ]);
}

function wingTiles(): TileInstance[] {
  return [
    tile("left-wing-root", "right-triangle", { x: -3.0, y: WING_Y, z: -1.5 }, LEFT_WING_BASIS),
    tile("left-wing-tip", "right-triangle", { x: -5.6, y: WING_Y, z: -2.2 }, LEFT_WING_BASIS),
    tile("right-wing-root", "right-triangle", { x: 3.0, y: WING_Y, z: -1.5 }, RIGHT_WING_BASIS),
    tile("right-wing-tip", "right-triangle", { x: 5.6, y: WING_Y, z: -2.2 }, RIGHT_WING_BASIS)
  ];
}

function isTargetShell(point: Vec3): boolean {
  return isFuselageShell(point) || isWingShell(point, "left") || isWingShell(point, "right");
}

function isFuselageShell(point: Vec3): boolean {
  const inBody =
    point.x >= -HALF &&
    point.x <= HALF &&
    point.y >= BODY_Y_MIN &&
    point.y <= BODY_Y_MAX &&
    point.z >= BODY_Z_MIN &&
    point.z <= BODY_Z_MAX;
  if (!inBody) return false;

  const distanceToFace = Math.min(
    Math.abs(point.x + HALF),
    Math.abs(point.x - HALF),
    Math.abs(point.y - BODY_Y_MIN),
    Math.abs(point.y - BODY_Y_MAX)
  );
  return distanceToFace <= SHELL_RADIUS;
}

function isWingShell(point: Vec3, side: "left" | "right"): boolean {
  if (Math.abs(point.y - WING_Y) > SHELL_RADIUS) return false;
  const sign = side === "left" ? -1 : 1;
  const polygon = [
    { x: sign * HALF, z: -3.2 },
    { x: sign * 7.2, z: -4.9 },
    { x: sign * HALF, z: 1.2 }
  ];
  return pointInPolygon2d(
    { x: point.x, y: point.z },
    polygon.map((vertex) => ({ x: vertex.x, y: vertex.z }))
  );
}

function tileOccupiesVoxel(point: Vec3, placed: TileInstance): boolean {
  const basis = placed.basis;
  if (!basis) throw new Error(`POC expects explicit basis for ${placed.id}`);

  const delta = subtract(point, placed.position);
  const localPoint = {
    x: dot(delta, basis.xAxis),
    y: dot(delta, basis.yAxis),
    z: dot(delta, basis.zAxis)
  };

  if (Math.abs(localPoint.z) > TILE_THICKNESS / 2 + VOXEL / 2) return false;
  return pointInPolygon2d(
    { x: localPoint.x, y: localPoint.y },
    tileLocalVertices(placed.shape).map((vertex) => ({ x: vertex.x, y: vertex.y }))
  );
}

function scoreBuild(name: string, tiles: TileInstance[]): Score {
  let targetVoxels = 0;
  let buildVoxels = 0;
  let intersection = 0;
  let union = 0;

  for (let x = -8; x <= 8; x += VOXEL) {
    for (let y = -0.25; y <= 3.5; y += VOXEL) {
      for (let z = -6.5; z <= 6.5; z += VOXEL) {
        const point = { x, y, z };
        const target = isTargetShell(point);
        const build = tiles.some((placed) => tileOccupiesVoxel(point, placed));

        if (target) targetVoxels += 1;
        if (build) buildVoxels += 1;
        if (target && build) intersection += 1;
        if (target || build) union += 1;
      }
    }
  }

  return {
    name,
    targetVoxels,
    buildVoxels,
    intersection,
    union,
    iou: round(intersection / union),
    targetCoverage: round(intersection / targetVoxels),
    excessRatio: round(Math.max(0, buildVoxels - intersection) / Math.max(1, buildVoxels)),
    rawOverlapPairs: findRawOverlaps(tiles).length
  };
}

function pointInPolygon2d(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const first = polygon[i];
    const second = polygon[j];
    const intersects =
      first.y > point.y !== second.y > point.y &&
      point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const bodyOnly = bodyTiles();
const bodyWithWings = [...bodyOnly, ...wingTiles()];
const scores = [scoreBuild("body only", bodyOnly), scoreBuild("body + coarse wings", bodyWithWings)];

console.table(scores);
