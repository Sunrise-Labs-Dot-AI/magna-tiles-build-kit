/** Exact constant-velocity oracle. No springs, gravity, contact, torque or damping. */
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node diagnostic deliberately loads the built CJS/WASM artifact. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const precision = process.env.MAGNATILES_GYRO_PRECISION ?? 'f32';
assert(precision === 'f32' || precision === 'f64');
const root = '/tmp/magnatiles-gyroscopic-probe' + (precision === 'f64' ? '-f64' : '');
const bundle = path.join(root, 'source/rapier-compat/builds/3d/pkg/rapier.cjs');
const R = require(bundle);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const proof = JSON.parse(await fs.readFile(path.join(root, 'build-proof.json'), 'utf8'));
  const runtimeHash = sha(await fs.readFile(bundle));
  assert.equal(runtimeHash, proof.artifacts['rapier.cjs']);
  await R.init();
  const rows = [];
  for (const dt of [1e-3, 1e-4, 1e-5]) for (const origin of [{ x: 0, y: 0, z: 0 }, { x: 3, y: -2, z: 5 }]) {
    const world = new R.World({ x: 0, y: 0, z: 0 });
    try {
      world.integrationParameters.dt = dt;
      world.integrationParameters.numSolverIterations = 16;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z)
        .setAdditionalMassProperties(1, { x: 0, y: 0, z: 0 }, { x: .4, y: .5, z: .6 }, { x: 0, y: 0, z: 0, w: 1 })
        .setLinvel(.1, .2, .3).setAdditionalSolverIterations(8).setCanSleep(false));
      body.recomputeMassPropertiesFromColliders(); body.enableGyroscopicForces(true);
      assert(body.gyroscopicForcesEnabled()); assert.equal(body.mass(), 1);
      const initial = { position: { ...body.translation() }, velocity: { ...body.linvel() } };
      const actualDt = world.integrationParameters.dt, steps = Math.round(.1 / dt), duration = steps * actualDt;
      let peakError = 0;
      for (let i = 1; i <= steps; i++) {
        world.step();
        const p = body.translation();
        const err = Math.hypot(...['x', 'y', 'z'].map(k => p[k] - initial.position[k] - initial.velocity[k] * i * actualDt));
        assert(Number.isFinite(err)); peakError = Math.max(peakError, err);
      }
      const final = { position: { ...body.translation() }, velocity: { ...body.linvel() } };
      assert.deepEqual(final.velocity, initial.velocity);
      const expectedLocal = Object.fromEntries(['x', 'y', 'z'].map(k => [k, initial.velocity[k] * duration]));
      const actualLocal = Object.fromEntries(['x', 'y', 'z'].map(k => [k, final.position[k] - initial.position[k]]));
      const limit = 2e-5 + 1e-4 * Math.hypot(...Object.values(expectedLocal));
      rows.push({ dt, actualDt, steps, duration, origin, initial, final, expectedLocal, actualLocal,
        peakError, limit, withinOriginalPositionBound: peakError <= limit });
    } finally { world.free(); }
  }
  assert.equal(sha(await fs.readFile(bundle)), runtimeHash);
  const report = { scope: 'Constant-velocity numerical diagnostic. Completion means all rows ran, not acceptance.',
    completed: true, precision, runtimeHash, scriptSha256: sha(await fs.readFile(__filename)), rows };
  await fs.writeFile('runs/diagnostics/2026-09-28-gyroscopic-constant-velocity' + (precision === 'f64' ? '-f64' : '') + '.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(rows.map(r => ({ dt: r.dt, origin: r.origin, peakError: r.peakError, limit: r.limit, pass: r.withinOriginalPositionBound }))));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
