import { createEngineWorld } from "@/lib/engine/rapier-world";
import { PHYSICS_MODEL_VERSION, MAX_COLLISION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { assemble, square, v } from "@/lib/replication/geometry";
import { supportSnapshot } from "@/lib/replication/support";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

export const dropShapes = ["small-square", "equilateral-triangle", "right-triangle"] as const;
export type DropShape = typeof dropShapes[number];
export interface DropResult {
  physicsModel: string;
  precisionBits: number;
  gyroscopicForces: boolean;
  maxStepSeconds: number;
  frames: { seconds: number; build: BuildGraph }[];
  invalidState: boolean;
  solidFailures: string[];
  peakGroundPenetration: number;
}

export async function runTileDrop(shape: DropShape): Promise<DropResult> {
  const tile = { ...square("tile", v(-1.5, 4, -1.5), v(3, 0, 0), v(0, 0, 3), "blue", 1, "drop experiment"),
    shape, basis: basisFromEuler(.3, .15, -.2) };
  const build = assemble("experimental-drop", "Tile drop", [tile], "tower");
  const engine = await createEngineWorld(build, { drop: false, floorY: 0 });
  try {
    const body = engine.bodies.get("tile")!;
    const frames = [{ seconds: 0, build: supportSnapshot(build, engine) }];
    for (let n = 0; n < 96; n++) {
      engine.step();
      if (n % 2 === 1 || engine.invalidState || engine.solidFailures.length)
        frames.push({ seconds: (n + 1) / 120, build: supportSnapshot(build, engine) });
      if (engine.invalidState || engine.solidFailures.length) break;
    }
    return { physicsModel: PHYSICS_MODEL_VERSION, precisionBits: body.hull.BYTES_PER_ELEMENT * 8,
      gyroscopicForces: body.body.gyroscopicForcesEnabled(), maxStepSeconds: MAX_COLLISION_TIMESTEP_SECONDS,
      frames, invalidState: engine.invalidState, solidFailures: engine.solidFailures.map(f => f.detail),
      peakGroundPenetration: engine.peakGroundPenetration };
  } finally { engine.dispose(); }
}
