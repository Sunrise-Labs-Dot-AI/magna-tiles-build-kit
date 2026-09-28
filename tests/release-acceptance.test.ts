import { afterEach, describe, expect, it, vi } from "vitest";
import * as worlds from "@/lib/engine/rapier-world";
import * as gates from "@/lib/engine/gate";
import { simulate, rollTest } from "@/lib/engine/simulate";
import { releaseCandidate } from "@/lib/replication/release";
import { evaluateCandidate } from "@/lib/harness/evaluate";
import { parseIntent } from "@/lib/harness/contract";
import { compileProgram } from "@/lib/harness/compile";
import { parseDesignBrief } from "@/lib/planner/brief";
import { courseCandidates } from "@/lib/planner/candidates";
import { testCars } from "@/lib/planner/car-test";
import mediumRamp from "@/build-drafts/medium-car-ramp.json";
import type { EngineBuild } from "@/lib/engine/build";
import { flatContactFixture } from "./fixtures/rigid-contact";

afterEach(() => vi.restoreAllMocks());

/** Control observations at the engine boundary; the separate rigid-contact tests
 * exercise actual dynamics and peak collection. No gate may ignore these metrics. */
function observe(mode: "linear-motion" | "angular-motion" | "89-rest-steps" | "penetration" | "solid-overlap" | "uncertified-sweep") {
  const create = worlds.createEngineWorld;
  vi.spyOn(worlds,"createEngineWorld").mockImplementation(async (build, options) => {
    const e = await create(build,options);
    let step = 0;
    e.step = () => {
      step++;
      e.stepSpeeds = {linear: mode === "linear-motion" || (mode === "89-rest-steps" && step <= 811) ? .05 : 0, angular: mode === "angular-motion" ? .09 : 0};
      if (mode === "penetration" && step===1) e.peakGroundPenetration = .04;
      if((mode==="solid-overlap"||mode==="uncertified-sweep")&&step===1)e.solidFailures.push({kind:mode==="solid-overlap"?"overlap":"uncertified-sweep",tileIds:["a","b"],detail:"Injected solid collision rejection."});
    };
    return e;
  });
}

describe("release acceptance cannot hide motion or table penetration", () => {
  it.each(["linear-motion","angular-motion","89-rest-steps","penetration","solid-overlap","uncertified-sweep"] as const)("nominal release rejects %s", async mode => {
    observe(mode);
    const result = await simulate(flatContactFixture());
    expect(result.stands).toBe(false);
    if (mode === "89-rest-steps") expect(result.settledSteps).toBe(89);
    if (mode === "penetration") expect(result.peakGroundPenetration).toBe(.04);
  });
  it.each(["linear-motion","89-rest-steps","penetration","solid-overlap","uncertified-sweep"] as const)("structural sweep rejects %s after the nominal gate", async mode => {
    observe(mode);
    vi.spyOn(gates,"gateBuild").mockResolvedValue({passed:true,reasons:[]});
    const c = parseIntent("a tower")!;
    c.prompt += ` ${mode}`; // Distinct evidence-cache contract for each fault.
    const build = compileProgram({kind:c.kind,...c.cells,reinforcement:"shell"},c);
    const result = await evaluateCandidate(build,c);
    expect(result.passed).toBe(false);
    expect(result.trials).toHaveLength(1);
    expect(result.trials[0].passed).toBe(false);
    if (mode === "penetration") expect(result.trials[0].peakGroundPenetration).toBe(.04);
    else expect(result.trials[0].settledSteps).toBeLessThan(90);
  });
  it("source release rejects recorded table penetration", async () => {
    observe("penetration");
    const result = await releaseCandidate(flatContactFixture(),0);
    expect(result.status).toBe("fail");
    expect(result.peakGroundPenetration).toBe(.04);
  });
  it.each(["solid-overlap","uncertified-sweep"] as const)("source, roll and car lanes reject %s",async mode=>{
    observe(mode);
    expect((await releaseCandidate(flatContactFixture(),0)).status).toBe("fail");
    expect(await rollTest(mediumRamp as EngineBuild)).toMatchObject({reachedBottom:false,fellOff:true});
    const brief=parseDesignBrief("a downhill racecourse for two side by side cars"),c=courseCandidates(brief)[0];
    const trials=await testCars(c.build,c.lanes,brief);
    expect(trials).toHaveLength(2);expect(trials.every(t=>!t.passed&&t.reason.includes("solid collision"))).toBe(true);
    for (const trial of trials) expect(trial.solidFailures).toEqual([
      {kind:mode === "solid-overlap" ? "overlap" : "uncertified-sweep",tileIds:["a","b"],detail:"Injected solid collision rejection."},
    ]);
  });
  it("roll and car trials reject tile table penetration before launch", async () => {
    observe("penetration");
    expect(await rollTest(mediumRamp as EngineBuild)).toMatchObject({reachedBottom:false,fellOff:true,peakGroundPenetration:.04});
    const brief = parseDesignBrief("a downhill racecourse for two side by side cars"), c = courseCandidates(brief)[0];
    const trials = await testCars(c.build,c.lanes,brief);
    expect(trials).toHaveLength(2);
    for (const t of trials) expect(t).toMatchObject({passed:false,peakGroundPenetration:.04,samples:[]});
  });
});
