import { afterEach, describe, expect, it, vi } from "vitest";
import * as physics from "@/lib/engine/rapier-world";
import { MAX_COLLISION_TIMESTEP_SECONDS, SIMULATION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { simulateSupport } from "@/lib/replication/support";
import { simulateGravitySeat } from "@/lib/replication/seating";
import { simulateHeldMotion } from "@/lib/replication/held-motion";
import { edgeGrips } from "@/lib/replication/grip";
import { tileQuaternion } from "@/lib/replication/rotation-clearance";
import { assemble, square, v } from "@/lib/replication/geometry";

afterEach(() => vi.restoreAllMocks());

describe("assembly observers follow actual native integration", () => {
  it.each(["support","seating","carry"] as const)("checks every native step during %s and preserves physical duration", async operation => {
    const create = physics.createEngineWorld;
    let nativeSteps = 0, calls = 0, largestGap = 0;
    const requested = new Set<number>();
    vi.spyOn(physics,"createEngineWorld").mockImplementation(async (build, options) => {
      const engine = await create(build,options);
      const native = engine.world.step.bind(engine.world), step = engine.step.bind(engine);
      engine.world.step = (...args) => { native(...args); nativeSteps++; };
      engine.step = () => {
        requested.add(engine.world.integrationParameters.dt);
        const before = nativeSteps; step(); calls++;
        largestGap = Math.max(largestGap,nativeSteps-before);
      };
      return engine;
    });
    const panel = operation === "carry"
      ? square("panel",v(-1.5,2,0),v(3,0,0),v(0,3,0),"blue",1,"panel")
      : square("panel",v(-1.5,.09,-1.5),v(3,0,0),v(0,0,3),"blue",1,"panel");
    const build = assemble("observer","Observer",[panel],"tower");
    const result = operation === "support" ? await simulateSupport(build,[],0,0)
      : operation === "seating" ? await simulateGravitySeat(build,[panel.id],[edgeGrips(panel)[0]],.55,0,0)
      : await simulateHeldMotion(build,undefined,[panel.id],[edgeGrips(panel)[2]],[
        { seconds:0, position:panel.position, rotation:tileQuaternion(panel) },
        { seconds:.05, position:{...panel.position,y:panel.position.y+.01}, rotation:tileQuaternion(panel) },
      ],0,0);
    expect(result.status,result.detail).toBe("pass");
    expect(requested).toEqual(new Set([Math.fround(MAX_COLLISION_TIMESTEP_SECONDS)]));
    expect(largestGap).toBe(1);
    expect(nativeSteps).toBe(calls);
    expect(calls*MAX_COLLISION_TIMESTEP_SECONDS).toBeCloseTo(operation === "carry" ? 7.55 : 7.5,10);
    expect(result.settledSteps*SIMULATION_TIMESTEP_SECONDS).toBeGreaterThanOrEqual(.75);
  });
});
