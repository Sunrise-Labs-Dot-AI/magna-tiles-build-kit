import { buildBounds } from "@/lib/engine/build";
import {
  add,
  cross,
  distance,
  dot,
  normalize,
  scale,
  subtract,
  transformLocal,
} from "@/lib/engine/math";
import { composeMacros } from "@/lib/magnetic-tiles/macros";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import {
  tileLocalVertices,
  tileWorldVertices,
} from "@/lib/magnetic-tiles/magnet-geometry";
import type {
  BuildGraph,
  TileInstance,
  TileShape,
  Vec3,
} from "@/lib/magnetic-tiles/types";
import type { Replica, StagePose } from "./types";

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const IDENTITY = {
  xAxis: v(1, 0, 0),
  yAxis: v(0, 1, 0),
  zAxis: v(0, 0, 1),
};

/** Map a catalog polygon to measured topology, rejecting stretching, shear and warping. */
export function rigidPanel(
  id: string,
  shape: TileShape,
  corners: Vec3[],
  color: string,
  step: number,
  group: string,
): TileInstance {
  const local = tileLocalVertices(shape);
  if (
    local.length !== corners.length ||
    corners.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    throw new Error(`Invalid corners for ${id}`);
  const xAxis = normalize(subtract(corners[1], corners[0]));
  const d = subtract(corners[2], corners[0]);
  const yAxis = normalize(subtract(d, scale(xAxis, dot(d, xAxis))));
  const zAxis = cross(xAxis, yAxis);
  const basis = { xAxis, yAxis, zAxis };
  const position = subtract(
    corners[0],
    transformLocal(local[0], v(0, 0, 0), basis),
  );
  const tile: TileInstance = {
    id,
    shape,
    color,
    position,
    basis,
    rotation: v(0, 0, 0),
    step,
    role: group,
    subassemblyId: group,
    root: true,
  };
  if (tileWorldVertices(tile).some((p, i) => distance(p, corners[i]) > 1e-6))
    throw new Error(`Non-catalog geometry: ${id}`);
  return tile;
}

export function square(
  id: string,
  origin: Vec3,
  u: Vec3,
  w: Vec3,
  color: string,
  step: number,
  group: string,
  shape: "small-square" | "xl-square" = "small-square",
) {
  return rigidPanel(
    id,
    shape,
    [origin, add(origin, u), add(add(origin, u), w), add(origin, w)],
    color,
    step,
    group,
  );
}

/** Polygon vertices describe the inside face of a shell. Move its centre by half thickness.
 * This models finite thickness without enlarging tiles or relaxing intersection tolerance.
 */
export function outside(
  tile: TileInstance,
  interior: Vec3,
  halfThickness = 0.09,
): TileInstance {
  const normal = tile.basis!.zAxis;
  const sign = dot(subtract(tile.position, interior), normal) >= 0 ? 1 : -1;
  return {
    ...tile,
    position: add(tile.position, scale(normal, sign * halfThickness)),
  };
}

export function assemble(
  id: string,
  title: string,
  tiles: TileInstance[],
  family: BuildGraph["family"],
): BuildGraph {
  const graph = composeMacros({ tiles, connections: [] });
  const b = buildBounds(graph.tiles);
  return {
    id,
    title,
    prompt: title,
    summary:
      "Source-constrained reconstruction candidate. Read the independent evidence before building.",
    seed: 0,
    family,
    inventoryPreset: "builder-xl",
    ...graph,
    bounds: {
      width: b.max.x - b.min.x,
      height: b.max.y - b.min.y,
      depth: b.max.z - b.min.z,
    },
  };
}

export function stageBuild(
  replica: Pick<Replica, "build">,
  stage: StagePose,
): BuildGraph {
  const ids = new Set(stage.tileIds);
  if (
    !ids.size ||
    ids.size !== stage.tileIds.length ||
    stage.tileIds.some((id) => !replica.build.tiles.some((t) => t.id === id))
  )
    throw new Error(`Invalid stage membership: ${stage.id}`);
  const tiles = replica.build.tiles
    .filter((t) => ids.has(t.id))
    .map((t) => structuredClone(t));
  if (stage.transform) {
    const { basis, translation } = stage.transform;
    const axes = [basis.xAxis, basis.yAxis, basis.zAxis];
    if (
      ![...axes, translation].every((p) =>
        [p.x, p.y, p.z].every(Number.isFinite),
      ) ||
      axes.some((a) => Math.abs(dot(a, a) - 1) > 1e-6) ||
      Math.abs(dot(axes[0], axes[1])) > 1e-6 ||
      dot(cross(axes[0], axes[1]), axes[2]) < 1 - 1e-6
    )
      throw new Error(`Non-rigid stage transform: ${stage.id}`);
    for (const tile of tiles) {
      tile.position = transformLocal(tile.position, translation, basis);
      const rotate = (p: Vec3) => transformLocal(p, v(0, 0, 0), basis);
      const b =
        tile.basis ??
        basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z);
      tile.basis = {
        xAxis: rotate(b.xAxis),
        yAxis: rotate(b.yAxis),
        zAxis: rotate(b.zAxis),
      };
    }
  }
  const b = buildBounds(tiles);
  return {
    ...replica.build,
    tiles,
    connections: replica.build.connections.filter(
      (c) => ids.has(c.fromTileId) && ids.has(c.toTileId),
    ),
    bounds: {
      width: b.max.x - b.min.x,
      height: b.max.y - b.min.y,
      depth: b.max.z - b.min.z,
    },
  };
}
