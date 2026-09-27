import { createEngineWorld } from "@/lib/engine/rapier-world";
import {
  MAX_STANDING_DISPLACEMENT,
  SETTLED_ANGULAR_SPEED,
  SETTLED_LINEAR_SPEED,
  SETTLED_REQUIRED_STEPS,
  SIMULATION_MAX_STEPS,
} from "@/lib/engine/constants";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { quaternionToBasis, transformLocal } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { v } from "./geometry";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";

/** Free release with per-step peak motion and a sustained rest requirement. */
export async function releaseCandidate(
  build: BuildGraph,
  seed: number,
  deadline = Infinity,
) {
  const engine = await createEngineWorld(build, { drop: true });
  let peak = 0,
    settledSteps = 0,
    linearSpeed = Infinity,
    angularSpeed = Infinity;
  try {
    [...engine.bodies.values()].forEach(({ body }, i) => {
      const noise = (n: number) => Math.sin((i + 1) * 13.13 + (seed + 1) * n);
      body.setLinvel(v(noise(1.7) * 0.03, 0, noise(2.9) * 0.03), true);
      body.setAngvel(
        v(noise(3.1) * 0.015, noise(4.7) * 0.015, noise(6.3) * 0.015),
        true,
      );
    });
    for (let n = 0; n < SIMULATION_MAX_STEPS; n++) {
      if (n % 32 === 0 && Date.now() > deadline)
        throw new SimulationBudgetExceeded();
      engine.step();
      peak = engine.peakDisplacement;
      const magnitude = (p: Vec3) => Math.hypot(p.x, p.y, p.z);
      linearSpeed = Math.max(
        ...[...engine.bodies.values()].map((r) => magnitude(r.body.linvel())),
      );
      angularSpeed = Math.max(
        ...[...engine.bodies.values()].map((r) => magnitude(r.body.angvel())),
      );
      settledSteps =
        engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED &&
        engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED
          ? settledSteps + 1
          : 0;
      if (engine.invalidState || engine.solidFailures.length || peak > MAX_STANDING_DISPLACEMENT || engine.poppedJoints.length || engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE) break;
    }
    const settled: BuildGraph = {
      ...build,
      tiles: build.tiles.map((t) => {
        const r = engine.bodies.get(t.id)!,
          rotation = quaternionToBasis(r.body.rotation()),
          p = r.body.translation(),
          basis =
            t.basis ?? basisFromEuler(t.rotation.x, t.rotation.y, t.rotation.z);
        const rotate = (a: Vec3) => transformLocal(a, v(0, 0, 0), rotation);
        return {
          ...t,
          position: v(p.x, p.y - (r.targetPosition.y - t.position.y), p.z),
          basis: {
            xAxis: rotate(basis.xAxis),
            yAxis: rotate(basis.yAxis),
            zAxis: rotate(basis.zAxis),
          },
        };
      }),
    };
    return {
      seed,
      status:
        !engine.invalidState && !engine.solidFailures.length &&
        peak <= MAX_STANDING_DISPLACEMENT &&
        engine.peakGroundPenetration <= RAW_OVERLAP_TOLERANCE &&
        !engine.poppedJoints.length &&
        !engine.rejectedReasons.length &&
        settledSteps >= SETTLED_REQUIRED_STEPS
          ? ("pass" as const)
          : ("fail" as const),
      peakDisplacement: peak,
      peakGroundPenetration: engine.peakGroundPenetration,
      solidFailures: engine.solidFailures,
      peakSolidOverlap: engine.peakSolidOverlap,
      finalDisplacement: engine.maxDisplacement(),
      finalSpeed: engine.maxSpeed(),
      linearSpeed,
      angularSpeed,
      settledSteps,
      poppedJoints: [...engine.rejectedReasons, ...engine.poppedJoints],
      settled,
    };
  } finally {
    engine.dispose();
  }
}
