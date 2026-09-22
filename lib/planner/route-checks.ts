import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal } from "@/lib/magnetic-tiles/prism-geometry";
import {
  add,
  cross,
  distance,
  dot,
  normalize,
  scale,
  subtract,
} from "@/lib/engine/math";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import type { CourseLane, DesignBrief, DesignCheck } from "./types";

/** A point is on the actual convex tile face, not merely inside the course's bounding box. */
export function pointOnSurface(
  point: Vec3,
  build: BuildGraph,
  ids: Set<string>,
  margin = 0,
): boolean {
  return build.tiles.some((tile) => {
    if (!ids.has(tile.id)) return false;
    const vertices = tileWorldVertices(tile),
      n = tileNormal(tile);
    if (Math.abs(dot(subtract(point, vertices[0]), n)) > 0.12) return false;
    const signs = vertices.map((v, i) =>
      dot(
        cross(
          subtract(vertices[(i + 1) % vertices.length], v),
          subtract(point, v),
        ),
        n,
      ),
    );
    return signs.every((s) => s >= margin) || signs.every((s) => s <= -margin);
  });
}

export function checkCourse(
  build: BuildGraph,
  lanes: CourseLane[],
  brief: DesignBrief,
): DesignCheck[] {
  const checks: DesignCheck[] = [];
  checks.push(
    check(
      "lane-count",
      "Separate lanes",
      lanes.length === brief.lanes,
      `${lanes.length} modeled lane(s); ${brief.lanes} requested.`,
    ),
  );
  for (const lane of lanes) {
    const points = lane.waypoints;
    const ids = new Set(lane.surfaceTileIds);
    let continuous = points.length >= 2,
      clearWidth = lane.width >= brief.car.width + 0.2,
      nonIncreasing = true;
    let turns = 0,
      previousDirection: Vec3 | undefined;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        d = subtract(b, a);
      if (distance(a, b) < 0.01) {
        continuous = false;
        continue;
      }
      if (b.y > a.y + 0.12) nonIncreasing = false;
      const direction = normalize({ x: d.x, y: 0, z: d.z });
      if (
        previousDirection &&
        dot(direction, previousDirection) < Math.cos(Math.PI / 9)
      )
        turns++;
      previousDirection = direction;
      const side = normalize({ x: -direction.z, y: 0, z: direction.x });
      const samples = Math.max(2, Math.ceil(distance(a, b) / 0.08));
      for (let j = 0; j <= samples; j++) {
        const p = add(a, scale(d, j / samples));
        if (!pointOnSurface(p, build, ids)) continuous = false;
        // Both tire envelopes must have an actual surface underneath them.
        for (const sign of [-1, 1])
          if (
            !pointOnSurface(
              add(p, scale(side, sign * (brief.car.width / 2 + 0.05))),
              build,
              ids,
            )
          )
            clearWidth = false;
      }
    }
    checks.push(
      check(
        `${lane.id}-surface`,
        `${lane.id}: continuous surface`,
        continuous,
        "The entire route is sampled against tile faces at intervals no greater than 0.08 in.",
      ),
    );
    checks.push(
      check(
        `${lane.id}-width`,
        `${lane.id}: car clearance`,
        clearWidth,
        `Checks a ${brief.car.width.toFixed(2)} in wide car plus clearance against the actual road tiles.`,
      ),
    );
    checks.push(
      check(
        `${lane.id}-turns`,
        `${lane.id}: requested turns`,
        turns >= brief.turns,
        `${turns} direction change(s) modeled; ${brief.turns} requested.`,
      ),
    );
    const drop = points.length ? points[0].y - points[points.length - 1].y : 0;
    checks.push(
      check(
        `${lane.id}-descent`,
        `${lane.id}: downhill route`,
        !brief.downhill || (nonIncreasing && drop > 0.2),
        `Net drop ${drop.toFixed(2)} in; ${nonIncreasing ? "no uphill segment" : "contains an uphill segment"}.`,
      ),
    );
  }
  if (lanes.length === 2) {
    const a = lanes[0].waypoints,
      b = lanes[1].waypoints;
    const separated =
      a.length === b.length &&
      a.every((p, i) => distance(p, b[i]) >= brief.car.width + 0.2);
    checks.push(
      check(
        "lane-separation",
        "Side-by-side clearance",
        separated,
        "Checks corresponding points on the two lanes for car-to-car clearance. Both cars are also released together in the dynamics test.",
      ),
    );
  }
  return checks;
}
function check(
  code: string,
  label: string,
  passed: boolean,
  detail: string,
): DesignCheck {
  return { code, label, status: passed ? "pass" : "fail", detail };
}
