/** Native point-spring unit coupons. No tile, seam, folding or source certificate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { it } from "vitest";
import { JointType } from "@magnatiles/rapier-contact";
import { World, JointData, RigidBodyDesc, integrationSettings, type RigidBody } from "../../lib/engine/physics-backend";
import { initRapier } from "../../lib/engine/rapier-world";
import { add, cross, distance, dot, inverseQuaternion, magnitude, multiplyQuaternions,
  normalizeQuaternion, quaternionToBasis, scale, subtract, transformLocal, type Quat } from "../../lib/engine/math";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import type { Vec3 } from "../../lib/magnetic-tiles/types";
import { configureExperimentalGyro, experimentalGyroContext, gyroPrecision } from "./gyroscopic-probe-context";

const zero = { x: 0, y: 0, z: 0 }, identity = { x: 0, y: 0, z: 0, w: 1 };
const units = 1000 / 25.4, stiffness = 8 * units, damping = .225 * units;
const freeTimestep = Number(process.env.MAGNATILES_SPRING_FREE_DT ?? "0.0001");
assert([1e-4, 5e-5, 2.5e-5].includes(freeTimestep));
assert(freeTimestep === 1e-4 || (gyroPrecision === "f64" && process.env.MAGNATILES_GYRO_MODE === "on"));
const expectedContext = "b354b6edcbcddb7248137e9888e97badfcb7eb2156f742760783587be5dbcf1a";
const output = process.env.MAGNATILES_SPRING_REPORT ?? "/tmp/magnatiles-spring-semantics.json";
type Verdict = { id: string; pass: boolean; detail: unknown };
type Frame = { rotation: Quat; translation: Vec3 };
type BodyState = { id: string; mass: number; inertia: Vec3; principalFrame: Quat; position: Vec3;
  rotation: Quat; velocity: Vec3; angular: Vec3; sleeping: boolean };
const checks: Verdict[] = [];
const check = (id: string, pass: boolean, detail: unknown) => { checks.push({ id, pass, detail }); };
const rotate = (p: Vec3, q: Quat) => transformLocal(p, zero, quaternionToBasis(normalizeQuaternion(q)));
const dotEnergy = (p: Vec3) => dot(p, p);

function verifyMassProperties(body: RigidBody, mass: number) {
  configureExperimentalGyro(body);
  // Native additional mass is deferred until a step or this explicit refresh. Do not advance the coupon to initialize it.
  body.recomputeMassPropertiesFromColliders();
  assert.equal(body.mass(), mass);
  const inertia = body.principalInertia();
  for (const [axis, expected] of Object.entries({ x: .4 * mass, y: .5 * mass, z: .6 * mass }))
    assert(Math.abs(inertia[axis as keyof Vec3] / expected - 1) < 1e-6);
  assert.deepEqual({ ...body.localCom() }, zero);
  assert.deepEqual({ ...body.principalInertiaLocalFrame() }, identity);
}

function makeWorld(dt: number) {
  const w = new World(zero);
  w.integrationParameters.numSolverIterations = 16;
  w.integrationParameters.contact_natural_frequency = 480;
  w.integrationParameters.dt = dt;
  return w;
}

function describeBody(id: string, b: RigidBody, frame: Frame = { rotation: identity, translation: zero }): BodyState {
  const inverse = inverseQuaternion(normalizeQuaternion(frame.rotation));
  return { id, mass: b.mass(), inertia: { ...b.principalInertia() }, principalFrame: { ...b.principalInertiaLocalFrame() },
    position: rotate(subtract(b.worldCom(), frame.translation), inverse),
    rotation: normalizeQuaternion(multiplyQuaternions(inverse, b.rotation())),
    velocity: rotate(b.linvel(), inverse), angular: rotate(b.angvel(), inverse), sleeping: b.isSleeping() };
}

function spin(b: BodyState) {
  const q = multiplyQuaternions(b.rotation, b.principalFrame), local = rotate(b.angular, inverseQuaternion(q));
  return rotate({ x: b.inertia.x * local.x, y: b.inertia.y * local.y, z: b.inertia.z * local.z }, q);
}
function momentum(b: BodyState) {
  const linear = scale(b.velocity, b.mass);
  return { linear, angular: add(cross(b.position, linear), spin(b)) };
}
function total(states: BodyState[]) {
  return states.map(momentum).reduce((a, b) => ({ linear: add(a.linear, b.linear), angular: add(a.angular, b.angular) }),
    { linear: zero, angular: zero });
}
function kinetic(states: BodyState[]) {
  return states.reduce((s, b) => s + .5 * b.mass * dotEnergy(b.velocity) + .5 * dot(b.angular, spin(b)), 0);
}

function install(w: World, a: RigidBody, b: RigidBody, p: Vec3, q: Vec3, k: number, c: number) {
  const descriptor = JointData.spring(0, k, c, p, q);
  assert.equal(descriptor.jointType, JointType.Spring);
  assert.equal(descriptor.length, 0); assert.equal(descriptor.stiffness, k); assert.equal(descriptor.damping, c);
  const joint = w.createImpulseJoint(descriptor, a, b, true);
  joint.setContactsEnabled(true);
  // Pinned Rust jointType() classifies only locked_axes. SpringJoint has none and therefore reads back as Generic.
  // Neither this tag nor the authored Spring descriptor proves its force law; the measured coupons below must do that.
  assert.equal(joint.type(), JointType.Generic);
  assert.equal(joint.contactsEnabled(), true);
  const scalar = gyroPrecision === "f64" ? (v: number) => v : Math.fround;
  const nativePoint = (x: Vec3) => ({ x: scalar(x.x), y: scalar(x.y), z: scalar(x.z) });
  assert.deepEqual({ ...joint.anchor1() }, nativePoint(p)); assert.deepEqual({ ...joint.anchor2() }, nativePoint(q));
  const frozen = { type: joint.type(), p: { ...joint.anchor1() }, q: { ...joint.anchor2() } };
  return { joint, descriptor: { authoredType: descriptor.jointType, nativeType: joint.type(), restLength: 0, stiffness: k, damping: c, anchors: [p, q] },
    verify: () => {
      assert(joint.isValid()); assert.equal(joint.contactsEnabled(), true);
      assert.deepEqual({ type: joint.type(), p: { ...joint.anchor1() }, q: { ...joint.anchor2() } }, frozen);
    } };
}

function forceCoupon(mass: number, dt: number, velocity: Vec3, k: number, c: number, separation = 1) {
  const w = makeWorld(dt);
  try {
    const a = w.createRigidBody(RigidBodyDesc.fixed());
    const b = w.createRigidBody(RigidBodyDesc.dynamic().setTranslation(separation, 0, 0)
      .setAdditionalMassProperties(mass, zero, { x: .4 * mass, y: .5 * mass, z: .6 * mass }, identity)
      .setAdditionalSolverIterations(8).setLinvel(velocity.x, velocity.y, velocity.z).setCanSleep(false));
    verifyMassProperties(b, mass);
    const coupling = install(w, a, b, zero, zero, k, c);
    const before = describeBody("dynamic", b), actualDt = w.integrationParameters.dt;
    w.step(); coupling.verify();
    const after = describeBody("dynamic", b);
    const impulse = scale(subtract(after.velocity, before.velocity), mass);
    return { mass, dt, actualDt, separation, velocity, k, c, before, after, impulse,
      force: scale(impulse, 1 / actualDt), descriptor: coupling.descriptor, settings: integrationSettings(w) };
  } finally { w.free(); }
}

const positions = [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
const velocities = [{ x: .1, y: .2, z: .3 }, { x: -.2, y: .1, z: -.1 }];
const angulars = [{ x: .2, y: -.3, z: .1 }, { x: -.1, y: .2, z: .4 }];
const anchorsA = [{ x: .2, y: .4, z: 0 }, { x: -.2, y: -.3, z: .2 }];
const anchorsB = [{ x: -.3, y: -.2, z: .1 }, { x: .2, y: .3, z: -.1 }];
type FreeCase = { id: string; frame: Frame; reverseBodies: boolean; reversePairs: boolean; dt: number; damping: number };
function freeCoupon(spec: FreeCase) {
  const w = makeWorld(spec.dt), bodies = new Map<number, RigidBody>();
  try {
    for (const i of spec.reverseBodies ? [1, 0] : [0, 1]) {
      const mass = [1, 4][i], p = add(rotate(positions[i], spec.frame.rotation), spec.frame.translation);
      const v = rotate(velocities[i], spec.frame.rotation), a = rotate(angulars[i], spec.frame.rotation);
      const body = w.createRigidBody(RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(spec.frame.rotation)
        .setAdditionalMassProperties(mass, zero, { x: .4 * mass, y: .5 * mass, z: .6 * mass }, identity)
        .setLinvel(v.x, v.y, v.z).setAngvel(a).setAdditionalSolverIterations(8).setCanSleep(false));
      verifyMassProperties(body, mass);
      bodies.set(i, body);
    }
    const couplings = (spec.reversePairs ? [1, 0] : [0, 1]).map(i => spec.reverseBodies
      ? install(w, bodies.get(1)!, bodies.get(0)!, anchorsB[i], anchorsA[i], stiffness, spec.damping)
      : install(w, bodies.get(0)!, bodies.get(1)!, anchorsA[i], anchorsB[i], stiffness, spec.damping));
    const snapshot = () => [0, 1].map(i => describeBody(String(i), bodies.get(i)!, spec.frame));
    const energy = (states: BodyState[]) => kinetic(states) + anchorsA.reduce((sum, p, i) => {
      const a = add(states[0].position, rotate(p, states[0].rotation));
      const b = add(states[1].position, rotate(anchorsB[i], states[1].rotation));
      return sum + .5 * stiffness * dotEnergy(subtract(b, a));
    }, 0);
    const initial = snapshot(), initialMomentum = total(initial), initialEnergy = energy(initial);
    let first: BodyState[] = [], last = initial, peakLinearDrift = 0, peakAngularDrift = 0, peakEnergy = initialEnergy;
    const trace = createHash("sha256"), samples = [{ step: 0, states: initial, energy: initialEnergy }];
    const steps = Math.round(.1 / spec.dt), actualDt = w.integrationParameters.dt;
    for (let n = 1; n <= steps; n++) {
      w.step(); couplings.forEach(c => c.verify()); last = snapshot();
      const values = last.flatMap(b => [b.mass, ...Object.values(b.position), ...Object.values(b.rotation),
        ...Object.values(b.velocity), ...Object.values(b.angular), ...Object.values(b.inertia)]);
      assert(values.every(Number.isFinite)); trace.update(Buffer.from(new Float64Array(values).buffer));
      first = n === 1 ? last : first;
      const p = total(last), e = energy(last);
      peakLinearDrift = Math.max(peakLinearDrift, distance(p.linear, initialMomentum.linear));
      peakAngularDrift = Math.max(peakAngularDrift, distance(p.angular, initialMomentum.angular));
      peakEnergy = Math.max(peakEnergy, e);
      if (n % Math.max(1, Math.round(steps / 20)) === 0) samples.push({ step: n, states: last, energy: e });
    }
    return { ...spec, actualDt, steps, initial, first, last, initialMomentum, finalMomentum: total(last),
      initialEnergy, finalEnergy: energy(last), peakEnergy, peakLinearDrift, peakAngularDrift,
      linearLimit: 1e-5 + 5e-5 * magnitude(initialMomentum.linear),
      angularLimit: 2e-4 + 5e-5 * magnitude(initialMomentum.angular),
      settings: integrationSettings(w), descriptors: couplings.map(c => c.descriptor), samples,
      trajectorySha256: trace.digest("hex"), trajectoryEncoding: "ordered IEEE754 float64 native-query values in canonical coordinates" };
  } finally { w.free(); }
}

function compareFree(reference: ReturnType<typeof freeCoupon>, other: ReturnType<typeof freeCoupon>) {
  for (const key of ["first", "last"] as const) for (const [i, state] of other[key].entries()) {
    const original = reference[key][i], prefix = `${other.id}/${key}/${i}`;
    for (const name of ["position", "velocity", "angular"] as const) {
      const limit = (name === "angular" ? 1e-4 : 2e-5) + 1e-4 * magnitude(original[name]);
      check(`${prefix}/${name}`, distance(state[name], original[name]) <= limit, { error: distance(state[name], original[name]), limit });
    }
    const q = Object.values(state.rotation), r = Object.values(original.rotation);
    const chord = Math.min(Math.hypot(...q.map((v, n) => v - r[n])), Math.hypot(...q.map((v, n) => v + r[n])));
    check(`${prefix}/rotation`, chord <= 5e-5, { chord, limit: 5e-5 });
  }
  for (const i of [0, 1]) for (const name of ["linear", "angular"] as const) {
    const a = subtract(momentum(reference.first[i])[name], momentum(reference.initial[i])[name]);
    const b = subtract(momentum(other.first[i])[name], momentum(other.initial[i])[name]);
    const limit = 1e-6 + 1e-4 * magnitude(a);
    check(`${other.id}/impulse/${i}/${name}`, distance(a, b) <= limit, { reference: a, measured: b, error: distance(a, b), limit });
  }
}

it("qualifies native force units, damping, inertia and frame symmetry before any tile seam", async () => {
  await initRapier();
  const paths = ["scripts/reference/probe-spring-semantics.ts", "scripts/reference/probe-spring-semantics.config.ts",
    "scripts/reference/gyroscopic-probe-context.ts", "scripts/reference/probe-gyroscopic-semantics.config.ts",
    "runs/2026-09-28-compliant-seam-plan.md", "runs/2026-09-28-gyroscopic-probe-plan.md",
    "scripts/reference/gyroscopic-f64-profile.json", "runs/2026-09-28-gyroscopic-precision-plan.md",
    "runs/2026-09-28-gyroscopic-refinement-plan.md", "runs/2026-09-28-gyroscopic-principal-frame-plan.md"];
  const context = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes(paths), experimentalRuntime: await experimentalGyroContext() };
  assert.equal(context.validationCodeHash, expectedContext);
  const forces: ReturnType<typeof forceCoupon>[] = [], free: ReturnType<typeof freeCoupon>[] = [];
  let error: string | null = null;
  const save = async (completed: boolean) => {
    assert.equal(await validationCodeHash(), expectedContext); assert.deepEqual(await artifactHashes(paths), context.inputHashes);
    assert.deepEqual(await experimentalGyroContext(), context.experimentalRuntime);
    assert(!completed || (!error && checks.every(c => c.pass)));
    await writeFile(`${output}.tmp`, JSON.stringify({ scope: "Isolated native spring semantics, no tile/source acceptance or calibrated magnetic force claim.",
      experimentalModel: "two-point-compliance-proposal-v1-unit-coupons", context, completed, error,
      parameters: { units, stiffness, damping, freeTimestep }, checks, forces, free }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
  };
  await save(false);
  try {
    for (const dt of [1e-3, 1e-4, 1e-5]) for (const mass of [1, 4]) forces.push(forceCoupon(mass, dt, zero, stiffness, 0));
    const finest = forces.filter(r => r.dt === 1e-5);
    for (const r of finest) {
      // Independent SI oracle: (8/.0254) N/m * .0254 m = 8 N; native force is kg*in/s².
      const expectedForce = -(8 / .0254) * .0254 * (1 / .0254);
      check(`force-units/${r.mass}`, Math.abs(r.force.x / expectedForce - 1) <= .01,
        { expectedForce, measured: r.force.x, relativeError: Math.abs(r.force.x / expectedForce - 1) });
    }
    check("mass-response", Math.abs((finest[0].force.x / finest[0].mass) / (finest[1].force.x / finest[1].mass) / 4 - 1) <= .01,
      finest.map(r => ({ mass: r.mass, acceleration: r.force.x / r.mass })));
    for (const velocity of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]) {
      const r = forceCoupon(1, 1e-5, velocity, 0, damping); forces.push(r);
      if (velocity.x) {
        const expected = -(.225 / .0254) * velocity.x;
        check(`radial-damping/${velocity.x}`, Math.abs(r.force.x / expected - 1) <= .01, { expected, measured: r.force.x });
        check(`dissipative-power/${velocity.x}`, dot(r.force, velocity) <= 0, dot(r.force, velocity));
      } else check("no-tangential-damping", magnitude(r.impulse) <= 1e-6, r.impulse);
    }
    for (const velocity of [zero, { x: .1, y: .2, z: .3 }]) {
      const r = forceCoupon(1, 1e-5, velocity, stiffness, damping, 0); forces.push(r);
      check(`zero-separation/${magnitude(velocity)}`, [...Object.values(r.after.velocity), ...Object.values(r.after.position), ...Object.values(r.after.angular)].every(Number.isFinite), r.after);
    }
    await save(false);
    const angle = .73, s = Math.sin(angle / 2) / Math.sqrt(14);
    const rotation = { x: s, y: 2 * s, z: 3 * s, w: Math.cos(angle / 2) }, translation = { x: 3, y: -2, z: 5 };
    const variants = [
      { id: "identity", frame: { rotation: identity, translation: zero }, reverseBodies: false, reversePairs: false },
      { id: "rotation", frame: { rotation, translation: zero }, reverseBodies: false, reversePairs: false },
      { id: "translation", frame: { rotation: identity, translation }, reverseBodies: false, reversePairs: false },
      { id: "rigid-transform", frame: { rotation, translation }, reverseBodies: false, reversePairs: false },
      { id: "reverse-bodies", frame: { rotation: identity, translation: zero }, reverseBodies: true, reversePairs: false },
      { id: "reverse-pairs", frame: { rotation: identity, translation: zero }, reverseBodies: false, reversePairs: true },
    ];
    for (const c of [0, damping]) {
      let reference: ReturnType<typeof freeCoupon> | undefined;
      for (const variant of variants) {
        const row = freeCoupon({ ...variant, id: `${variant.id}/damping-${c}`, dt: freeTimestep, damping: c }); free.push(row);
        check(`${row.id}/linear-momentum`, row.peakLinearDrift <= row.linearLimit, { drift: row.peakLinearDrift, limit: row.linearLimit });
        check(`${row.id}/angular-momentum-with-spin`, row.peakAngularDrift <= row.angularLimit, { drift: row.peakAngularDrift, limit: row.angularLimit });
        check(`${row.id}/energy`, row.peakEnergy <= 1.01 * row.initialEnergy, { initial: row.initialEnergy, peak: row.peakEnergy, final: row.finalEnergy });
        if (reference) compareFree(reference, row); else reference = row;
        await save(false);
      }
    }
    const coarse = freeCoupon({ ...variants[0], id: "conservative-coarse", dt: 1e-3, damping: 0 }); free.push(coarse);
    const fine = free[0];
    check("conservative-energy-refinement", Math.abs(fine.finalEnergy / fine.initialEnergy - 1) < Math.abs(coarse.finalEnergy / coarse.initialEnergy - 1),
      { coarse: coarse.finalEnergy / coarse.initialEnergy - 1, fine: fine.finalEnergy / fine.initialEnergy - 1 });
    assert.equal(forces.length, 11); assert.equal(free.length, 13);
  } catch (e) { error = e instanceof Error ? e.stack ?? e.message : String(e); }
  await save(false);
  assert.equal(error, null); assert(checks.every(c => c.pass), JSON.stringify(checks.filter(c => !c.pass)));
  await save(true);
  console.log(JSON.stringify({ forceRows: forces.length, freeRows: free.length, checks: checks.length, passed: true }));
}, 120000);
