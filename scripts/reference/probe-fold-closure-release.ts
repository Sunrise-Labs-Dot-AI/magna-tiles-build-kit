/** Captured fixed-pivot continuation only, not a fresh source assembly. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { it, vi } from "vitest";
import * as engineModule from "../../lib/engine/rapier-world";
import { type EngineState, type EngineWorld, currentTilePose } from "../../lib/engine/rapier-world";
import { connectionId, worldEdge } from "../../lib/engine/build";
import { COLLISION_SUBSTEPS, PHYSICS_MODEL_VERSION, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SIMULATION_MAX_STEPS, TILE_THICKNESS } from "../../lib/engine/constants";
import { RigidBodyType } from "../../lib/engine/physics-backend";
import { add, distance, dot, magnitude, scale, subtract } from "../../lib/engine/math";
import { findRawOverlaps } from "../../lib/engine/overlap";
import { tilePrismVertices } from "../../lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, MagneticConnection, TileInstance } from "../../lib/magnetic-tiles/types";
import { contactsClosed } from "../../lib/replication/contacts";
import { checkHandTransition, type HandContact } from "../../lib/replication/grip";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { checkSweptPoses } from "../../lib/replication/rotation-clearance";
import { simulateSupport, type SupportTrial } from "../../lib/replication/support";
import type { Check } from "../../lib/replication/types";

const expectedContext = "b354b6edcbcddb7248137e9888e97badfcb7eb2156f742760783587be5dbcf1a";
const sourceArchive = "runs/diagnostics/2026-09-27-native-fold-pivots.json.gz";
const sourceRawHash = "0d36f4cf0249a54ecb3a0dc495cbf725108b3f5ce893b2edb032c66deb1523ff";
const output = "/tmp/magnatiles-fold-closure-release.json";
const third: MagneticConnection = { fromTileId: "root", fromEdge: 3, toTileId: "end", toEdge: 1, kind: "edge" };
const bodyIds = ["root", "middle", "end"];
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
interface SourceRow {
  offset: number;
  result: { direction: number; seed: number; outcome: string; failure?: unknown;
    build: BuildGraph; hands: HandContact[]; terminal: EngineState; motion: { actual: TileInstance[] }[] };
  terminalClosure: null | { retained: Check; third: Check; wholeRing: Check };
}
const idsOf = (build: BuildGraph) => build.connections.map(connectionId).sort();
function ringCheck(build: BuildGraph, expected: string[]): Check {
  return JSON.stringify(idsOf(build)) === JSON.stringify(expected)
    ? contactsClosed(build) : { status: "fail", detail: "The complete three-join ring is absent." };
}

function velocities(engine: EngineWorld) {
  return bodyIds.map(id => { const b = engine.bodies.get(id)!.body;
    return { id, mode: b.bodyType(), sleeping: b.isSleeping(), linear: { ...b.linvel() }, angular: { ...b.angvel() } }; });
}

function thirdGeometry(build: BuildGraph) {
  assert.deepEqual(build.tiles.map(t => t.id), ["root", "end"]);
  assert.deepEqual(build.connections, [third]);
  const a = worldEdge(build.tiles[0], third.fromEdge), b = worldEdge(build.tiles[1], third.toEdge);
  const delta = subtract(b.midpoint, a.midpoint);
  const aa = [a.start, a.end].map(p => dot(p, a.direction)), bb = [b.start, b.end].map(p => dot(p, a.direction));
  return { id: connectionId(third), gap: magnitude(subtract(delta, scale(a.direction, dot(delta, a.direction)))),
    overlap: Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)),
    axisAgreement: Math.abs(dot(a.direction, b.direction)), solidOverlaps: findRawOverlaps(build.tiles) };
}

async function observedSupport(build: BuildGraph, state: EngineState, hands: HandContact[], seed: number) {
  const expectedIds = idsOf(build), held = hands.map(h => h.tileId);
  const trace = createHash("sha256");
  let nativeSteps = 0, calls = 0;
  const modeChanges: { id: string; requested: number; wake: boolean; before: ReturnType<typeof velocities>; after: ReturnType<typeof velocities> }[] = [];
  const pops: { nativeSteps: number; newIds: string[]; cumulativeIds: string[] }[] = [];
  let firstNative: ReturnType<typeof velocities> | undefined;
  let initialState: EngineState | undefined, finalState: EngineState | undefined;
  let finalVelocities: ReturnType<typeof velocities> | undefined;
  let activeJointIdsBefore: string[] = [], activeJointIdsAfter: string[] = [];
  const create = engineModule.createEngineWorld;
  const spy = vi.spyOn(engineModule, "createEngineWorld").mockImplementation(async (...args) => {
    calls++;
    assert.equal(calls, 1);
    const engine = await create(...args);
    try {
      initialState = engine.snapshot();
      assert.deepEqual(initialState.bodies, state.bodies, "Continuation changed a captured body before the support routine");
      assert.deepEqual(initialState.poppedJoints, state.poppedJoints);
      assert.deepEqual(initialState.solidFailures, state.solidFailures);
      assert.equal(initialState.peakSolidOverlap, state.peakSolidOverlap);
      for (const old of state.joints) assert.deepEqual(initialState.joints.find(j => j.model.id === old.model.id), old);
      activeJointIdsBefore = engine.joints.map(j => j.id).sort();
      assert.deepEqual(activeJointIdsBefore, expectedIds);
      const models = new Map(engine.joints.map(j => [j.id, structuredClone(j.model)]));
      const checkJoints = () => {
        assert(engine.poppedJoints.every(id => expectedIds.includes(id)));
        assert.equal(new Set(engine.poppedJoints).size, engine.poppedJoints.length);
        assert.deepEqual(engine.joints.map(j => j.id).sort(), expectedIds.filter(id => !engine.poppedJoints.includes(id)));
        for (const joint of engine.joints) assert.deepEqual(joint.model, models.get(joint.id));
      };
      const checkModes = () => {
        for (const id of bodyIds) assert.equal(engine.bodies.get(id)!.body.bodyType(),
          held.includes(id) ? RigidBodyType.Fixed : RigidBodyType.Dynamic);
      };
      for (const [id, record] of engine.bodies) {
        const change = record.body.setBodyType.bind(record.body);
        record.body.setBodyType = (type, wake) => {
          assert.equal(wake, true, "Support mode changes must request wakeup");
          const before = velocities(engine); change(type, wake);
          modeChanges.push({ id, requested: type, wake, before, after: velocities(engine) });
        };
      }
      const native = engine.world.step.bind(engine.world);
      engine.world.step = () => {
        checkModes(); checkJoints();
        if (!firstNative) {
          firstNative = velocities(engine);
          for (const body of firstNative) if (body.mode === RigidBodyType.Dynamic &&
              state.bodies.find(b => b.referenceTile.id === body.id)!.bodyType !== RigidBodyType.Dynamic)
            assert.equal(body.sleeping, false, "A newly released body must be awake");
        }
        native(); nativeSteps++;
        checkModes(); checkJoints();
        const values = bodyIds.flatMap(id => {
          const b = engine.bodies.get(id)!.body, p = b.translation(), q = b.rotation(), l = b.linvel(), a = b.angvel();
          return [p.x,p.y,p.z,q.x,q.y,q.z,q.w,l.x,l.y,l.z,a.x,a.y,a.z,b.bodyType(),Number(b.isSleeping())];
        });
        trace.update(Buffer.from(new Float64Array(values).buffer));
      };
      const step = engine.step.bind(engine);
      engine.step = () => {
        checkJoints(); const oldPops = engine.poppedJoints.length;
        step(); checkJoints();
        if (engine.poppedJoints.length !== oldPops) pops.push({ nativeSteps,
          newIds: engine.poppedJoints.slice(oldPops), cumulativeIds: [...engine.poppedJoints] });
      };
      const dispose = engine.dispose.bind(engine);
      engine.dispose = () => {
        finalState = engine.snapshot(); finalVelocities = velocities(engine);
        activeJointIdsAfter = engine.joints.map(j => j.id).sort(); dispose();
      };
      return engine;
    } catch (error) { engine.dispose(); throw error; }
  });
  let result: SupportTrial | null = null, instrumentationError: string | null = null;
  try {
    result = await simulateSupport(build, held, 0, seed, Infinity, state, hands);
    assert.equal(calls, 1, "Support must use the observed world factory");
    assert.equal(modeChanges.length, 3, "Every original panel must receive its support mode");
    if (result.status === "pass") {
      assert(firstNative); assert.equal(nativeSteps, SIMULATION_MAX_STEPS * COLLISION_SUBSTEPS);
      assert.deepEqual(activeJointIdsAfter, expectedIds);
    }
  }
  catch (error) { instrumentationError = error instanceof Error ? error.message : String(error); }
  finally { spy.mockRestore(); }
  return { result, instrumentationError, observation: { calls, nativeSteps, activeJointIdsBefore, activeJointIdsAfter,
    pops, initialState, modeChanges, firstNative, finalVelocities, finalState, trajectorySha256: trace.digest("hex"),
    trajectoryBodyOrder: bodyIds, trajectoryEncoding: "ordered IEEE754 float64 little-endian native values" } };
}

async function continueRow(row: SourceRow, firstWithdraw: string) {
  const source = row.result, initialState = structuredClone(source.terminal);
  assert.equal(initialState.physicsModel, PHYSICS_MODEL_VERSION);
  assert.deepEqual(initialState.bodies.map(b => b.referenceTile.id), bodyIds);
  assert.equal(initialState.joints.length, 2);
  assert.equal(initialState.poppedJoints.length, 0); assert.equal(initialState.solidFailures.length, 0);
  const actual: BuildGraph = { ...source.build, tiles: initialState.bodies.map(b =>
    currentTilePose(b.referenceTile, b.position, b.rotation, 0)), connections: initialState.connections };
  const last = source.motion.at(-1)!.actual;
  const reconstructionError = Math.max(...actual.tiles.flatMap((tile, i) => tilePrismVertices(tile).map((p, n) =>
    distance(p, tilePrismVertices(last[i])[n]))));
  assert(reconstructionError < 1e-12);
  const ring: BuildGraph = { ...actual, connections: [...actual.connections, third] };
  const expectedIds = idsOf(ring);
  assert.equal(new Set(expectedIds).size, 3);
  const thirdOnly = { ...actual, tiles: actual.tiles.filter(t => t.id !== "middle"), connections: [third] };
  const separated = { ...thirdOnly, tiles: thirdOnly.tiles.map(t => t.id === "end"
    ? { ...t, position: add(t.position, { x: .5, y: 0, z: 0 }) } : t) };
  const controls = { missingThird: ringCheck(actual, expectedIds), separatedThird: contactsClosed(separated),
    originalThirdGeometry: thirdGeometry(thirdOnly), separatedThirdGeometry: thirdGeometry(separated) };
  assert.equal(controls.missingThird.status, "fail"); assert.equal(controls.separatedThird.status, "fail");
  assert(controls.originalThirdGeometry.gap <= TILE_THICKNESS + .03);
  assert(controls.separatedThirdGeometry.gap > TILE_THICKNESS + .03);
  assert(controls.separatedThirdGeometry.axisAgreement >= Math.cos(Math.PI / 36));
  assert(controls.separatedThirdGeometry.overlap >= 3 - .21);
  assert.equal(controls.separatedThirdGeometry.solidOverlaps.length, 0);
  const prerequisite = { retained: contactsClosed(actual), third: contactsClosed(thirdOnly), fullRing: ringCheck(ring, expectedIds),
    solids: checkSweptPoses(ring, ring, 0), withdrawal: checkHandTransition(ring, source.hands, [], 0) };
  const phases: { name: string; transition: Check; preWithdrawalSpeeds: { id: string; linear: number; angular: number }[];
    trial?: Awaited<ReturnType<typeof observedSupport>>; finalContact?: Check; status: string; detail: string }[] = [];
  const base = { offset: row.offset, direction: source.direction, seed: source.seed, firstWithdraw,
    sourceStateSha256: sha(JSON.stringify(source.terminal)), reconstructionError, controls, prerequisite };
  const rejected = Object.values(prerequisite).find(c => c.status !== "pass");
  if (rejected) return { ...base, status: "prerequisite-failed", detail: rejected.detail, phases };
  let current = ring, state = initialState, oldHands = source.hands;
  for (const [index, nextHands] of [source.hands, source.hands.filter(h => h.tileId !== firstWithdraw), []].entries()) {
    const name = ["two-hand-stop", "one-hand-support", "hands-free-rest"][index];
    const transition = checkHandTransition(current, oldHands, nextHands, 0);
    const preWithdrawalSpeeds = state.bodies.filter(b => oldHands.some(h => h.tileId === b.referenceTile.id) &&
      !nextHands.some(h => h.tileId === b.referenceTile.id)).map(b => ({ id: b.referenceTile.id,
        linear: magnitude(b.linearVelocity), angular: magnitude(b.angularVelocity) }));
    const stopped = preWithdrawalSpeeds.every(b => b.linear < SETTLED_LINEAR_SPEED && b.angular < SETTLED_ANGULAR_SPEED);
    if (transition.status !== "pass" || !stopped) {
      phases.push({ name, transition, preWithdrawalSpeeds, status: "fail", detail: stopped ? transition.detail : "Held panel did not stop before withdrawal." }); break;
    }
    const trial = await observedSupport(current, state, nextHands, source.seed);
    const result = trial.result;
    const finalContact = result ? ringCheck(result.settled, expectedIds) : undefined;
    const allJoins = result && JSON.stringify(result.state.joints.map(j => j.model.id).sort()) === JSON.stringify(expectedIds);
    const passed = result?.status === "pass" && !trial.instrumentationError && allJoins && finalContact?.status === "pass";
    phases.push({ name, transition, preWithdrawalSpeeds, trial, finalContact, status: passed ? "pass" : "fail",
      detail: trial.instrumentationError ?? (passed ? result!.detail : `Support: ${result?.detail}; final contact: ${finalContact?.detail}`) });
    if (!passed) break;
    current = result!.settled; state = result!.state; oldHands = nextHands;
  }
  return { ...base, status: phases.length === 3 && phases.every(p => p.status === "pass") ? "captured-release-pass" : "continuation-failed",
    detail: phases.at(-1)!.detail, phases };
}

it("measures captured fold closure, stopped-hand withdrawal and unassisted rest", async () => {
  const context = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes([
    sourceArchive, "scripts/reference/probe-fold-closure-release.ts", "scripts/reference/probe-fold-closure-release.config.ts",
  ]) };
  assert.equal(context.validationCodeHash, expectedContext);
  assert.equal(execFileSync("git", ["diff", "--name-only", "245e440", "--", "lib/engine", "lib/magnetic-tiles",
    "lib/replication/support.ts", "lib/replication/grip.ts", "vendor/rapier-contact"], { encoding: "utf8" }).trim(), "");
  const bytes = gunzipSync(await readFile(sourceArchive)); assert.equal(sha(bytes), sourceRawHash);
  const source = JSON.parse(bytes.toString()) as { completed: boolean; rows: SourceRow[] };
  assert(source.completed); assert.equal(source.rows.length, 18);
  const eligible = source.rows.filter(r => r.result.outcome === "command-completed");
  assert.equal(eligible.length, 6);
  assert.deepEqual(eligible.map(r => [r.offset, r.result.direction, r.result.seed]),
    [-.09, .09].flatMap(offset => [0,17,53].map(seed => [offset, -Math.sign(offset), seed])));
  assert(eligible.every(r => r.terminalClosure && Object.values(r.terminalClosure).filter(c => c && "status" in c).every(c => c.status === "pass")));
  const historicalFailures = source.rows.filter(r => r.result.outcome !== "command-completed")
    .map(r => ({ offset: r.offset, direction: r.result.direction, seed: r.result.seed, outcome: r.result.outcome, failure: r.result.failure }));
  const rows: Awaited<ReturnType<typeof continueRow>>[] = [];
  const save = async (completed: boolean) => {
    assert.equal(await validationCodeHash(), expectedContext);
    assert.deepEqual(await artifactHashes(Object.keys(context.inputHashes)), context.inputHashes);
    const instrumentationFailures = rows.flatMap(row => row.phases.filter(p => p.trial?.instrumentationError).map(p => ({
      offset: row.offset, direction: row.direction, seed: row.seed, firstWithdraw: row.firstWithdraw,
      phase: p.name, error: p.trial!.instrumentationError,
    })));
    assert(!completed || !instrumentationFailures.length);
    await writeFile(`${output}.tmp`, JSON.stringify({ scope: "Captured experimental fixed-pivot endpoint continuation, including a stopped-hand phase. No universal seam, fresh fold-to-release, source assembly or physical calibration acceptance.",
      context, sourceRawHash, completed, instrumentationFailures, historicalFailures, requiredRows: 12, rows }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
  };
  await save(false);
  for (const row of eligible) for (const firstWithdraw of ["end", "root"]) {
    rows.push(await continueRow(row, firstWithdraw)); await save(false);
    const latest = rows.at(-1)!;
    console.log(JSON.stringify({ offset: latest.offset, direction: latest.direction, seed: latest.seed, firstWithdraw,
      status: latest.status, phases: latest.phases.map(p => ({ name: p.name, status: p.status, detail: p.detail })) }));
  }
  assert.equal(rows.length, 12);
  assert(rows.every(row => row.phases.every(p => !p.trial?.instrumentationError)), "Instrumentation failed; incomplete diagnostic output is preserved. Repair before interpreting physics.");
  await save(true);
}, 300000);
