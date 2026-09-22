import { buildBounds } from "@/lib/engine/build";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal } from "@/lib/magnetic-tiles/prism-geometry";
import { cross, dot, subtract } from "@/lib/engine/math";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import type { Evidence, IntentContract } from "./types";

/** Ray/convex-face intersection; ignores role, title, bounds, program and claimed features. */
type Surface = { normal: Vec3; vertices: Vec3[] };
function hit(point: Vec3, direction: Vec3, tile: Surface): number | null {
  const n = tile.normal,
    vertices = tile.vertices,
    denominator = dot(direction, n);
  if (Math.abs(denominator) < 1e-7) return null;
  const t = dot(subtract(vertices[0], point), n) / denominator;
  if (t < 0) return null;
  const p = {
    x: point.x + t * direction.x,
    y: point.y + t * direction.y,
    z: point.z + t * direction.z,
  };
  const signs = vertices.map((v, i) => ({
    value: dot(
      cross(subtract(vertices[(i + 1) % vertices.length], v), subtract(p, v)),
      n,
    ),
    tolerance:
      0.03 *
      Math.hypot(
        ...Object.values(subtract(vertices[(i + 1) % vertices.length], v)),
      ),
  }));
  // Edge tolerance matches the prism contact tolerance. A point probe at a seam
  // must not interpret sub-millimeter solver separation as an entire missing wall.
  return signs.every((s) => s.value >= -s.tolerance) ||
    signs.every((s) => s.value <= s.tolerance)
    ? t
    : null;
}
function ray(build: { tiles: Surface[] }, p: Vec3, d: Vec3): number | null {
  const hits = build.tiles
    .map((t) => hit(p, d, t))
    .filter((t): t is number => t !== null);
  return hits.length ? Math.min(...hits) : null;
}
function samples(min: number, max: number): number[] {
  const n = Math.max(1, Math.ceil((max - min) / 0.5));
  return Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);
}
function evidence(
  id: string,
  label: string,
  passed: boolean,
  expected: string,
  actual: string,
): Evidence {
  return {
    id,
    label,
    passed,
    expected,
    actual,
    ...(!passed ? { repair: "intent" as const } : {}),
  };
}

export function measureIntent(
  build: BuildGraph,
  c: IntentContract,
  phase: "construction" | "settled" = "construction",
): Evidence[] {
  const scene = {
    tiles: build.tiles.map((tile) => ({
      normal: tileNormal(tile),
      vertices: tileWorldVertices(tile),
    })),
  };
  const b = buildBounds(build.tiles);
  const size = {
    x: b.max.x - b.min.x,
    y: b.max.y - b.min.y,
    z: b.max.z - b.min.z,
  };
  const checks: Evidence[] = [];
  for (const [axis, range] of Object.entries(c.limits)) {
    const value = size[axis as keyof typeof size];
    checks.push(
      evidence(
        `dimension-${axis}`,
        `${axis === "x" ? "Width" : axis === "y" ? "Height" : "Depth"} envelope`,
        value >= range.min - 0.001 && value <= range.max + 0.001,
        `${range.min}–${range.max} in`,
        `${value.toFixed(3)} in`,
      ),
    );
  }
  // Cell counts describe the undeformed catalog layout, not a second inch tolerance.
  // Literal inch limits and every functional feature are still checked after settling.
  for (const key of c.fixed.filter(
    (k) => phase === "construction" && k !== "steps",
  )) {
    const axis = key === "width" ? "x" : key === "height" ? "y" : "z";
    const target = 3 * c.cells[key];
    checks.push(
      evidence(
        `cells-${key}`,
        `Requested ${key}`,
        size[axis] >= target - 0.2 && size[axis] <= target + 0.4,
        `${c.cells[key]} nominal cells (${target} in plus thickness)`,
        `${size[axis].toFixed(3)} in`,
      ),
    );
  }
  if (c.kind === "tower")
    checks.push(
      evidence(
        "tower-aspect",
        "Upright tower",
        size.y > Math.max(size.x, size.z) + 0.5,
        "Height greater than both footprint dimensions",
        `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} in`,
      ),
    );
  // Evaluate coverage at a dense grid inside the actual envelope, not labels or a single center ray.
  const xs = samples(b.min.x + 0.4, b.max.x - 0.4),
    zs = samples(b.min.z + 0.4, b.max.z - 0.4);
  const midY = (b.min.y + b.max.y) / 2;
  const up = { x: 0, y: 1, z: 0 },
    down = { x: 0, y: -1, z: 0 };
  const allTop = xs.every((x) =>
    zs.every((z) => {
      const t = ray(scene, { x, y: b.max.y + 0.3, z }, down);
      return t !== null && t < 0.55;
    }),
  );
  if (c.requireFloors) {
    const floors = Array.from(
      { length: c.cells.height - 1 },
      (_, i) => b.min.y + 3 * (i + 1),
    );
    const covered = floors.every((y) =>
      xs.every((x) =>
        zs.every((z) => {
          const t = ray(scene, { x, y: y + 0.3, z }, down);
          return t !== null && t < 0.6;
        }),
      ),
    );
    checks.push({
      ...evidence(
        "level-floors",
        "Intermediate floors",
        covered,
        `${floors.length} continuous intermediate floors`,
        String(covered),
      ),
      repair: "reinforce",
    });
  }
  if (c.kind === "container") {
    const noTop = xs.every((x) =>
      zs.every(
        (z) =>
          ray(scene, { x, y: b.max.y + 0.3, z }, down) !== null &&
          ray(scene, { x, y: midY, z }, up) === null,
      ),
    );
    const floor = xs.every((x) =>
      zs.every((z) => ray(scene, { x, y: b.min.y + 0.35, z }, down) !== null),
    );
    checks.push(
      evidence(
        "open-top",
        "Open top and floor",
        noTop && floor,
        "Open top above a continuous floor, sampled every ≤0.5 in",
        `open=${noTop}, floor=${floor}`,
      ),
    );
  }
  if (c.kind === "tower" || c.kind === "tunnel")
    checks.push(
      evidence(
        "roof",
        "Continuous roof",
        allTop,
        "Roof above every sampled interior point",
        String(allTop),
      ),
    );
  if (c.kind === "container" || c.kind === "tower" || c.kind === "tunnel") {
    const wallMisses: Vec3[] = [];
    const wallHit = (p: Vec3, d: Vec3) => {
      const found = ray(scene, p, d) !== null;
      if (!found && wallMisses.length < 4) wallMisses.push(p);
      return found;
    };
    const ys = samples(b.min.y + 0.45, b.max.y - 0.45);
    const sideWalls = ys.every((y) =>
      zs.every((z) =>
        [-1, 1].every((x) =>
          wallHit({ x: (b.min.x + b.max.x) / 2, y, z }, { x, y: 0, z: 0 }),
        ),
      ),
    );
    const endWalls = ys.every((y) =>
      xs.every((x) =>
        [-1, 1].every((z) =>
          wallHit({ x, y, z: (b.min.z + b.max.z) / 2 }, { x: 0, y: 0, z }),
        ),
      ),
    );
    checks.push(
      evidence(
        "walls",
        "Enclosing walls",
        sideWalls && (c.kind === "tunnel" || endWalls),
        c.kind === "tunnel"
          ? "Two continuous side walls"
          : "Four continuous walls",
        `sides=${sideWalls}, ends=${endWalls}${sideWalls && (c.kind === "tunnel" || endWalls) ? "" : `; missed probes=${JSON.stringify(wallMisses)}`}`,
      ),
    );
    if (c.kind === "tunnel") {
      const center = (b.min.x + b.max.x) / 2,
        half = c.passage.width / 2;
      const corridorXs = samples(center - half, center + half);
      const floorLevels = [
        ...new Set(
          scene.tiles
            .filter((t) => Math.abs(t.normal.y) > 0.9)
            .map((t) => Math.max(...t.vertices.map((v) => v.y))),
        ),
      ].sort((a, b) => a - b);
      const boxes = build.tiles.map((tile) => buildBounds([tile]));
      const floor = floorLevels.find((y) => {
        const lo = y + 0.2,
          hi = lo + c.passage.height;
        if (
          hi > b.max.y - 0.15 ||
          center - half < b.min.x + 0.15 ||
          center + half > b.max.x - 0.15
        )
          return false;
        if (
          boxes.some(
            (t) =>
              t.max.x > center - half &&
              t.min.x < center + half &&
              t.max.y > lo &&
              t.min.y < hi &&
              t.max.z > b.min.z + 0.4 &&
              t.min.z < b.max.z - 0.4,
          )
        )
          return false;
        const openEnds = samples(lo, hi).every((y) =>
          corridorXs.every((x) =>
            [-1, 1].every(
              (z) =>
                ray(
                  scene,
                  { x, y, z: (b.min.z + b.max.z) / 2 },
                  { x: 0, y: 0, z },
                ) === null,
            ),
          ),
        );
        const floorCovered = corridorXs.every((x) =>
          zs.every((z) => {
            const d = ray(scene, { x, y: y + 0.15, z }, down);
            return d !== null && d < 0.3;
          }),
        );
        return openEnds && floorCovered;
      });
      checks.push({
        ...evidence(
          "clear-interior",
          "Usable through passage",
          floor !== undefined,
          `Continuous floor and unobstructed ${c.passage.width} × ${c.passage.height} in passage with two open ends`,
          floor === undefined
            ? "No clear passage found"
            : `Passage floor at ${floor.toFixed(3)} in`,
        ),
        repair: "reinforce",
      });
    }
    if (c.kind === "container") {
      // Conservative obstruction test: reject a tile whose AABB enters the required cavity.
      // May reject some rotated but actually clear candidates; never accepts a known obstruction.
      const obstruction = build.tiles.some((tile) => {
        const t = buildBounds([tile]);
        return (
          t.max.x > b.min.x + 0.4 &&
          t.min.x < b.max.x - 0.4 &&
          t.max.y > b.min.y + 0.4 &&
          t.min.y < b.max.y - 0.4 &&
          t.max.z > b.min.z + 0.4 &&
          t.min.z < b.max.z - 0.4
        );
      });
      checks.push(
        evidence(
          "clear-interior",
          "Usable interior",
          !obstruction,
          "Unobstructed cavity",
          `obstruction=${obstruction}`,
        ),
      );
    }
  }
  if (c.kind === "staircase") {
    // A nearly vertical riser face is not a tread. After a tiny release rotation,
    // casting against every face can invent a spurious level along that face.
    const treadScene = {
      tiles: scene.tiles.filter((t) => Math.abs(t.normal.y) > 0.9),
    };
    const profile = (z: number): number[] | null => {
      const heights: number[] = [];
      for (const x of samples(b.min.x + 0.5, b.max.x - 0.5)) {
        // A vertical riser seam can project a ≤0.36-inch gap between adjoining boxes.
        // Require nearby tread coverage; a missing 3-inch panel cannot pass this allowance.
        const hits = [0, -0.18, 0.18]
          .map((offset) =>
            ray(treadScene, { x: x + offset, y: b.max.y + 1, z }, down),
          )
          .filter((d): d is number => d !== null);
        if (!hits.length) return null;
        const d = Math.min(...hits);
        const h = Math.round((b.max.y + 1 - d - b.min.y) * 10) / 10;
        if (!heights.length || Math.abs(h - heights.at(-1)!) > 0.3)
          heights.push(h);
      }
      return heights;
    };
    const heights = profile((b.min.z + b.max.z) / 2) ?? [];
    const ordered = heights.every(
      (h, i) => i === 0 || h > heights[i - 1] + 2.5,
    );
    checks.push(
      evidence(
        "stair-treads",
        "Ascending usable treads",
        ordered &&
          heights.length === c.cells.steps &&
          zs.every((z) => {
            const other = profile(z);
            return (
              other?.length === heights.length &&
              other.every((h, i) => Math.abs(h - heights[i]) <= 0.4)
            );
          }),
        `${c.cells.steps} distinct ascending 3-inch risers`,
        `${heights.length} levels: ${heights.join(", ")} in`,
      ),
    );
  }
  return checks;
}
