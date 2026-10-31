import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, rename, writeFile } from "node:fs/promises";
import { it } from "vitest";
import RAPIER, { World, ColliderDesc, RigidBodyDesc } from "../../lib/engine/physics-backend";
import { tilePrismPoints } from "../../lib/engine/build";
import { createEngineWorld, initRapier } from "../../lib/engine/rapier-world";
import { PHYSICS_MODEL_VERSION, MAX_COLLISION_TIMESTEP_SECONDS } from "../../lib/engine/constants";
import { PHYSICS_BACKEND_ID } from "../../lib/engine/backend-identity";
import { basisFromEuler } from "../../lib/magnetic-tiles/edge-attachment";
import { tilePrismVertices } from "../../lib/magnetic-tiles/prism-geometry";
import { square, assemble, v } from "../../lib/replication/geometry";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { referenceFrames, runFrameContact, triangleShapes, type FrameContactTrial } from "../../tests/fixtures/contact-frames";
import { experimentalGyroContext } from "./gyroscopic-probe-context";

const output = process.env.MAGNATILES_TILE_CONTACT_REPORT ?? "/tmp/magnatiles-gyroscopic-tile-contact.json";
const inputs = ["scripts/reference/gyroscopic-tile-probe.config.ts", "scripts/reference/probe-gyroscopic-tile-contact.ts",
  "scripts/reference/gyroscopic-probe-context.ts", "scripts/reference/gyroscopic-f64-profile.json", "scripts/reference/probe-gyroscopic-semantics.config.ts",
  "runs/2026-09-28-gyroscopic-tile-contact-plan.md", "tests/fixtures/contact-frames.ts",
  "tests/triangle-contact.test.ts", "tests/rectangular-contact.test.ts", "tests/polyhedral-contact.test.ts"];
const production = "b354b6edcbcddb7248137e9888e97badfcb7eb2156f742760783587be5dbcf1a";

it("experimental tile backend retains full coordinates, gyro flags and state/object isolation", async () => {
  await initRapier();
  assert.equal(MAX_COLLISION_TIMESTEP_SECONDS, 2.5e-5);
  assert(PHYSICS_BACKEND_ID.startsWith("experimental-f64-gyro-principal1-"));
  const tile = { ...square("p", v(-1.5, 4, -1.5), v(3, 0, 0), v(0, 0, 3), "red", 1, "fixture"),
    shape: "equilateral-triangle" as const, basis: basisFromEuler(.31, -.73, 1.17) };
  const points = tilePrismPoints(tile), expected = tilePrismVertices(tile).flatMap(p => [p.x - tile.position.x, p.y - tile.position.y, p.z - tile.position.z]);
  assert.equal(points.BYTES_PER_ELEMENT, 8); assert.deepEqual(Array.from(points), expected);
  assert(expected.some(n => n !== Math.fround(n)), "Fixture must expose accidental f32 quantization");
  const build = assemble("precision", "Precision control", [tile], "tower");
  const engine = await createEngineWorld(build, { drop: false, floorY: 0 });
  try {
    const record = engine.bodies.get("p")!;
    assert.equal((record.body as typeof record.body & { gyroscopicForcesEnabled(): boolean }).gyroscopicForcesEnabled(), true);
    const vertices = record.body.collider(0).vertices(); assert.equal(vertices.BYTES_PER_ELEMENT, 8);
    for (let i = 0; i < vertices.length; i += 3) assert(Math.min(...Array.from({ length: expected.length / 3 }, (_, j) =>
      Math.hypot(vertices[i] - expected[j * 3], vertices[i + 1] - expected[j * 3 + 1], vertices[i + 2] - expected[j * 3 + 2]))) < 1e-12);
    const oldBackend = (await readFile("lib/engine/backend-identity.ts", "utf8")).match(/PHYSICS_BACKEND_ID = "([^"]+)"/)![1];
    const stale = { ...engine.snapshot(), physicsModel: `rigid-contact-v8-solid-sweep-contact480-collision1920-${oldBackend}` };
    await assert.rejects(createEngineWorld(build, { drop: false, floorY: 0, state: stale }), /current physics model/);
    const native = createRequire(import.meta.url)("@magnatiles/rapier-contact");
    await native.init(); assert.notEqual(native.RigidBodyDesc, RigidBodyDesc);
    assert.throws(() => engine.world.createRigidBody(native.RigidBodyDesc.dynamic()), /descriptor/);
    assert.throws(() => engine.world.createCollider(native.ColliderDesc.cuboid(1, 1, 1)), /descriptor/);
    const other = new World(v(0, 0, 0));
    try { const foreign = other.createRigidBody(RigidBodyDesc.dynamic());
      assert.throws(() => engine.world.createCollider(ColliderDesc.cuboid(1, 1, 1), foreign), /another/);
      other.step();
    } finally { other.free(); }
    assert.throws(() => engine.world.takeSnapshot(), /versioned/);
    engine.world.step(); assert.equal(RAPIER.World, World);
  } finally { engine.dispose(); }
});

it("experimental full-coordinate tile contacts cover all198 original frame rows", async () => {
  const context = { production: await validationCodeHash(), inputHashes: await artifactHashes(inputs), experimentalRuntime: await experimentalGyroContext(), physicsModel: PHYSICS_MODEL_VERSION };
  assert.equal(context.production, production);
  const rates = [40000, 80000], specs = triangleShapes.flatMap(shape => referenceFrames.flatMap(frame => [
    ...[0, .37].flatMap(yaw => [0, 17, 53].flatMap(seed => rates.map(hz => ({ shape, frame, yaw, seed, hz })))),
    ...([{ seed: 29, yaws: [-.61, 1.13] }, { seed: 71, yaws: [.23, .89, -1.47] }]).flatMap(({ seed, yaws }) =>
      yaws.flatMap(yaw => rates.map(hz => ({ shape, frame, yaw, seed, hz })))),
  ]));
  assert.equal(specs.length, 198);
  const rows: ({ spec: typeof specs[number]; trial?: FrameContactTrial; error?: string })[] = [];
  const save = async (completed: boolean) => {
    assert.equal(await validationCodeHash(), production); assert.deepEqual(await artifactHashes(inputs), context.inputHashes);
    assert.deepEqual(await experimentalGyroContext(), context.experimentalRuntime);
    assert(!completed || (rows.length === specs.length && rows.every(r => r.trial?.passed && !r.error)));
    await writeFile(`${output}.tmp`, JSON.stringify({ scope: "Experimental full-coordinate contact matrix; no compliant seam or source acceptance", context, completed, expectedRows: specs.length, rows }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
  };
  await save(false);
  for (const spec of specs) {
    try { rows.push({ spec, trial: await runFrameContact(spec.shape, spec.frame, spec.yaw, spec.seed, spec.hz) }); }
    catch (error) { rows.push({ spec, error: error instanceof Error ? error.stack : String(error) }); }
    await save(false);
    if (rows.length % 18 === 0) console.log(JSON.stringify({ frameRows: rows.length, passed: rows.filter(r => r.trial?.passed).length }));
  }
  assert(rows.every(r => r.trial?.passed && !r.error), JSON.stringify(rows.filter(r => !r.trial?.passed || r.error)));
  await save(true);
}, 600000);
