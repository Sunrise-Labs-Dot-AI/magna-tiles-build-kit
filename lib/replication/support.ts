import { RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld, currentTilePose, perturbFirstRelease, type EngineState, type EngineWorld } from "@/lib/engine/rapier-world";
import { COLLISION_SUBSTEPS, MAX_STANDING_DISPLACEMENT, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SETTLED_REQUIRED_STEPS, SIMULATION_MAX_STEPS, SIMULATION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { magnitude } from "@/lib/engine/math";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import type { Check } from "./types";
import { checkMotionFingerClearance, type HandContact } from "./grip";
import { checkSweptPoses, samePoses } from "./rotation-clearance";
import { compactMotion } from "./motion-recording";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { componentContacts, disconnectedReason } from "./components";
import type { SolidFailure } from "@/lib/magnetic-tiles/swept-prisms";

export interface SupportTrial extends Check {
  heldTileIds: string[];
  peakDisplacement: number;
  peakGroundPenetration: number;
  solidFailures: SolidFailure[];
  peakSolidOverlap: number;
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
export async function simulateSupport(build: BuildGraph, heldTileIds: string[], floorY: number, seed: number, deadline = Infinity, state?: EngineState, hands?: HandContact[], components?: string[][]): Promise<SupportTrial> {
  if (!Number.isFinite(floorY) || heldTileIds.length > 2 || new Set(heldTileIds).size !== heldTileIds.length ||
      heldTileIds.some(id => !build.tiles.some(t => t.id === id))) throw new Error("Invalid individual-panel support contract");
  const engine = await createEngineWorld(build, { drop: false, floorY, state });
  const componentCheck = components && componentContacts(build,components);
  // Assembly handoffs may release a lifted prefix. Resolve impacts at the same
  // native rate used by the engine, without changing duration or rest requirements.
  const substeps = COLLISION_SUBSTEPS;
  engine.world.integrationParameters.dt = SIMULATION_TIMESTEP_SECONDS/substeps;
  let peak = 0, settledSteps = 0, clearanceFailure = componentCheck?.status === "fail" ? componentCheck.detail : "";
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
      if(engine.invalidState||engine.solidFailures.length)clearanceFailure=engine.solidFailures[0]?.detail??"Invalid physical state.";
      elapsed = (n+1)*SIMULATION_TIMESTEP_SECONDS/substeps;
      if (hands) {
        const actual = supportSnapshot(build,engine);
        if (n === 0 || !samePoses(previous,actual)) {
          const solids = checkSweptPoses(previous,actual,floorY,deadline), fingers = checkMotionFingerClearance(previous,actual,hands,floorY);
          if (solids.status !== "pass" || fingers.status !== "pass") clearanceFailure = solids.status !== "pass" ? solids.detail : fingers.detail;
        }
        previous = actual;
        if (n % (16 * substeps) === 0) motion.push({ seconds: elapsed,tiles: actual.tiles });
      }
      peak = engine.peakDisplacement;
      if (engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE) clearanceFailure ||= `A panel penetrated the fixed table by ${engine.peakGroundPenetration.toFixed(3)} in (maximum ${RAW_OVERLAP_TOLERANCE} in).`;
      const dynamic = [...engine.bodies.entries()].filter(([id]) => !heldTileIds.includes(id));
      const linear = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.linvel())));
      const angular = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.angvel())));
      settledSteps = linear < SETTLED_LINEAR_SPEED && angular < SETTLED_ANGULAR_SPEED ? settledSteps + 1 : 0;
      if (peak > MAX_STANDING_DISPLACEMENT || engine.poppedJoints.length || clearanceFailure) break;
    }
    const poppedJoints = [...engine.rejectedReasons.filter(reason => !components || componentCheck?.status !== "pass" || !disconnectedReason(reason)), ...engine.poppedJoints];
    if (componentCheck?.status === "fail") clearanceFailure ||= componentCheck.detail;
    settledSteps = Math.floor(settledSteps/substeps);
    const passed = !clearanceFailure && Number.isFinite(peak) && peak <= MAX_STANDING_DISPLACEMENT && !poppedJoints.length && settledSteps >= SETTLED_REQUIRED_STEPS;
    const dynamicTileCount = build.tiles.length - heldTileIds.length;
    const settled = supportSnapshot(build,engine);
    motion.push({ seconds: elapsed,tiles: settled.tiles });
    return { status: passed ? "pass" : "fail", heldTileIds: [...heldTileIds], peakDisplacement: peak, peakGroundPenetration: engine.peakGroundPenetration, settledSteps, poppedJoints, dynamicTileCount,
      solidFailures:engine.solidFailures,peakSolidOverlap:engine.peakSolidOverlap,
      detail: clearanceFailure || (dynamicTileCount ? `${heldTileIds.length} individually held panels, ${dynamicTileCount} dynamic panels; peak ${peak.toFixed(3)} in, ${settledSteps}/90 rest steps, ${poppedJoints.length} rejected/broken joins.`
        : `${heldTileIds.length} separate hand contacts support ${build.tiles.length} panels. No free-body stability is claimed; handoff/release must be checked separately.`),
      settled, state: engine.snapshot(), motion: compactMotion(motion) };
  } finally { engine.dispose(); }
}
