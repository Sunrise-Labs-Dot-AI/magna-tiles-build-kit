import {
  ColliderDesc,
  JointData,
  RigidBodyDesc,
  type RigidBody,
} from "@dimforge/rapier3d-compat";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import {
  add,
  cross,
  distance,
  dot,
  normalize,
  scale,
  subtract,
} from "@/lib/engine/math";
import {
  MAX_STANDING_DISPLACEMENT,
  SIMULATION_TIMESTEP_SECONDS,
} from "@/lib/engine/constants";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import type { CarTrial, CourseLane, DesignBrief } from "./types";

/** Free dynamics: four unpowered axle-constrained wheels. Waypoints only judge progress. */
export async function testCars(
  build: BuildGraph,
  lanes: CourseLane[],
  brief: DesignBrief,
): Promise<CarTrial[]> {
  const engine = await createEngineWorld(build, { drop: false });
  try {
    for (let i = 0; i < 240; i++) engine.step();
    if (
      engine.rejectedReasons.length ||
      engine.poppedJoints.length ||
      engine.maxDisplacement() > MAX_STANDING_DISPLACEMENT
    )
      return lanes.map((lane) => ({
        laneId: lane.id,
        passed: false,
        reachedWaypoint: 0,
        reason:
          "The structure moved or lost a joint before releasing the cars.",
        samples: [],
      }));
    const cars = lanes.map((lane) => {
      const forward = normalize(subtract(lane.waypoints[1], lane.waypoints[0]));
      const side = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
      const up = normalize(cross(side, forward));
      const center = add(
        lane.waypoints[0],
        scale(up, brief.car.wheelRadius + 0.14),
      );
      const firstTile = build.tiles[0];
      center.y +=
        engine.bodies.get(firstTile.id)!.targetPosition.y -
        firstTile.position.y;
      const transform = (x: number, y: number, z: number) =>
        add(add(scale(forward, x), scale(up, y)), scale(side, z));
      const hull = new Float32Array(
        [-1, 1].flatMap((x) =>
          [-1, 1].flatMap((y) =>
            [-1, 1].flatMap((z) => {
              const p = transform(
                (x * brief.car.length) / 2,
                y * 0.12,
                z * (brief.car.width / 2 - 0.13),
              );
              return [p.x, p.y, p.z];
            }),
          ),
        ),
      );
      const chassis = engine.world.createRigidBody(
        RigidBodyDesc.dynamic()
          .setTranslation(center.x, center.y, center.z)
          .setCcdEnabled(true),
      );
      const collider = ColliderDesc.convexHull(hull);
      if (!collider) throw new Error("Unable to construct car collider.");
      engine.world.createCollider(
        collider
          .setMass(brief.car.massKg * 0.8)
          .setFriction(0.3)
          .setRestitution(0),
        chassis,
      );
      const wheels: RigidBody[] = [];
      for (const axle of [-1, 1])
        for (const edge of [-1, 1]) {
          const anchor = transform(
            axle * brief.car.length * 0.32,
            -0.04,
            edge * (brief.car.width / 2 - brief.car.wheelRadius),
          );
          const p = add(center, anchor);
          const wheel = engine.world.createRigidBody(
            RigidBodyDesc.dynamic()
              .setTranslation(p.x, p.y, p.z)
              .setCcdEnabled(true),
          );
          engine.world.createCollider(
            ColliderDesc.ball(brief.car.wheelRadius)
              .setMass(brief.car.massKg * 0.05)
              .setFriction(0.8)
              .setRestitution(0),
            wheel,
          );
          engine.world
            .createImpulseJoint(
              JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, side),
              chassis,
              wheel,
              true,
            )
            .setContactsEnabled(false);
          wheels.push(wheel);
        }
      return {
        lane,
        chassis,
        wheels,
        next: 1,
        done: false,
        result: {
          laneId: lane.id,
          passed: false,
          reachedWaypoint: 0,
          reason: "Car stopped before the finish.",
          samples: [{ time: 0, position: { ...center } }],
        } as CarTrial,
      };
    });
    for (let i = 0; i < 1200; i++) {
      engine.step();
      for (const car of cars) {
        if (car.done) continue;
        const p = { ...car.chassis.translation() };
        if (i % 8 === 0)
          car.result.samples.push({
            time: (i + 1) * SIMULATION_TIMESTEP_SECONDS,
            position: p,
          });
        const target = car.lane.waypoints[car.next];
        const previous = car.lane.waypoints[car.next - 1];
        const direction = normalize(subtract(target, previous));
        const delta = subtract(p, target);
        const sideError = Math.abs(
          dot(delta, normalize({ x: -direction.z, y: 0, z: direction.x })),
        );
        // Progress must cross each ordered checkpoint, remain in the lane and above its deck.
        if (
          dot(delta, direction) >= -0.15 &&
          sideError < (car.lane.width - brief.car.width) / 2 &&
          Math.abs(p.y - target.y) < 1.2
        ) {
          car.result.reachedWaypoint = car.next++;
          if (car.next === car.lane.waypoints.length) {
            car.done = true;
            car.result.passed = true;
            car.result.reason =
              "All ordered checkpoints reached under gravity, with both cars released together.";
          }
        }
        const a = car.lane.waypoints[Math.max(0, car.next - 1)],
          b =
            car.lane.waypoints[
              Math.min(car.next, car.lane.waypoints.length - 1)
            ];
        const segment = subtract(b, a),
          length2 = dot(segment, segment);
        const t = Math.max(
          0,
          Math.min(1, length2 ? dot(subtract(p, a), segment) / length2 : 0),
        );
        const expected = add(a, scale(segment, t));
        if (
          p.y < expected.y - 0.6 ||
          distance(
            { x: p.x, y: 0, z: p.z },
            { x: expected.x, y: 0, z: expected.z },
          ) >
            car.lane.width / 2 + brief.car.length / 2
        ) {
          car.done = true;
          car.result.passed = false;
          car.result.reason = "Car left the road before completing the route.";
        }
        if (
          engine.poppedJoints.length ||
          engine.maxDisplacement() > MAX_STANDING_DISPLACEMENT
        ) {
          car.done = true;
          car.result.passed = false;
          car.result.reason =
            "The car load displaced the structure or broke a joint.";
        }
        if (car.done && i % 8 !== 0)
          car.result.samples.push({
            time: (i + 1) * SIMULATION_TIMESTEP_SECONDS,
            position: p,
          });
      }
      if (cars.every((c) => c.done)) break;
    }
    return cars.map((c) => c.result);
  } finally {
    engine.dispose();
  }
}
