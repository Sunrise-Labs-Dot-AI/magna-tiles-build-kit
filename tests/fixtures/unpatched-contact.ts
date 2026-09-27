// Explicit regression control. No object from this backend crosses into the
// application's patched World; only ordinary geometry and numeric results do.
import Original from "@dimforge/rapier3d-compat";
import { physicalSpecForTile, tilePrismPoints } from "@/lib/engine/build";
import { gravityVector } from "@/lib/engine/physics-model";
import { currentTilePose } from "@/lib/engine/rapier-world";
import { tileQuaternion } from "@/lib/magnetic-tiles/swept-prisms";
import { exactPrismDepth, frameContactWorld } from "./contact-frames";
import { square, v } from "@/lib/replication/geometry";

/** The upstream GJK path can add an origin placeholder to correct clipped
 * corner contacts. No objects from this control enter the selected backend. */
export async function unpatchedCornerControl() {
  await Original.init();
  const world = new Original.World(v(0,0,0));
  try {
    const a = square("a",v(-1.5,-1.5,0),v(3,0,0),v(0,3,0),"red",1,"control");
    const bodies = [v(0,0,0),v(3,3,.179)].map(p => world.createRigidBody(Original.RigidBodyDesc.dynamic().lockTranslations().lockRotations().setTranslation(p.x,p.y,p.z)));
    const colliders = bodies.map(body => world.createCollider(Original.ColliderDesc.convexHull(tilePrismPoints(a))!,body));
    world.step(); bodies[1].setTranslation(v(3,3,.18),true); world.step();
    let contacts = 0, outside = 0;
    world.contactPair(colliders[0],colliders[1],manifold => {
      contacts += manifold.numContacts();
      for (let i=0; i<manifold.numContacts(); i++) for (const p of [manifold.localContactPoint1(i)!,manifold.localContactPoint2(i)!])
        outside = Math.max(outside,Math.abs(p.x)-1.5,Math.abs(p.y)-1.5,Math.abs(p.z)-.09);
    });
    return {contacts,outside};
  } finally { world.free(); }
}

export async function unpatchedContactControl() {
  const { engine } = await frameContactWorld("right-triangle","identity",0);
  await Original.init();
  const world = new Original.World(gravityVector());
  try {
    world.integrationParameters.dt = 1/960;
    world.integrationParameters.numSolverIterations = 16;
    world.integrationParameters.contact_natural_frequency = 120;
    const records = [...engine.bodies.values()].map(r => {
      const p = r.body.translation();
      const body = world.createRigidBody((r.tile.id === "roof" ? Original.RigidBodyDesc.fixed() : Original.RigidBodyDesc.dynamic())
        .setTranslation(p.x,p.y,p.z).setRotation(r.body.rotation()).setCcdEnabled(true));
      const spec = physicalSpecForTile(r.tile);
      const desc = r.tile.shape === "small-square"
        ? Original.ColliderDesc.cuboid(spec.width/2,spec.height/2,spec.thickness/2).setRotation(tileQuaternion(r.tile))
        : Original.ColliderDesc.convexHull(tilePrismPoints(r.tile))!;
      const collider = world.createCollider(desc.setMass(spec.mass).setFriction(.82).setRestitution(.02),body);
      return { tile:r.tile,body,collider };
    });
    for (const { model } of engine.joints) {
      const a = records.find(r => r.tile.id === model.fromTileId)!.body;
      const b = records.find(r => r.tile.id === model.toTileId)!.body;
      const desc = model.secondAnchors ? Original.JointData.spherical(model.fromLocalAnchor,model.toLocalAnchor)
        : Original.JointData.revolute(model.fromLocalAnchor,model.toLocalAnchor,model.axis);
      world.createImpulseJoint(desc,a,b,true).setContactsEnabled(true);
      if (model.secondAnchors) world.createImpulseJoint(Original.JointData.spherical(model.secondAnchors.from,model.secondAnchors.to),a,b,true).setContactsEnabled(true);
    }
    let contacts = 0,depthExcess = 0;
    for (let n=0;n<64;n++) {
      const before = records.map(r => currentTilePose(r.tile,r.body.translation(),r.body.rotation(),0));
      const depth = Math.max(0,exactPrismDepth(before[0],before[1]));
      world.step();
      world.contactPair(records[0].collider,records[1].collider,m => {
        contacts += m.numContacts();
        for (let i=0;i<m.numContacts();i++) depthExcess = Math.max(depthExcess,-m.contactDist(i)-depth);
      });
    }
    return { contacts,depthExcess };
  } finally { world.free(); engine.dispose(); }
}
