import assert from "node:assert/strict";
import Original from "@dimforge/rapier3d-compat";
import { physicalSpecForTile } from "../../lib/engine/build";
import { gravityVector } from "../../lib/engine/physics-model";
import { currentTilePose } from "../../lib/engine/rapier-world";
import { tileQuaternion } from "../../lib/magnetic-tiles/swept-prisms";
import type { TileInstance } from "../../lib/magnetic-tiles/types";
import { exactPrismDepth } from "../../tests/fixtures/contact-frames";
import seed from "./gyroscopic-negative-seed.json";

/** Historical defect reproduction from captured production inputs. The
 * candidate runtime must not compute or normalize the control's starting pose. */
export async function unpatchedContactControl() {
  await Original.init();
  const world = new Original.World(gravityVector());
  try {
    world.integrationParameters.dt = seed.input.dt;
    world.integrationParameters.numSolverIterations = 16;
    world.integrationParameters.contact_natural_frequency = 480;
    const records = seed.input.records.map(input => {
      const tile = input.tile as TileInstance, p = input.sourceTranslation;
      const body = world.createRigidBody((tile.id === "roof" ? Original.RigidBodyDesc.fixed() : Original.RigidBodyDesc.dynamic())
        .setTranslation(p.x, p.y, p.z).setRotation(input.sourceRotation).setCcdEnabled(true));
      const spec = physicalSpecForTile(tile);
      const desc = tile.shape === "small-square"
        ? Original.ColliderDesc.cuboid(spec.width / 2, spec.height / 2, spec.thickness / 2).setRotation(tileQuaternion(tile))
        : Original.ColliderDesc.convexHull(new Float32Array(input.inputPoints))!;
      const collider = world.createCollider(desc.setMass(spec.mass).setFriction(.82).setRestitution(.02), body);
      assert.deepEqual(body.translation(), input.translation);
      assert.deepEqual(body.rotation(), input.rotation);
      assert.deepEqual(collider.translation(), input.colliderTranslation);
      assert.deepEqual(collider.rotation(), input.colliderRotation);
      assert.equal(collider.shapeType(), input.shape);
      if (input.points) assert.deepEqual(Array.from(collider.vertices()), input.points);
      return { tile, body, collider };
    });
    for (const model of seed.input.joints) {
      const a = records.find(r => r.tile.id === model.fromTileId)!.body;
      const b = records.find(r => r.tile.id === model.toTileId)!.body;
      // This captured fixture has one seam represented by two spherical joints.
      assert(model.secondAnchors);
      world.createImpulseJoint(Original.JointData.spherical(model.fromLocalAnchor, model.toLocalAnchor), a, b, true).setContactsEnabled(true);
      world.createImpulseJoint(Original.JointData.spherical(model.secondAnchors.from, model.secondAnchors.to), a, b, true).setContactsEnabled(true);
    }
    let contacts = 0, depthExcess = 0;
    for (let n = 0; n < 1 / (15 * seed.input.dt); n++) {
      const before = records.map(r => currentTilePose(r.tile, r.body.translation(), r.body.rotation(), 0));
      const depth = Math.max(0, exactPrismDepth(before[0], before[1]));
      world.step();
      world.contactPair(records[0].collider, records[1].collider, manifold => {
        contacts += manifold.numContacts();
        for (let i = 0; i < manifold.numContacts(); i++) depthExcess = Math.max(depthExcess, -manifold.contactDist(i) - depth);
      });
    }
    // Exact replay checks against the observed production-baseline outcome.
    assert.equal(contacts, 764);
    assert.equal(depthExcess, 3.000000476837158);
    return { contacts, depthExcess };
  } finally { world.free(); }
}
