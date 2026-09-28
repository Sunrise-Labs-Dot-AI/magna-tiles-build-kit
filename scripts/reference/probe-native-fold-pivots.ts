/** Isolated fixed-pivot hypotheses, copied from the reviewed native fold probe.
 * No production model change, universal hinge claim or assembly acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { it, vi } from "vitest";
import * as physicsModel from "../../lib/engine/physics-model";
import { JointType, type RevoluteImpulseJoint } from "@magnatiles/rapier-contact";
import { integrationSettings, RigidBodyType } from "../../lib/engine/physics-backend";
import { createEngineWorld, perturbFirstRelease, type EngineWorld } from "../../lib/engine/rapier-world";
import { COLLISION_SUBSTEPS, MAX_STANDING_DISPLACEMENT, SIMULATION_TIMESTEP_SECONDS, TILE_THICKNESS } from "../../lib/engine/constants";
import { worldEdge } from "../../lib/engine/build";
import { add, cross, distance, dot, inverseQuaternion, magnitude, multiplyQuaternions, normalize,
  quaternionAngle, quaternionToBasis, scale, subtract, transformLocal } from "../../lib/engine/math";
import { RAW_OVERLAP_TOLERANCE } from "../../lib/engine/overlap";
import { tilePrismVertices } from "../../lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "../../lib/magnetic-tiles/types";
import { assemble, square, v } from "../../lib/replication/geometry";
import { closedMagneticConnection, contactsClosed } from "../../lib/replication/contacts";
import { checkHandAccess, checkMotionFingerClearance, edgeGrips } from "../../lib/replication/grip";
import { checkSweptPoses, tileQuaternion } from "../../lib/replication/rotation-clearance";
import { supportSnapshot } from "../../lib/replication/support";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";

const output = "/tmp/magnatiles-native-fold-pivots.json";
const stationarySeconds = .1, foldSeconds = 10, targetRadians = 2 * Math.PI / 3;
const ids = ["root", "middle", "end"];
const expectedModes = [RigidBodyType.Fixed, RigidBodyType.Dynamic, RigidBodyType.KinematicPositionBased];
const makeBuild = (gap: number) => assemble(`native-fold-${gap}`, "Three-panel folding diagnostic", [
  square("root", v(-3, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip"),
  square("middle", v(gap, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip"),
  square("end", v(3 + 2 * gap, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip"),
], "tower");

function rotateTile(tile: TileInstance, anchor: Vec3, axis: Vec3, angle: number): TileInstance {
  const rotate = (p: Vec3) => add(add(scale(p, Math.cos(angle)), scale(cross(axis, p), Math.sin(angle))),
    scale(axis, dot(axis, p) * (1 - Math.cos(angle))));
  assert(tile.basis);
  return { ...tile, position: add(anchor, rotate(subtract(tile.position, anchor))), basis: {
    xAxis: rotate(tile.basis.xAxis), yAxis: rotate(tile.basis.yAxis), zAxis: rotate(tile.basis.zAxis),
  } };
}

function jointRecords(engine: EngineWorld) {
  return engine.joints.map(record => {
    const joint = record.joint;
    assert(joint.isValid(), "An installed joint is no longer valid");
    assert.equal(joint.type(), JointType.Revolute, "The fixture requires actual revolute joints");
    assert.equal(record.companion, undefined);
    assert.equal(record.model.secondAnchors, undefined);
    const revolute = joint as RevoluteImpulseJoint;
    return { id: record.id, handle: joint.handle, from: record.model.fromTileId, to: record.model.toTileId,
      fromBodyHandle: joint.body1().handle, toBodyHandle: joint.body2().handle, type: joint.type(),
      anchor1: { ...joint.anchor1() }, anchor2: { ...joint.anchor2() },
      frame1: { ...joint.frameX1() }, frame2: { ...joint.frameX2() },
      model: structuredClone(record.model), secondAnchorsPresent: Boolean(record.model.secondAnchors),
      companionPresent: Boolean(record.companion), contactsEnabled: joint.contactsEnabled(),
      limits: { enabled: revolute.limitsEnabled(), min: revolute.limitsMin(), max: revolute.limitsMax() } };
  });
}

function worldJointFrames(engine: EngineWorld, joints: ReturnType<typeof jointRecords>) {
  return joints.map(joint => {
    const first = engine.bodies.get(joint.from)!.body, second = engine.bodies.get(joint.to)!.body;
    const firstBasis = quaternionToBasis(first.rotation()), secondBasis = quaternionToBasis(second.rotation());
    const anchor1 = transformLocal(joint.anchor1, first.translation(), firstBasis);
    const anchor2 = transformLocal(joint.anchor2, second.translation(), secondBasis);
    // Rapier's local joint frames orient joint-local X along the free hinge axis.
    const axis1 = transformLocal(quaternionToBasis(joint.frame1).xAxis, v(0, 0, 0), firstBasis);
    const axis2 = transformLocal(quaternionToBasis(joint.frame2).xAxis, v(0, 0, 0), secondBasis);
    return { id: joint.id, anchor1, anchor2, axis1, axis2, anchorDiscrepancy: distance(anchor1, anchor2),
      axisAgreement: dot(axis1, axis2) };
  });
}

async function runRow(gap: number, direction: number, seed: number,
  verifyNativeSetup: (joints: ReturnType<typeof jointRecords>) => void) {
  const build = makeBuild(gap);
  const hands = [build.tiles[2], build.tiles[0]].map(tile => edgeGrips(tile).sort((a, b) =>
    transformLocal(b.localPoint, tile.position, tile.basis!).y - transformLocal(a.localPoint, tile.position, tile.basis!).y)[0]);
  const access = (actual: BuildGraph) => checkHandAccess(actual, { id: "fold-grips", movingTileIds: ["end"],
    fixedTileIds: ["root", "middle"], offsets: [v(0, 0, 0), v(0, 0, 0)] }, hands, 0);
  const authored = { closure: contactsClosed(build), clearance: checkSweptPoses(build, build, 0), access: access(build) };
  const setup = { gap, direction, seed, build, hands, authored };
  if (Object.values(authored).some(check => check.status !== "pass"))
    return { ...setup, outcome: "authored-setup-rejected", nativeSteps: 0 };

  const engine = await createEngineWorld(build, { drop: false, floorY: 0 });
  const trace = createHash("sha256");
  let nativeSteps = 0;
  try {
    const beforeGrips = engine.snapshot(), initial = supportSnapshot(build, engine), joints = jointRecords(engine);
    verifyNativeSetup(joints);
    assert.deepEqual([...engine.bodies.keys()], ids);
    assert.equal(joints.length, 2);
    assert.deepEqual(joints.map(j => [j.from, j.to]), [["root", "middle"], ["middle", "end"]]);
    const hinges = worldJointFrames(engine, joints);
    for (const [i, hinge] of hinges.entries()) {
      assert(Math.abs(magnitude(hinge.axis1) - 1) < 1e-6 && hinge.axisAgreement > 1 - 1e-6, "Malformed native hinge axes");
      assert(dot(hinge.axis1, normalize(joints[i].model.axis)) > 1 - 1e-6, "Native frame does not agree with the model axis");
      assert.equal(joints[i].fromBodyHandle, engine.bodies.get(joints[i].from)!.body.handle);
      assert.equal(joints[i].toBodyHandle, engine.bodies.get(joints[i].to)!.body.handle);
    }
    const nativeInitial = structuredClone({ closure: contactsClosed(initial), clearance: checkSweptPoses(initial, initial, 0), access: access(initial),
      rejectedReasons: engine.rejectedReasons, invalidState: engine.invalidState, solidFailures: engine.solidFailures });
    const nativeSetup = { ...setup, beforeGrips, initial, joints, hinges, nativeInitial };
    if ([nativeInitial.closure, nativeInitial.clearance, nativeInitial.access].some(check => check.status !== "pass") ||
        engine.rejectedReasons.length || engine.invalidState || engine.solidFailures.length)
      return { ...nativeSetup, outcome: "native-setup-rejected", nativeSteps: 0, terminal: engine.snapshot() };

    engine.world.integrationParameters.dt = SIMULATION_TIMESTEP_SECONDS / COLLISION_SUBSTEPS;
    const settings = integrationSettings(engine.world), dt = settings.dt;
    for (const [index, id] of ids.entries()) {
      const body = engine.bodies.get(id)!.body;
      body.enableCcd(true);
      body.setBodyType(expectedModes[index], true);
    }
    const beforePerturbation = engine.snapshot();
    assert.equal(engine.bodies.get("middle")!.releasePerturbed, false);
    perturbFirstRelease(engine.bodies.get("middle")!, 1, seed);
    const afterPerturbation = engine.snapshot();
    const modes = () => ids.map(id => engine.bodies.get(id)!.body.bodyType());
    const assertConstraints = () => {
      assert.deepEqual(modes(), expectedModes);
      assert.deepEqual(jointRecords(engine), joints, "Installed hinge identity or local frame changed");
    };
    assertConstraints();
    const nativeStep = engine.world.step.bind(engine.world);
    engine.world.step = () => {
      assertConstraints();
      nativeStep(); nativeSteps++;
      assertConstraints();
      const values = [engine.world.integrationParameters.dt, ...ids.flatMap(id => {
        const body = engine.bodies.get(id)!.body;
        const p = body.translation(), q = body.rotation(), l = body.linvel(), a = body.angvel();
        return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, l.x, l.y, l.z, a.x, a.y, a.z,
          body.bodyType(), Number(body.isSleeping()), Number(body.isCcdEnabled())];
      })];
      trace.update(Buffer.from(new Float64Array(values).buffer));
    };
    const expectedAt = (seconds: number) => {
      const angle = direction * targetRadians * Math.min(1, Math.max(0, (seconds - stationarySeconds) / foldSeconds));
      const proximal = (tile: TileInstance) => rotateTile(tile, hinges[0].anchor1, normalize(hinges[0].axis1), angle);
      return { ...initial, tiles: [initial.tiles[0], proximal(initial.tiles[1]),
        proximal(rotateTile(initial.tiles[2], hinges[1].anchor1, normalize(hinges[1].axis1), angle))] };
    };
    const end = engine.bodies.get("end")!, inverseReference = inverseQuaternion(tileQuaternion(end.tile));
    const motion = [{ seconds: 0, nativeSteps: 0, actual: initial.tiles, expected: expectedAt(0).tiles, residuals: [0, 0, 0] }];
    let previous = initial, previousExpected = expectedAt(0), seconds = 0;
    let peakResidual = 0, peakCommandLinearSpeed = 0, peakCommandAngularSpeed = 0;
    let peakRetainedEdgeGap = 0;
    let failure: { kind: string; detail: string; seconds: number; nativeSteps: number } | null = null;
    const plannedSteps = Math.ceil((stationarySeconds + foldSeconds) / dt);
    for (let step = 0; step < plannedSteps; step++) {
      const nextSeconds = (step + 1) * dt, expected = expectedAt(nextSeconds), desired = expected.tiles[2];
      const linear = distance(desired.position, previousExpected.tiles[2].position) / dt;
      const angular = quaternionAngle(tileQuaternion(desired), tileQuaternion(previousExpected.tiles[2])) / dt;
      peakCommandLinearSpeed = Math.max(peakCommandLinearSpeed, linear);
      peakCommandAngularSpeed = Math.max(peakCommandAngularSpeed, angular);
      assert(linear <= 2 + 1e-6 && angular <= 1 + 1e-6, "Command exceeded existing hand-motion limits");
      end.body.setNextKinematicTranslation(desired.position);
      end.body.setNextKinematicRotation(multiplyQuaternions(tileQuaternion(desired), inverseReference));
      const beforeSteps = nativeSteps;
      engine.step();
      assert(nativeSteps - beforeSteps <= 1, "Observer would miss an internal native step");
      seconds = nativeSteps * dt;
      const actual = supportSnapshot(build, engine);
      for (const c of actual.connections) {
        const a = worldEdge(actual.tiles.find(t => t.id === c.fromTileId)!, c.fromEdge);
        const b = worldEdge(actual.tiles.find(t => t.id === c.toTileId)!, c.toEdge);
        const delta = subtract(b.midpoint, a.midpoint);
        peakRetainedEdgeGap = Math.max(peakRetainedEdgeGap, magnitude(subtract(delta, scale(a.direction, dot(delta, a.direction)))));
      }
      const residuals = actual.tiles.map((tile, index) => {
        const target = tilePrismVertices(expected.tiles[index]);
        return Math.max(...tilePrismVertices(tile).map((point, vertex) => distance(point, target[vertex])));
      });
      peakResidual = Math.max(peakResidual, ...residuals);
      const solids = checkSweptPoses(previous, actual, 0), fingers = checkMotionFingerClearance(previous, actual, hands, 0);
      const causes = [
        ...(engine.invalidState ? [{ kind: "invalid-state", detail: "The engine detected an invalid physical state." }] : []),
        ...engine.solidFailures.map(f => ({ kind: "native-solid", detail: f.detail })),
        ...(engine.poppedJoints.length ? [{ kind: "broken-joint", detail: engine.poppedJoints.join(", ") }] : []),
        ...(engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE ? [{ kind: "ground", detail: String(engine.peakGroundPenetration) }] : []),
        ...(solids.status !== "pass" ? [{ kind: "caller-solid", detail: solids.detail }] : []),
        ...(fingers.status !== "pass" ? [{ kind: "finger-clearance", detail: fingers.detail }] : []),
        ...(!Number.isFinite(peakResidual) || peakResidual > MAX_STANDING_DISPLACEMENT ? [{ kind: "target-deviation", detail: String(peakResidual) }] : []),
      ];
      if (causes.length) failure = { ...causes[0], seconds, nativeSteps };
      if (step % 128 === 0 || step === plannedSteps - 1 || failure)
        motion.push({ seconds, nativeSteps, actual: actual.tiles, expected: expected.tiles, residuals });
      previous = actual; previousExpected = expected;
      if (failure) break;
      assert.equal(nativeSteps, step + 1);
      assertConstraints();
    }
    return { ...nativeSetup, outcome: failure ? "motion-failed" : "command-completed", beforePerturbation, afterPerturbation,
      settings, stationarySeconds, foldSeconds, targetRadians, plannedSteps, nativeSteps, seconds, failure,
      trajectorySha256: trace.digest("hex"), trajectoryBodyOrder: ids, trajectoryEncoding: "ordered IEEE754 float64 little-endian native values",
      peakResidual, peakCommandLinearSpeed, peakCommandAngularSpeed, peakRetainedEdgeGap, initialPoseDisplacementDiagnostic: engine.maxDisplacement(),
      terminal: engine.snapshot(), terminalJointFrames: worldJointFrames(engine, jointRecords(engine)),
      terminalContact: failure ? null : closedMagneticConnection(previous, previous.tiles[0], previous.tiles[2]),
      motion, peakGroundPenetration: engine.peakGroundPenetration, peakSolidOverlap: engine.peakSolidOverlap,
      solidFailures: engine.solidFailures, poppedJoints: engine.poppedJoints };
  } finally { engine.dispose(); }
}

async function main() {
  const nativeArchive = "runs/diagnostics/2026-09-27-native-fold-corrected.json.gz";
  const geometricArchive = "runs/diagnostics/2026-09-27-fold-pivots.json.gz";
  const context = { validationCodeHash: await validationCodeHash(), scriptHashes: await artifactHashes([
    "scripts/reference/probe-native-fold-pivots.ts", "scripts/reference/probe-native-fold-pivots.config.ts",
    "scripts/reference/probe-native-fold.ts", nativeArchive, geometricArchive,
  ]) };
  assert.equal(context.validationCodeHash, "3a2ed4ddf041cbf7615825b5e75dd6b3132f520d65c19ff662896a1285b5381d",
    "This declared experiment requires the reviewed frozen runtime");
  const historicalBytes = gunzipSync(await readFile(nativeArchive));
  assert.equal(createHash("sha256").update(historicalBytes).digest("hex"), "227416a245557f4ca7b0c84d751b07db17f63b654e1571f18148fd0f480a97c4");
  assert.equal(createHash("sha256").update(gunzipSync(await readFile(geometricArchive))).digest("hex"), "6429fba205ad440963074c80a3b64f0032e0a3bf81dc9f8550342f58e4bb5b63");
  const historical = JSON.parse(historicalBytes.toString()) as { rows: Awaited<ReturnType<typeof runRow>>[] };
  const controlBuild = makeBuild(.36), control = { build: controlBuild, closure: contactsClosed(controlBuild), nativeSteps: 0 };
  assert.equal(control.closure.status, "fail", "Separated control cannot count as attached");
  type Injection = { original: physicsModel.MagneticPhysicsModel; altered: physicsModel.MagneticPhysicsModel };
  const rows: { offset: number; hypothesis: string; injectedModels: Injection[]; result: Awaited<ReturnType<typeof runRow>>;
    exactHistoricalControl: boolean | null; terminalClosure: ReturnType<typeof terminalClosure> }[] = [];
  const save = async (completed: boolean) => {
    assert.equal(await validationCodeHash(), context.validationCodeHash);
    assert.deepEqual(await artifactHashes(Object.keys(context.scriptHashes)), context.scriptHashes);
    await writeFile(`${output}.tmp`, JSON.stringify({ scope: "Native fixed-pivot hypothesis comparison with an injected pre-construction model. Not production physics evidence or a universal magnetic model. No source, material, free release or assembly acceptance.",
      context, completed, requiredRows: 18, control, rows }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
  };
  await save(false);
  for (const offset of [-TILE_THICKNESS / 2, 0, TILE_THICKNESS / 2]) for (const direction of [-1, 1]) for (const seed of [0, 17, 53]) {
    const createModel = physicsModel.createMagneticPhysicsModel, injectedModels: Injection[] = [];
    const spy = vi.spyOn(physicsModel, "createMagneticPhysicsModel").mockImplementation((...args) => {
      const original = createModel(...args), normal = normalize(args[0].tiles[0].basis!.zAxis), delta = scale(normal, offset);
      assert.equal(original.joints.length, 2);
      assert(args[0].tiles.every(t => distance(t.basis!.zAxis, normal) < 1e-12));
      const point = (edge: physicsModel.PhysicsJointModel["fromLocal"]) => {
        assert.equal(edge.length, 0); assert.equal(magnitude(edge.direction), 0);
        return { ...edge, start: add(edge.start, delta), end: add(edge.end, delta), midpoint: add(edge.midpoint, delta) };
      };
      const altered = offset === 0 ? original : { ...original, joints: original.joints.map(j => ({ ...j,
        fromLocalAnchor: add(j.fromLocalAnchor, delta), toLocalAnchor: add(j.toLocalAnchor, delta),
        fromLocal: point(j.fromLocal), toLocal: point(j.toLocal),
      })) };
      assert.deepEqual({ ...altered, joints: [] }, { ...original, joints: [] });
      for (const [i, joint] of altered.joints.entries()) {
        const before = original.joints[i];
        assert.deepEqual({ ...joint, fromLocalAnchor: before.fromLocalAnchor, toLocalAnchor: before.toLocalAnchor,
          fromLocal: before.fromLocal, toLocal: before.toLocal }, before);
      }
      injectedModels.push(structuredClone({ original, altered }));
      return altered;
    });
    const verifyNativeSetup = (joints: ReturnType<typeof jointRecords>) => {
      assert.equal(injectedModels.length, 1, "The hypothesis must be injected before native construction");
      assert.deepEqual(joints.map(j => j.model), injectedModels[0].altered.joints);
      const f32 = (p: Vec3) => ({ x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z) });
      for (const joint of joints) {
        assert.deepEqual(joint.anchor1, f32(joint.model.fromLocalAnchor));
        assert.deepEqual(joint.anchor2, f32(joint.model.toLocalAnchor));
      }
    };
    let result;
    try { result = await runRow(.09, direction, seed, verifyNativeSetup); } finally { spy.mockRestore(); }
    assert.equal(injectedModels.length, 1, "The declared model injection must occur exactly once before native construction");
    assert("joints" in result, "Missing native setup/joint evidence");
    if (offset === 0) {
      const before = historical.rows.find(r => r.gap === .09 && r.direction === direction && r.seed === seed);
      assert(before && "peakRetainedEdgeGap" in result);
      // Only this newly measured field is absent from the old row. Compare
      // every original field after the same JSON serialization as the archive.
      const oldFields = JSON.parse(JSON.stringify(result)); delete oldFields.peakRetainedEdgeGap;
      assert.deepEqual(oldFields, before, "Zero-offset complete native result changed");
    }
    rows.push({ offset, hypothesis: `experimental-fixed-pivot-normal-offset-${offset}`, injectedModels, result,
      exactHistoricalControl: offset === 0 ? true : null, terminalClosure: terminalClosure(result) });
    await save(false);
    console.log(JSON.stringify({ offset, direction, seed, outcome: result.outcome, nativeSteps: result.nativeSteps }));
  }
  assert.equal(rows.length, 18); await save(true);
}

function terminalClosure(result: Awaited<ReturnType<typeof runRow>>) {
  if (result.outcome !== "command-completed" || !("motion" in result)) return null;
  const actual = { ...result.build, tiles: result.motion.at(-1)!.actual };
  const proposedThird = { fromTileId: "root", fromEdge: 3, toTileId: "end", toEdge: 1, kind: "edge" as const };
  const root = actual.tiles.find(t => t.id === "root")!, end = actual.tiles.find(t => t.id === "end")!;
  return { proposedThird, retained: contactsClosed(actual),
    third: contactsClosed({ ...actual, tiles: [root, end], connections: [proposedThird] }),
    wholeRing: contactsClosed({ ...actual, connections: [...actual.connections, proposedThird] }) };
}

it("compares all fixed-pivot native hypotheses and exact historical controls", main, 300000);
