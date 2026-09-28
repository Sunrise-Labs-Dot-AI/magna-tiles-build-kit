/** Diagnostic only. Original gates and test budgets remain unchanged.
 * Record failing results instead of asserting success inside runtime observers. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { beforeAll, it, vi } from "vitest";
import * as engines from "../../lib/engine/rapier-world";
import { RigidBodyType, integrationSettings } from "../../lib/engine/physics-backend";
import { gateBuild, rollTest, simulate, type EngineBuild } from "../../lib/engine";
import { gravityVector } from "../../lib/engine/physics-model";
import { basisToQuaternion, distance, multiplyQuaternions, quaternionToBasis, subtract, transformLocal } from "../../lib/engine/math";
import { assembleBuildGraph, draftToBuildGraph } from "../../lib/builder/operations";
import { readBuildDraft } from "../../lib/builder/storage";
import type { AuthoredBuildDraft } from "../../lib/builder/types";
import mediumDraft from "../../build-drafts/medium-car-ramp.json";
import { BUILD_LIBRARY } from "../../lib/magnetic-tiles/library";
import { ENGINE_VALID_LIBRARY_BUILD_IDS } from "../../verification/engine-valid-builds";
import { referenceAcceptanceCases } from "../../lib/reference-encoder/reference-acceptance";
import { buildJetDraft, SEED } from "../generate-jet";
import { evaluateAssembly } from "../../lib/replication/assembly";
import * as motion from "../../lib/replication/held-motion";
import * as support from "../../lib/replication/support";
import { assemble } from "../../lib/replication/geometry";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { continuedPrefixFixture } from "../../tests/fixtures/continued-prefix";
import { flatContactFixture, unsupportedHingeFixture } from "../../tests/fixtures/rigid-contact";

const output = "/tmp/magnatiles-integration-regressions.json";
const expectedRuntime = "7a8ad00bf79266e385e434dcb9bdb6f7fabe98d1511f8564b36cd81496c93e29";
const inputPaths = [
  "scripts/reference/probe-integration-regressions.ts", "scripts/reference/probe-integration-regressions.config.ts", "vitest.config.ts",
  "tests/continued-prefix.test.ts", "tests/assembly-state.test.ts", "tests/rigid-contact.test.ts", "tests/engine-gate.test.ts",
  "tests/engine-calibration.test.ts", "tests/jet-generator.test.ts", "tests/reference-acceptance.test.ts",
  "tests/fixtures/continued-prefix.ts", "tests/fixtures/bridge-panel.ts", "tests/fixtures/closed-shell.ts", "tests/fixtures/rigid-contact.ts",
  "scripts/generate-jet.ts", "lib/builder/operations.ts", "lib/builder/storage.ts", "lib/magnetic-tiles/library.ts",
  "verification/engine-valid-builds.ts", "lib/reference-encoder/reference-acceptance.ts",
  "lib/reference-encoder/examples/car-ramps-reference.ts", "lib/reference-encoder/examples/jet-aircraft-reference.ts",
  ...BUILD_LIBRARY.map(card => `build-drafts/${card.id}.json`),
];
let context: { validationCodeHash: string; inputHashes: Record<string, string> };
let statusSurfaces: unknown;
const results: { scenario: string; wallSeconds: number; result: unknown }[] = [];
const json = (value: unknown) => JSON.stringify(value, (_key, v) =>
  typeof v === "number" && !Number.isFinite(v) ? { diagnosticNonfiniteNumber: String(v) } : v, 2) + "\n";
async function save() {
  assert.equal(await validationCodeHash(), expectedRuntime);
  assert.deepEqual(await artifactHashes(inputPaths), context.inputHashes);
  await writeFile(`${output}.tmp`, json({ scope: "Regression diagnosis only. Completed scenarios may fail their original physical/test contract. No source or material acceptance.",
    context, statusSurfaces, completed: results.length === 6, requiredScenarios: 6, results }));
  await rename(`${output}.tmp`, output);
}
async function record(scenario: string, run: () => Promise<unknown>) {
  const start = performance.now();
  const result = await run();
  results.push({ scenario, wallSeconds: (performance.now() - start) / 1000, result });
  await save();
  console.log(JSON.stringify({ scenario, wallSeconds: results.at(-1)!.wallSeconds }));
}
beforeAll(async () => {
  context = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes(inputPaths) };
  assert.equal(context.validationCodeHash, expectedRuntime);
  statusSurfaces = { library: structuredClone(BUILD_LIBRARY), engineValidIds: [...ENGINE_VALID_LIBRARY_BUILD_IDS],
    referenceAcceptanceCases: referenceAcceptanceCases(),
    storedDrafts: await Promise.all(BUILD_LIBRARY.map(async card => {
      const draft = await readBuildDraft(card.id);
      return { id: card.id, returnedId: draft.id, status: draft.status };
    })) };
  await save();
});

function observe(engine: engines.EngineWorld, captureSamples: boolean) {
  const digest = createHash("sha256"), step = engine.world.step.bind(engine.world);
  const report = { initial: engine.snapshot(), nativeSteps: 0, elapsedNativeSeconds: 0, nativeDt: [] as number[],
    bodyOrder: [...engine.bodies.keys()], samples: [] as { seconds: number; values: number[] }[],
    trajectorySha256: "", terminal: engine.snapshot(), settings: integrationSettings(engine.world) };
  engine.world.step = () => {
    const dt = engine.world.integrationParameters.dt;
    step(); report.nativeSteps++; report.elapsedNativeSeconds += dt;
    if (!report.nativeDt.includes(dt)) report.nativeDt.push(dt);
    const values = [dt, ...[...engine.bodies.values()].flatMap(({ body }) => {
      const p = body.translation(), q = body.rotation(), l = body.linvel(), a = body.angvel();
      return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, l.x, l.y, l.z, a.x, a.y, a.z,
        body.bodyType(), Number(body.isSleeping()), Number(body.isCcdEnabled())];
    })];
    digest.update(Buffer.from(new Float64Array(values).buffer));
    if (captureSamples) report.samples.push({ seconds: report.elapsedNativeSeconds, values });
  };
  const dispose = engine.dispose.bind(engine);
  engine.dispose = () => {
    report.terminal = engine.snapshot(); report.trajectorySha256 = digest.digest("hex"); dispose();
  };
  return report;
}

it("records both unchanged continued-prefix variants without assertion observers", async () => {
  for (const future of [false, true]) await record(`continued-prefix-${future ? "future" : "base"}`, async () => {
    const replica = continuedPrefixFixture(true, future), before = structuredClone(replica);
    const failures: { phase: string; args: unknown[]; result: unknown }[] = [];
    const carry = motion.simulateHeldMotion, stabilize = support.simulateSupport;
    const carrySpy = vi.spyOn(motion, "simulateHeldMotion");
    carrySpy.mockImplementation(async (...args) => {
      const original = structuredClone(args);
      try {
        const result = await carry(...args);
        if (result.status !== "pass") failures.push({ phase: "carry", args: original, result: structuredClone(result) });
        return result;
      } finally { carrySpy.mockClear(); }
    });
    const supportSpy = vi.spyOn(support, "simulateSupport");
    supportSpy.mockImplementation(async (...args) => {
      const original = structuredClone(args);
      try {
        const result = await stabilize(...args);
        if (result.status !== "pass") failures.push({ phase: "support", args: original, result: structuredClone(result) });
        return result;
      } finally { supportSpy.mockClear(); }
    });
    try {
      const result = await evaluateAssembly(replica);
      assert.deepEqual(replica, before);
      return { replica, result, failedPhaseCalls: failures };
    } finally { vi.restoreAllMocks(); }
  });
}, 300000); // Same allowance as the original two-variant beforeAll.

async function legacy(name: "medium" | "jet") {
  const draft = name === "medium" ? mediumDraft as AuthoredBuildDraft : buildJetDraft(SEED);
  const graph = name === "medium" ? draftToBuildGraph(draft) : assembleBuildGraph(draft, { strict: true });
  const worlds: ReturnType<typeof observe>[] = [], create = engines.createEngineWorld;
  const createSpy = vi.spyOn(engines, "createEngineWorld");
  createSpy.mockImplementation(async (...args) => {
    try { const engine = await create(...args); worlds.push(observe(engine, false)); return engine; }
    finally { createSpy.mockClear(); }
  });
  try {
    const gate = await gateBuild(graph), gateWorldCount = worlds.length;
    const simulation = await simulate(name === "medium" ? draft as EngineBuild : graph), simulationWorldCount = worlds.length;
    const roll = name === "medium" ? await rollTest(draft as EngineBuild) : null;
    return { draft, graph, gate, simulation, roll, gateWorldCount, simulationWorldCount, worlds };
  } finally { vi.restoreAllMocks(); }
}
it("records the exact historical medium gate, stand and independent roll", () => record("legacy-medium", () => legacy("medium")), 120000);
it("records the exact generated seed jet gate and stand", () => record("generated-seed-jet", () => legacy("jet")), 30000);

function jointFrames(engine: engines.EngineWorld) {
  return engine.joints.map(record => ({ id: record.id, model: structuredClone(record.model),
    primary: { type: record.joint.type(), anchor1: { ...record.joint.anchor1() }, anchor2: { ...record.joint.anchor2() },
      frame1: { ...record.joint.frameX1() }, frame2: { ...record.joint.frameX2() }, contacts: record.joint.contactsEnabled() },
    companion: record.companion ? { type: record.companion.type(), anchor1: { ...record.companion.anchor1() },
      anchor2: { ...record.companion.anchor2() }, frame1: { ...record.companion.frameX1() },
      frame2: { ...record.companion.frameX2() }, contacts: record.companion.contactsEnabled() } : null }));
}
function reportingSteps(engine: engines.EngineWorld, trace: ReturnType<typeof observe>, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const before = trace.nativeSteps;
    engine.step();
    return { reportingStep: index + 1, nativeSteps: trace.nativeSteps, integratedSteps: trace.nativeSteps - before,
      seconds: trace.elapsedNativeSeconds, state: engine.snapshot() };
  });
}
it("records the rotated-hinge/control traces and later companion tear", () => record("rotated-hinge", async () => {
  const shell = unsupportedHingeFixture(), target = shell.tiles.find(t => t.id === "roof")!;
  const unrotated = { ...target, basis: undefined, rotation: { x: 0, y: 0, z: 0 } };
  const one = assemble("roof", "Roof", [unrotated], "tower");
  const original = await engines.createEngineWorld(one, { drop: false, floorY: 0 });
  try {
    const roof = original.bodies.get("roof")!.body;
    roof.setRotation(basisToQuaternion(target.basis!), true);
    roof.setLinvel({ x: 0, y: 0, z: 0 }, true); roof.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const pair = assemble("pair", "Pair", [support.supportSnapshot(one, original).tiles[0], shell.tiles.find(t => t.id === "x-0--1")!], "tower");
    const originalState = original.snapshot();
    const next = await engines.createEngineWorld(pair, { drop: false, floorY: 0, state: originalState });
    const nextTrace = observe(next, true);
    try {
      next.bodies.get("x-0--1")!.body.setBodyType(RigidBodyType.Fixed, true);
      const nextInitial = next.snapshot(), nextJoints = jointFrames(next);
      const nextSteps = reportingSteps(next, nextTrace, 35), nextBeforeTear = next.snapshot();
      const control = await engines.createEngineWorld(pair, { drop: false, floorY: 0 });
      const controlTrace = observe(control, true);
      let comparison;
      try {
        for (const { body } of control.bodies.values()) {
          body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        control.bodies.get("x-0--1")!.body.setBodyType(RigidBodyType.Fixed, true);
        const controlInitial = control.snapshot(), controlJoints = jointFrames(control);
        const controlSteps = reportingSteps(control, controlTrace, 35);
        const common = Math.min(nextTrace.samples.length, controlTrace.samples.length);
        const commonTimePositionErrors = Array.from({ length: common }, (_, i) => {
          const a = nextTrace.samples[i], b = controlTrace.samples[i];
          assert.equal(a.seconds, b.seconds);
          // Body order is pinned below; each row starts with dt followed by roof xyz.
          return { seconds: a.seconds, roofCenterDistance: Math.hypot(a.values[1] - b.values[1], a.values[2] - b.values[2], a.values[3] - b.values[3]) };
        });
        assert.deepEqual(nextTrace.bodyOrder, ["roof", "x-0--1"]); assert.deepEqual(controlTrace.bodyOrder, nextTrace.bodyOrder);
        comparison = { controlInitial, controlJoints, controlSteps, controlTrace, commonTimePositionErrors,
          testTerminalDistance: distance(control.bodies.get("roof")!.body.translation(), next.bodies.get("roof")!.body.translation()) };
      } finally { control.dispose(); }
      const joint = next.joints[0];
      let tear;
      if (joint) {
        const from = next.bodies.get(joint.model.fromTileId)!.body;
        for (const { body } of next.bodies.values()) body.setBodyType(RigidBodyType.Fixed, true);
        const pivot = transformLocal(joint.model.fromLocalAnchor, from.translation(), quaternionToBasis(from.rotation()));
        const q = multiplyQuaternions({ x: Math.sin(.007), y: 0, z: 0, w: Math.cos(.007) }, from.rotation());
        from.setRotation(q, true);
        from.setTranslation(subtract(pivot, transformLocal(joint.model.fromLocalAnchor, { x: 0, y: 0, z: 0 }, quaternionToBasis(q))), true);
        const beforeTearSteps = nextTrace.nativeSteps, prepared = next.snapshot();
        next.step();
        tear = { prepared, state: next.snapshot(), previousDistance: joint.previousDistance,
          integratedSteps: nextTrace.nativeSteps - beforeTearSteps, companionValid: joint.companion?.isValid() ?? null };
      } else tear = { skipped: "The initial joint was already absent; no replacement was introduced." };
      return { pair, originalState, nextInitial, nextJoints, nextSteps, nextBeforeTear, nextTrace, comparison, tear };
    } finally { next.dispose(); }
  } finally { original.dispose(); }
}), 30000);

it("records actual gravity timesteps and float32 inputs without changing a tolerance", () => record("gravity-time", async () => {
  const engine = await engines.createEngineWorld(flatContactFixture(), { drop: false, floorY: -100 });
  const trace = observe(engine, true);
  try {
    const body = [...engine.bodies.values()][0].body;
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const initial = engine.snapshot(), callerDt = engine.world.integrationParameters.dt;
    const inputs = { gravity: gravityVector(), worldGravity: { ...engine.world.gravity }, mass: body.mass(), invMass: body.invMass(),
      effectiveInvMass: { ...body.effectiveInvMass() }, gravityScale: body.gravityScale(), additionalSolverIterations: body.additionalSolverIterations(),
      userForce: { ...body.userForce() }, settings: integrationSettings(engine.world) };
    const reports = reportingSteps(engine, trace, 12);
    return { inputs, initial, callerDt, finalCallerDt: engine.world.integrationParameters.dt, reports, trace,
      finalVelocity: { ...body.linvel() }, analyticalVelocityY: gravityVector().y * trace.elapsedNativeSeconds,
      originalTestExpectedVelocityY: gravityVector().y * .1 };
  } finally { engine.dispose(); }
}), 30000);
