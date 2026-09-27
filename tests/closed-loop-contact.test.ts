import { describe, expect, it } from "vitest";
import { perturbFirstRelease } from "@/lib/engine/rapier-world";
import { SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED } from "@/lib/engine/constants";
import { closedShell } from "./fixtures/closed-shell";
import { closedLoopWorld, triangularShell } from "./fixtures/closed-loop";

describe("closed solid shells under gravity", () => {
  it.each([1,2,3])("releases fixture %s with both reference frames, timesteps and three seeds", async index => {
    for (const mixed of [false,true]) for (const hz of [960,1920]) for (const seed of [0,17,53]) {
      const build = index === 3 ? triangularShell() : closedShell(index);
      const engine = await closedLoopWorld(build,mixed);
      try {
        engine.world.integrationParameters.dt = 1/hz;
        [...engine.bodies.values()].forEach((record,i) => perturbFirstRelease(record,i,seed));
        let rest = 0;
        for (let step=0; step<hz*7.5; step++) {
          engine.step();
          rest = engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED && engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED ? rest+1 : 0;
          if (engine.invalidState || engine.solidFailures.length || engine.poppedJoints.length || engine.peakDisplacement > .95 || engine.peakGroundPenetration > .03) break;
        }
        const context = JSON.stringify({fixture:build.id,mixed,hz,seed,restSeconds:rest/hz,solidFailures:engine.solidFailures,popped:engine.poppedJoints,peak:engine.peakDisplacement,ground:engine.peakGroundPenetration});
        expect(engine.invalidState,context).toBe(false);
        expect(engine.solidFailures,context).toEqual([]);
        expect(engine.poppedJoints,context).toEqual([]);
        expect(engine.peakDisplacement,context).toBeLessThanOrEqual(.95);
        expect(engine.peakGroundPenetration,context).toBeLessThanOrEqual(.03);
        expect(rest/hz,context).toBeGreaterThanOrEqual(.75);
      } finally { engine.dispose(); }
    }
  },120000);
});
