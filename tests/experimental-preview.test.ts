import { expect, it, vi } from "vitest";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { COLLISION_SUBSTEPS, MAX_COLLISION_TIMESTEP_SECONDS, SIMULATION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { assemble, square, v } from "@/lib/replication/geometry";

it("uses full precision and gyro while preserving one native step per assembly observation", async () => {
  const build = assemble("preview-check", "Preview check", [square("tile", v(0, 4, 0), v(3, 0, 0), v(0, 0, 3), "blue", 1, "check")], "tower");
  const engine = await createEngineWorld(build, { drop: false, floorY: 0 });
  try {
    expect(COLLISION_SUBSTEPS).toBe(334);
    const dt = SIMULATION_TIMESTEP_SECONDS / COLLISION_SUBSTEPS;
    expect(dt).toBeLessThanOrEqual(MAX_COLLISION_TIMESTEP_SECONDS);
    expect(engine.bodies.get("tile")!.hull.BYTES_PER_ELEMENT).toBe(8);
    expect(engine.bodies.get("tile")!.body.gyroscopicForcesEnabled()).toBe(true);
    engine.world.integrationParameters.dt = dt;
    const step = vi.spyOn(engine.world, "step");
    engine.step(); expect(step).toHaveBeenCalledTimes(1);
    const state = engine.snapshot();
    expect(state.physicsModel).toMatch(/^experimental-gyro/);
    await expect(createEngineWorld(build, { drop: false, floorY: 0, state: { ...state, physicsModel: "old-production-model" } })).rejects.toThrow(/current physics model/);
  } finally { engine.dispose(); }
});
