import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { createEngineWorld, currentTilePose, perturbFirstRelease, type EngineState, type EngineWorld } from "@/lib/engine/rapier-world";
import { MAX_STANDING_DISPLACEMENT, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SETTLED_REQUIRED_STEPS, SIMULATION_MAX_STEPS, SIMULATION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { magnitude } from "@/lib/engine/math";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import type { Check } from "./types";
import { checkMotionFingerClearance, type HandContact } from "./grip";
import { checkSweptPoses, samePoses } from "./rotation-clearance";
import { compactMotion } from "./motion-recording";

export interface SupportTrial extends Check {
  heldTileIds: string[];
  peakDisplacement: number;
  settledSteps: number;
  poppedJoints: string[];
  dynamicTileCount: number;
  settled: BuildGraph;
  state: EngineState;
  motion: { seconds: number; tiles: TileInstance[] }[];
}

export function supportSnapshot(build: BuildGraph, engine: EngineWorld): BuildGraph {
  return { ...build, tiles: build.tiles.map(tile => {
    const r = engine.bodies.get(tile.id)!;
    const pose = currentTilePose(r.tile, r.body.translation(), r.body.rotation(), engine.floorY);
    return { ...tile, position: pose.position, basis: pose.basis };
  }) };
}

/** Holds only named single-panel bodies. The table never moves to the lowest part
 * of a prefix: otherwise a floating piece would gain an invented support. */
export async function simulateSupport(build: BuildGraph, heldTileIds: string[], floorY: number, seed: number, deadline = Infinity, state?: EngineState, hands?: HandContact[]): Promise<SupportTrial> {
  if (!Number.isFinite(floorY) || heldTileIds.length > 2 || new Set(heldTileIds).size !== heldTileIds.length ||
      heldTileIds.some(id => !build.tiles.some(t => t.id === id))) throw new Error("Invalid individual-panel support contract");
  const engine = await createEngineWorld(build, { drop: false, floorY, state });
  // Assembly handoffs may release a lifted prefix. Resolve impacts at the same
  // 960 Hz without changing duration or rest requirements. CCD alone leaves an impact
  // step that exceeds the existing 0.03-inch penetration tolerance at 480 Hz.
  const substeps = 8;
  engine.world.integrationParameters.dt = SIMULATION_TIMESTEP_SECONDS/substeps;
  let peak = 0, settledSteps = 0, clearanceFailure = "";
  let previous = build;
  const motion = [{ seconds: 0,tiles: build.tiles }];
  let elapsed = 0;
  try {
    [...engine.bodies.entries()].forEach(([id, { body }], i) => {
      body.enableCcd(true);
      if (heldTileIds.includes(id)) {
        body.setBodyType(RigidBodyType.Fixed, true);
      } else {
        body.setBodyType(RigidBodyType.Dynamic, true);
        perturbFirstRelease(engine.bodies.get(id)!, i, seed);
      }
    });
    for (let n = 0; n < SIMULATION_MAX_STEPS*substeps; n++) {
      if (n % 32 === 0 && Date.now() > deadline) throw new SimulationBudgetExceeded();
      engine.step();
      elapsed = (n+1)*SIMULATION_TIMESTEP_SECONDS/substeps;
      if (hands) {
        const actual = supportSnapshot(build,engine);
        if (n === 0 || !samePoses(previous,actual)) {
          const solids = checkSweptPoses(previous,actual,floorY,deadline), fingers = checkMotionFingerClearance(previous,actual,hands,floorY);
          if (solids.status !== "pass" || fingers.status !== "pass") clearanceFailure = solids.status !== "pass" ? solids.detail : fingers.detail;
        }
        previous = actual;
        if (n % 128 === 0) motion.push({ seconds: elapsed,tiles: actual.tiles });
      }
      peak = Math.max(peak, engine.maxDisplacement());
      const dynamic = [...engine.bodies.entries()].filter(([id]) => !heldTileIds.includes(id));
      const linear = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.linvel())));
      const angular = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.angvel())));
      settledSteps = linear < SETTLED_LINEAR_SPEED && angular < SETTLED_ANGULAR_SPEED ? settledSteps + 1 : 0;
      if (peak > MAX_STANDING_DISPLACEMENT || engine.poppedJoints.length || clearanceFailure) break;
    }
    const poppedJoints = [...engine.rejectedReasons, ...engine.poppedJoints];
    settledSteps = Math.floor(settledSteps/substeps);
    const passed = !clearanceFailure && Number.isFinite(peak) && peak <= MAX_STANDING_DISPLACEMENT && !poppedJoints.length && settledSteps >= SETTLED_REQUIRED_STEPS;
    const dynamicTileCount = build.tiles.length - heldTileIds.length;
    const settled = supportSnapshot(build,engine);
    motion.push({ seconds: elapsed,tiles: settled.tiles });
    return { status: passed ? "pass" : "fail", heldTileIds: [...heldTileIds], peakDisplacement: peak, settledSteps, poppedJoints, dynamicTileCount,
      detail: clearanceFailure || (dynamicTileCount ? `${heldTileIds.length} individually held panels, ${dynamicTileCount} dynamic panels; peak ${peak.toFixed(3)} in, ${settledSteps}/90 rest steps, ${poppedJoints.length} rejected/broken joins.`
        : `${heldTileIds.length} separate hand contacts support ${build.tiles.length} panels. No free-body stability is claimed; handoff/release must be checked separately.`),
      settled, state: engine.snapshot(), motion: compactMotion(motion) };
  } finally { engine.dispose(); }
}
