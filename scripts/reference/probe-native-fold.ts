/** Off-path articulation diagnostic. Only the end panels receive hand constraints.
 * Completion is experiment coverage, never source/release/assembly acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { JointType, type RevoluteImpulseJoint } from "@magnatiles/rapier-contact";
import { integrationSettings, RigidBodyType } from "../../lib/engine/physics-backend";
import { createEngineWorld, perturbFirstRelease, type EngineWorld } from "../../lib/engine/rapier-world";
import { COLLISION_SUBSTEPS, MAX_STANDING_DISPLACEMENT, SIMULATION_TIMESTEP_SECONDS } from "../../lib/engine/constants";
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

const output = "/tmp/magnatiles-native-fold.json";
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

async function runRow(gap: number, direction: number, seed: number) {
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
      peakResidual, peakCommandLinearSpeed, peakCommandAngularSpeed, initialPoseDisplacementDiagnostic: engine.maxDisplacement(),
      terminal: engine.snapshot(), terminalJointFrames: worldJointFrames(engine, jointRecords(engine)),
      terminalContact: failure ? null : closedMagneticConnection(previous, previous.tiles[0], previous.tiles[2]),
      motion, peakGroundPenetration: engine.peakGroundPenetration, peakSolidOverlap: engine.peakSolidOverlap,
      solidFailures: engine.solidFailures, poppedJoints: engine.poppedJoints };
  } finally { engine.dispose(); }
}

async function main() {
  const context = { validationCodeHash: await validationCodeHash(), scriptHashes: await artifactHashes(["scripts/reference/probe-native-fold.ts"]) };
  assert.equal(context.validationCodeHash, "7a8ad00bf79266e385e434dcb9bdb6f7fabe98d1511f8564b36cd81496c93e29",
    "This declared experiment requires the reviewed frozen runtime");
  const controlBuild = makeBuild(.36), control = { build: controlBuild, closure: contactsClosed(controlBuild), nativeSteps: 0 };
  assert.equal(control.closure.status, "fail", "Separated control cannot count as attached");
  const rows: Awaited<ReturnType<typeof runRow>>[] = [];
  const save = async (completed: boolean) => {
    assert.equal(await validationCodeHash(), context.validationCodeHash);
    assert.deepEqual(await artifactHashes(Object.keys(context.scriptHashes)), context.scriptHashes);
    await writeFile(`${output}.tmp`, JSON.stringify({ scope: "Native three-panel folding diagnostic. No source, material, release or assembly acceptance.",
      context, completed, requiredRows: 12, control, rows }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
  };
  await save(false);
  for (const gap of [.09, .21]) for (const direction of [-1, 1]) for (const seed of [0, 17, 53]) {
    const row = await runRow(gap, direction, seed);
    rows.push(row); await save(false);
    console.log(JSON.stringify({ gap, direction, seed, outcome: row.outcome, nativeSteps: row.nativeSteps }));
  }
  assert.equal(rows.length, 12); await save(true);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
