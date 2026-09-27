import { beforeAll, describe, expect, it } from "vitest";
import RAPIER, { ActiveCollisionTypes, ColliderDesc, RigidBodyDesc, type Collider, type TempContactManifold } from "@/lib/engine/physics-backend";
import { physicalSpecForTile, tilePrismPoints } from "@/lib/engine/build";
import { basisToQuaternion, cross, dot, magnitude, normalize, quaternionToBasis, scale, subtract, transformLocal } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal, tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { TileBasis, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { square, v } from "@/lib/replication/geometry";
import { exactPrismDepth } from "./fixtures/contact-frames";
import { unpatchedCornerControl } from "./fixtures/unpatched-contact";

const shapes = ["small-square","right-triangle","equilateral-triangle","isosceles-triangle","large-square"] as const;
const tolerance = .0001;
beforeAll(() => RAPIER.init());

function panel(id: string, shape: typeof shapes[number], position: Vec3, basis: TileBasis): TileInstance {
  return {...square(id,v(-1.5,-1.5,0),v(3,0,0),v(0,3,0),"red",1,"fixture"),shape,position,basis};
}

function outsideDistance(point: Vec3, tile: TileInstance): number {
  const vertices = tilePrismVertices(tile), normal = tileNormal(tile), polygon = tileWorldVertices(tile);
  const axes = [normal,scale(normal,-1),...polygon.map((p,i) => normalize(cross(subtract(polygon[(i+1)%polygon.length],p),normal)))];
  return Math.max(...axes.map(axis => dot(point,axis)-Math.max(...vertices.map(p => dot(p,axis)))));
}

/** Check every emitted witness against finite source geometry, even when a
 * shallow separation remains in the contact cache/prediction margin. */
function contactErrors(manifold: TempContactManifold, a: TileInstance, b: TileInstance, ca: Collider, cb: Collider, depth: number) {
  const normal = manifold.normal();
  const gap = Math.min(...tilePrismVertices(b).map(p => dot(p,normal)))-Math.max(...tilePrismVertices(a).map(p => dot(p,normal)));
  let depthExcess = 0, outside = 0, algebra = 0;
  for (let i=0; i<manifold.numContacts(); i++) {
    const p = transformLocal(manifold.localContactPoint1(i)!,ca.translation(),quaternionToBasis(ca.rotation()));
    const q = transformLocal(manifold.localContactPoint2(i)!,cb.translation(),quaternionToBasis(cb.rotation()));
    depthExcess = Math.max(depthExcess,-manifold.contactDist(i)-depth);
    outside = Math.max(outside,outsideDistance(p,a),outsideDistance(q,b));
    algebra = Math.max(algebra,Math.abs(dot(subtract(q,p),normal)-manifold.contactDist(i)));
  }
  return {depthExcess,outside,algebra,normalError: manifold.numContacts() ? Math.max(0,-depth-gap,Math.abs(magnitude(normal)-1)) : 0};
}

function checkPair(a: TileInstance, b: TileInstance, reverse: boolean, requireContact = false) {
  const world = new RAPIER.World(v(0,0,0)), input = reverse ? [b,a] : [a,b];
  try {
    const colliders = input.map(tile => {
      const body = world.createRigidBody(RigidBodyDesc.dynamic().lockTranslations().lockRotations().setTranslation(tile.position.x,tile.position.y,tile.position.z));
      const spec = physicalSpecForTile(tile);
      const desc = tile.shape.endsWith("square")
        ? ColliderDesc.cuboid(spec.width/2,spec.height/2,spec.thickness/2).setRotation(basisToQuaternion(tile.basis!))
        : ColliderDesc.convexHull(tilePrismPoints(tile))!;
      return world.createCollider(desc.setActiveCollisionTypes(ActiveCollisionTypes.ALL),body);
    });
    world.step();
    const depth = exactPrismDepth(a,b);
    let contacts = 0;
    world.contactPair(colliders[0],colliders[1],(manifold,flipped) => {
      const i = flipped ? 1 : 0, j = flipped ? 0 : 1;
      contacts += manifold.numContacts();
      const errors = contactErrors(manifold,input[i],input[j],colliders[i],colliders[j],depth);
      for (const value of Object.values(errors)) expect(value,JSON.stringify({a,b,reverse,depth,errors})).toBeLessThan(tolerance);
    });
    if (requireContact || depth >= tolerance) expect(contacts,JSON.stringify({a,b,reverse,depth})).toBeGreaterThan(0);
  } finally { world.free(); }
}

describe("finite polyhedral contacts and cache", () => {
  it("detects the original auxiliary witness outside a finite corner", async () => {
    const result = await unpatchedCornerControl();
    expect(result.contacts).toBeGreaterThan(0);
    expect(result.outside).toBeGreaterThan(1);
  });
  it("retains contacts at exact touching faces and 0.00001 inch penetration for every catalog shape pair", () => {
    for (const first of shapes) for (const second of shapes) for (const depth of [0,.00001]) {
      const a = panel("a",first,v(0,0,0),basisFromEuler());
      const b = panel("b",second,v(0,0,.18-depth),basisFromEuler());
      expect(exactPrismDepth(a,b)).toBeCloseTo(depth,8);
      checkPair(a,b,false,true); checkPair(a,b,true,true);
    }
  });
  it("bounds 1200 reproducible primitive/hull pairs in both insertion orders", () => {
    let seed = 17391;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32; };
    const orientation = () => basisFromEuler(random()*Math.PI*2,random()*Math.PI*2,random()*Math.PI*2);
    for (let i=0; i<1200; i++) {
      const a = panel("a",shapes[i%shapes.length],v(0,0,0),orientation());
      const b = panel("b",shapes[Math.floor(i/shapes.length)%shapes.length],v((random()-.5)*4,(random()-.5)*4,(random()-.5)*4),orientation());
      checkPair(a,b,false); checkPair(a,b,true);
    }
  });

  it("bounds 360 parallel and near-parallel pairs, including containment and shallow separation", () => {
    const angles = [0,1e-8,1e-6,1e-4,Math.PI-1e-8,Math.PI], depths = [-.003,-.001,0,.001,.03,.15];
    for (let i=0; i<360; i++) {
      const a = panel("a",shapes[i%shapes.length],v(0,0,0),basisFromEuler());
      const b = panel("b",shapes[Math.floor(i/shapes.length)%shapes.length],v(.017,.023,.18-depths[Math.floor(i/angles.length)%depths.length]),basisFromEuler(angles[i%angles.length],0,0));
      checkPair(a,b,false); checkPair(a,b,true);
    }
  });

  it("keeps cached face, edge, corner and containment witnesses valid across 52 small movements", () => {
    const targets = [v(.2,.3,.18),v(3,0,.18),v(3,3,.18),v(0,0,0)];
    for (const reverse of [false,true]) for (const angle of [0,1e-7]) for (const target of targets) {
      const a = panel("a","small-square",v(0,0,0),basisFromEuler());
      const b = panel("b","small-square",{...target},basisFromEuler(angle,0,0));
      const input = reverse ? [b,a] : [a,b], world = new RAPIER.World(v(0,0,0));
      try {
        const bodies = input.map(t => world.createRigidBody(RigidBodyDesc.dynamic().lockTranslations().lockRotations().setTranslation(t.position.x,t.position.y,t.position.z)));
        // Use hull/hull here so the corrected cache path is exercised even for squares.
        const colliders = input.map((t,i) => world.createCollider(ColliderDesc.convexHull(tilePrismPoints(t))!,bodies[i]));
        for (let step=0; step<52; step++) {
          b.position = {...target,z:target.z+(step === 0 ? -.001 : (step-1)*.00001)};
          bodies[reverse ? 0 : 1].setTranslation(b.position,true);
          world.step();
          let contacts = 0;
          world.contactPair(colliders[0],colliders[1],(manifold,flipped) => {
            const i = flipped ? 1 : 0, j = flipped ? 0 : 1;
            contacts += manifold.numContacts();
            const errors = contactErrors(manifold,input[i],input[j],colliders[i],colliders[j],exactPrismDepth(a,b));
            for (const value of Object.values(errors)) expect(value,JSON.stringify({target,angle,reverse,step,errors})).toBeLessThan(tolerance);
          });
          if (step <= 1) expect(contacts,JSON.stringify({target,angle,reverse,step})).toBeGreaterThan(0);
        }
      } finally { world.free(); }
    }
  });
});
