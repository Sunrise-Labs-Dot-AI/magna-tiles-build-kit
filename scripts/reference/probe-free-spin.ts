/** No joints, contacts, gravity or applied forces: isolate the failed spring coupon's spin conservation. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { World, RigidBodyDesc, integrationSettings } from "../../lib/engine/physics-backend";
import { initRapier } from "../../lib/engine/rapier-world";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { configureExperimentalGyro, experimentalGyroContext } from "./gyroscopic-probe-context";

type Vector = { x: number; y: number; z: number };
type Quaternion = Vector & { w: number };
const zero = { x: 0, y: 0, z: 0 }, identity = { ...zero, w: 1 };
const expectedContext = "b354b6edcbcddb7248137e9888e97badfcb7eb2156f742760783587be5dbcf1a";
// Independent quaternion formula, deliberately not the engine's math helper used by the spring coupon.
function rotate(v: Vector, q: Quaternion): Vector {
  const t = { x: 2 * (q.y * v.z - q.z * v.y), y: 2 * (q.z * v.x - q.x * v.z), z: 2 * (q.x * v.y - q.y * v.x) };
  return { x: v.x + q.w * t.x + q.y * t.z - q.z * t.y,
    y: v.y + q.w * t.y + q.z * t.x - q.x * t.z,
    z: v.z + q.w * t.z + q.x * t.y - q.y * t.x };
}
function product(a: Quaternion, b: Quaternion): Quaternion {
  return { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
}
function row(inertia: Vector, dt: number, principalFrame = identity) {
  const world = new World(zero);
  try {
    world.integrationParameters.dt = dt;
    world.integrationParameters.numSolverIterations = 16;
    // Counter-rotate the body so changing its inertia coordinate frame preserves the same initial world inertia.
    const bodyFrame = { x: -principalFrame.x, y: -principalFrame.y, z: -principalFrame.z, w: principalFrame.w };
    const body = world.createRigidBody(RigidBodyDesc.dynamic().setAdditionalMassProperties(1, zero, inertia, principalFrame).setRotation(bodyFrame)
      .setAngvel({ x: .2, y: -.3, z: .1 }).setCanSleep(false).setAdditionalSolverIterations(8));
    configureExperimentalGyro(body);
    body.recomputeMassPropertiesFromColliders();
    assert.equal(body.mass(), 1);
    const queriedFrame = { ...body.principalInertiaLocalFrame() };
    assert(Math.hypot(...["x", "y", "z", "w"].map(k => queriedFrame[k as keyof Quaternion] - principalFrame[k as keyof Quaternion])) < 1e-6);
    const queriedInertia = { ...body.principalInertia() };
    function snapshot() {
      const raw = body.rotation(), norm = Math.hypot(raw.x, raw.y, raw.z, raw.w);
      const q = { x: raw.x / norm, y: raw.y / norm, z: raw.z / norm, w: raw.w / norm };
      const inertiaRotation = product(q, queriedFrame);
      const angular = { ...body.angvel() }, local = rotate(angular, { x: -inertiaRotation.x, y: -inertiaRotation.y, z: -inertiaRotation.z, w: inertiaRotation.w });
      const spin = rotate({ x: queriedInertia.x * local.x, y: queriedInertia.y * local.y, z: queriedInertia.z * local.z }, inertiaRotation);
      return { rotation: q, angular, spin, position: { ...body.worldCom() }, velocity: { ...body.linvel() } };
    }
    const initial = snapshot(), steps = Math.round(.1 / dt);
    let peakDrift = 0, final = initial;
    for (let i = 0; i < steps; i++) {
      world.step(); final = snapshot();
      assert(Object.values(final.spin).every(Number.isFinite));
      peakDrift = Math.max(peakDrift, Math.hypot(final.spin.x - initial.spin.x, final.spin.y - initial.spin.y, final.spin.z - initial.spin.z));
    }
    const limit = 2e-4 + 5e-5 * Math.hypot(initial.spin.x, initial.spin.y, initial.spin.z);
    return { inertia, principalFrame, queriedFrame, bodyFrame, queriedInertia, dt, steps, settings: integrationSettings(world), initial, final, peakDrift, limit, conservesSpin: peakDrift <= limit };
  } finally { world.free(); }
}

export async function runFreeSpinProbe() {
  const paths = ["scripts/reference/probe-free-spin.ts", "scripts/reference/probe-spring-semantics.ts",
    "scripts/reference/gyroscopic-probe-context.ts", "scripts/reference/probe-gyroscopic-semantics.config.ts",
    "scripts/reference/probe-gyroscopic-free-spin.ts", "runs/2026-09-28-gyroscopic-probe-plan.md",
    "scripts/reference/gyroscopic-f64-profile.json", "runs/2026-09-28-gyroscopic-precision-plan.md",
    "runs/2026-09-28-gyroscopic-principal-frame-plan.md"];
  const context = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes(paths), experimentalRuntime: await experimentalGyroContext() };
  assert.equal(context.validationCodeHash, expectedContext);
  await initRapier();
  const rows = [1e-3, 1e-4].flatMap(dt => [{ x: .4, y: .5, z: .6 }, { x: .5, y: .5, z: .5 }].map(inertia => row(inertia, dt)));
  if (process.env.MAGNATILES_SPIN_FRAME_CONTROL === "1") {
    const s = Math.sin(.73 / 2) / Math.sqrt(14), frame = { x: s, y: 2 * s, z: 3 * s, w: Math.cos(.73 / 2) };
    rows.push(...[1e-3, 1e-4].map(dt => row({ x: .4, y: .5, z: .6 }, dt, frame)));
  }
  const finalContext = { validationCodeHash: await validationCodeHash(), inputHashes: await artifactHashes(paths), experimentalRuntime: await experimentalGyroContext() };
  assert.deepEqual(finalContext, context);
  const report = { scope: "Torque-free single-body diagnostic, no springs or tile/source acceptance. Completion means the diagnostic ran, not physics passed.",
    context, finalContext, completed: true, rows };
  await writeFile(process.env.MAGNATILES_SPIN_REPORT ?? "runs/diagnostics/2026-09-28-free-spin.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(rows.map(r => ({ dt: r.dt, inertia: r.inertia, drift: r.peakDrift, limit: r.limit, conservesSpin: r.conservesSpin }))));
}
if (!process.env.VITEST) runFreeSpinProbe().catch(error => { console.error(error); process.exitCode = 1; });
