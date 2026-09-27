import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { createEngineWorld, type EngineWorld } from "@/lib/engine/rapier-world";
import { MAX_STANDING_DISPLACEMENT, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SETTLED_REQUIRED_STEPS, SIMULATION_MAX_STEPS } from "@/lib/engine/constants";
import { quaternionToBasis, transformLocal, magnitude } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import { v } from "./geometry";
import type { Check } from "./types";

export interface SupportTrial extends Check {
  heldTileIds: string[];
  peakDisplacement: number;
  settledSteps: number;
  poppedJoints: string[];
  dynamicTileCount: number;
  settled: BuildGraph;
}

export function supportSnapshot(build: BuildGraph, engine: EngineWorld): BuildGraph {
  return { ...build, tiles: build.tiles.map(tile => {
    const r = engine.bodies.get(tile.id)!, rotation = quaternionToBasis(r.body.rotation()), p = r.body.translation();
    const basis = tile.basis ?? basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z);
    const rotate = (axis: typeof p) => transformLocal(axis, v(0, 0, 0), rotation);
    return { ...tile, position: v(p.x, p.y - (r.targetPosition.y - tile.position.y), p.z),
      basis: { xAxis: rotate(basis.xAxis), yAxis: rotate(basis.yAxis), zAxis: rotate(basis.zAxis) } };
  }) };
}

/** Holds only named single-panel bodies. The table never moves to the lowest part
 * of a prefix: otherwise a floating piece would gain an invented support. */
export async function simulateSupport(build: BuildGraph, heldTileIds: string[], floorY: number, seed: number, deadline = Infinity): Promise<SupportTrial> {
  if (!Number.isFinite(floorY) || heldTileIds.length > 2 || new Set(heldTileIds).size !== heldTileIds.length ||
      heldTileIds.some(id => !build.tiles.some(t => t.id === id))) throw new Error("Invalid individual-panel support contract");
  const engine = await createEngineWorld(build, { drop: false, floorY });
  let peak = 0, settledSteps = 0;
  try {
    [...engine.bodies.entries()].forEach(([id, { body }], i) => {
      if (heldTileIds.includes(id)) {
        body.setBodyType(RigidBodyType.Fixed, true);
      } else {
        const noise = (n: number) => Math.sin((i + 1) * 13.13 + (seed + 1) * n);
        body.setLinvel(v(noise(1.7) * 0.03, 0, noise(2.9) * 0.03), true);
        body.setAngvel(v(noise(3.1) * 0.015, noise(4.7) * 0.015, noise(6.3) * 0.015), true);
      }
    });
    for (let n = 0; n < SIMULATION_MAX_STEPS; n++) {
      if (n % 32 === 0 && Date.now() > deadline) throw new SimulationBudgetExceeded();
      engine.step();
      peak = Math.max(peak, engine.maxDisplacement());
      const dynamic = [...engine.bodies.entries()].filter(([id]) => !heldTileIds.includes(id));
      const linear = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.linvel())));
      const angular = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.angvel())));
      settledSteps = linear < SETTLED_LINEAR_SPEED && angular < SETTLED_ANGULAR_SPEED ? settledSteps + 1 : 0;
      if (peak > MAX_STANDING_DISPLACEMENT || engine.poppedJoints.length) break;
    }
    const poppedJoints = [...engine.rejectedReasons, ...engine.poppedJoints];
    const passed = Number.isFinite(peak) && peak <= MAX_STANDING_DISPLACEMENT && !poppedJoints.length && settledSteps >= SETTLED_REQUIRED_STEPS;
    const dynamicTileCount = build.tiles.length - heldTileIds.length;
    return { status: passed ? "pass" : "fail", heldTileIds: [...heldTileIds], peakDisplacement: peak, settledSteps, poppedJoints, dynamicTileCount,
      detail: dynamicTileCount ? `${heldTileIds.length} individually held panels, ${dynamicTileCount} dynamic panels; peak ${peak.toFixed(3)} in, ${settledSteps}/90 rest steps, ${poppedJoints.length} rejected/broken joins.`
        : `${heldTileIds.length} separate hand contacts support ${build.tiles.length} panels. No free-body stability is claimed; handoff/release must be checked separately.`,
      settled: supportSnapshot(build, engine) };
  } finally { engine.dispose(); }
}
