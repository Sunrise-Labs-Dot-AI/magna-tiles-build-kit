/** Before/after proof-reuse experiment. Always runs the actual engine; there is
 * no acceptance-bypass mode. Numeric trajectories are hashed without rounding. */
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import * as worlds from "../../lib/engine/rapier-world";
import * as solids from "../../lib/magnetic-tiles/swept-prisms";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { evaluateAssembly } from "../../lib/replication/assembly";
import { simulateSupport } from "../../lib/replication/support";
import { simulateHeldMotion } from "../../lib/replication/held-motion";
import { edgeGrips } from "../../lib/replication/grip";
import { assemble, square, v } from "../../lib/replication/geometry";
import { multiplyQuaternions } from "../../lib/engine/math";
import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { unsupportedHingeFixture } from "../../tests/fixtures/rigid-contact";
import { supportedComponentTransferFixture } from "../../tests/fixtures/component-transfer";
import { runContactCell } from "./contact-matrix";

it("records exact native trajectories and complete outcomes before or after proof reuse", async () => {
  const output = process.env.CONTACT_PROOF_OUTPUT;
  if (!output) throw new Error("Set CONTACT_PROOF_OUTPUT to a new diagnostic path");
  const context = { validationCodeHash:await validationCodeHash(), scriptHashes:await artifactHashes([
    "scripts/reference/probe-proof-reuse.ts", "scripts/reference/probe-proof-reuse.config.ts",
    "tests/fixtures/component-transfer.ts", "tests/fixtures/loaded-contact.ts", "tests/fixtures/rigid-contact.ts",
  ]) };
  const records: { scenario:string; buildId:string; initialSha256:string; nativeSteps:number; trajectorySha256:string; terminalSha256:string }[] = [];
  const sha = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const create = worlds.createEngineWorld, check = solids.checkSolidSweep;
  let scenario = "", solidChecks = 0;
  const checkSpy = vi.spyOn(solids,"checkSolidSweep");
  // Count calls without retaining every full prism-array argument in Vitest's
  // mock history. That history is not evidence and grows with every native step.
  checkSpy.mockImplementation((...args) => {
    solidChecks++; try { return check(...args); } finally { checkSpy.mockClear(); }
  });
  const createSpy = vi.spyOn(worlds,"createEngineWorld");
  createSpy.mockImplementation(async (...args) => {
    const engine = await create(...args), trace = createHash("sha256");
    const record = { scenario,buildId:args[0].id,initialSha256:sha(engine.snapshot()),nativeSteps:0,trajectorySha256:"",terminalSha256:"" };
    records.push(record);
    const step = engine.world.step.bind(engine.world), dispose = engine.dispose.bind(engine);
    engine.world.step = (...stepArgs) => {
      step(...stepArgs); record.nativeSteps++;
      const values = [engine.world.integrationParameters.dt,...[...engine.bodies.values()].flatMap(({body}) => {
        const p=body.translation(),q=body.rotation(),l=body.linvel(),a=body.angvel();
        return [p.x,p.y,p.z,q.x,q.y,q.z,q.w,l.x,l.y,l.z,a.x,a.y,a.z,body.bodyType(),Number(body.isSleeping()),Number(body.isCcdEnabled())];
      })];
      // IEEE-754 bytes retain signed zero and every f32 result promoted to JS.
      trace.update(Buffer.from(new Float64Array(values).buffer));
      trace.update(JSON.stringify(engine.poppedJoints));
    };
    engine.dispose = () => {
      record.trajectorySha256 = trace.digest("hex"); record.terminalSha256 = sha(engine.snapshot()); dispose();
    };
    createSpy.mockClear(); return engine;
  });
  const results: { scenario:string; result:unknown }[] = [];
  const timings: { scenario:string; wallSeconds:number; solidChecks:number }[] = [];
  const save = async () => {
    await writeFile(`${output}.tmp`,JSON.stringify({scope:"Exact runtime equivalence only; no source or material acceptance.",
      context,completed:results.length===5,records,results,timings},null,2)+"\n");
    await rename(`${output}.tmp`,output);
  };
  const run = async (name:string, execute:()=>Promise<unknown>) => {
    scenario=name; const started=performance.now(), checksBefore=solidChecks;
    results.push({scenario,result:await execute()});
    timings.push({scenario,wallSeconds:(performance.now()-started)/1000,solidChecks:solidChecks-checksBefore});
    await save(); console.log(name,JSON.stringify(timings.at(-1)));
  };
  try {
    for (const build of [contactMatrixFixtures()[0],contactMatrixFixtures().at(-1)!])
      await run(build.id,()=>runContactCell(build,{fixture:build.id,frequency:480,hz:1920,solver:16,seed:17},"finer"));
    const tile = square("moving",v(-1.5,2,0),v(3,0,0),v(0,3,0),"blue",1,"panel");
    const q = solids.tileQuaternion(tile), quarter = { x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2 };
    await run("held-translation-rotation",()=>simulateHeldMotion(assemble("moving","Moving",[tile],"tower"),undefined,[tile.id],[edgeGrips(tile)[2]],[
      {seconds:0,position:tile.position,rotation:q}, {seconds:.5,position:v(0,3.7,0),rotation:q},
      {seconds:2.5,position:v(0,3.7,0),rotation:multiplyQuaternions(quarter,q)},
    ],0,17));
    await run("failed-hinge",()=>simulateSupport(unsupportedHingeFixture(),["x-0--1"],0,17));
    await run("supported-transfer",()=>evaluateAssembly(supportedComponentTransferFixture()));
  } finally { vi.restoreAllMocks(); }
  expect(context.validationCodeHash).toBe(await validationCodeHash());
  if (process.env.CONTACT_PROOF_BASELINE) {
    const baseline = JSON.parse(await readFile(process.env.CONTACT_PROOF_BASELINE,"utf8"));
    expect(baseline.completed).toBe(true);
    expect(baseline.context.scriptHashes).toEqual(context.scriptHashes);
    expect(records).toEqual(baseline.records);
    // JSON archives omit undefined and encode signed zero as zero. Compare
    // their exact representation; native trajectory hashes retain signed zero.
    expect(JSON.parse(JSON.stringify(results))).toEqual(baseline.results);
    console.log("Exact native trajectories, terminal states and complete outcomes match the unoptimized runtime.");
  }
});
