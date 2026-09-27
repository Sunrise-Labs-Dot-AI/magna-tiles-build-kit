import { describe, expect, it, vi } from "vitest";
import RAPIER, { ColliderDesc, RigidBodyDesc, RigidBodyType, ShapeType } from "@dimforge/rapier3d-compat";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { physicalSpecForTile, tilePrismPoints } from "@/lib/engine/build";
import { basisToQuaternion, cross, distance, dot, magnitude, normalize, quaternionToBasis, transformLocal } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import { supportSnapshot } from "@/lib/replication/support";
import { assemble } from "@/lib/replication/geometry";
import type { TileInstance } from "@/lib/magnetic-tiles/types";
import { flatContactFixture, unsupportedHingeFixture } from "./fixtures/rigid-contact";

/** Exact signed SAT for these boxes. No production overlap threshold or axis
 * deduplication: all 3+3+9 candidate separating axes are considered. */
function signedBoxDepth(a: TileInstance,b: TileInstance) {
  const aa=Object.values(a.basis!), bb=Object.values(b.basis!);
  const av=tilePrismVertices(a),bv=tilePrismVertices(b);
  return Math.min(...[...aa,...bb,...aa.flatMap(x=>bb.map(y=>cross(x,y)))].filter(axis=>magnitude(axis)>1e-10).map(axis=>{
    const n=normalize(axis), p=av.map(v=>dot(v,n)), q=bv.map(v=>dot(v,n));
    return Math.min(Math.max(...p),Math.max(...q))-Math.max(Math.min(...p),Math.min(...q));
  }));
}

describe("exact rectangular collision primitives", () => {
  it.each(["small-square","large-square","xl-square"] as const)("matches corners, mass and inertia for %s in noncommuting frames", async shape => {
    for (const eulerOnly of [false,true]) {
      const tile={...flatContactFixture().tiles[0],shape,position:{x:4,y:20,z:-3},rotation:{x:.3,y:-.7,z:1.1},basis:eulerOnly?undefined:basisFromEuler(.3,-.7,1.1)};
      const build=assemble("rectangle","Rectangle",[tile],"tower"), engine=await createEngineWorld(build,{drop:false,floorY:0});
      const control=new RAPIER.World({x:0,y:0,z:0});
      try {
        const r=engine.bodies.get(tile.id)!,body=r.body,collider=body.collider(0);
        expect(collider.shapeType()).toBe(ShapeType.Cuboid);
        body.setRotation(basisToQuaternion(basisFromEuler(-.8,.2,.6)),true);
        engine.world.propagateModifiedBodyPositionsToColliders();
        const actual=supportSnapshot(build,engine).tiles[0], expected=tilePrismVertices(actual), half=collider.halfExtents();
        const corners=[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>transformLocal({x:x*half.x,y:y*half.y,z:z*half.z},collider.translation(),quaternionToBasis(collider.rotation())))));
        for (const corner of corners) expect(Math.min(...expected.map(p=>distance(p,corner)))).toBeLessThan(4e-6);
        const spec=physicalSpecForTile(tile),reference=control.createRigidBody(RigidBodyDesc.dynamic());
        control.createCollider(ColliderDesc.convexHull(tilePrismPoints(tile))!.setMass(spec.mass),reference);
        expect(body.mass()).toBeCloseTo(spec.mass,6);
        const inertia=Object.values(body.principalInertia()).sort((a,b)=>a-b);
        const old=Object.values(reference.principalInertia()).sort((a,b)=>a-b);
        const analytic=[spec.mass*(spec.height**2+spec.thickness**2)/12,spec.mass*(spec.width**2+spec.thickness**2)/12,spec.mass*(spec.width**2+spec.height**2)/12].sort((a,b)=>a-b);
        inertia.forEach((value,i)=>{expect(value).toBeCloseTo(analytic[i],5);expect(value).toBeCloseTo(old[i],5);});
        const restored=await createEngineWorld(supportSnapshot(build,engine),{drop:false,floorY:0,state:engine.snapshot()});
        try {expect(supportSnapshot(build,restored)).toEqual(supportSnapshot(build,engine));} finally {restored.dispose();}
        for (const physicsModel of [undefined,"old-convex-model"]) {
          const state={...engine.snapshot(),physicsModel} as unknown as ReturnType<typeof engine.snapshot>;
          await expect(createEngineWorld({...build,tiles:[actual]},{drop:false,floorY:0,state})).rejects.toThrow(/current physics model/);
        }
      } finally {engine.dispose();control.free();}
    }
  });
  it("has no phantom deep edge contacts in fresh or continued free-hinge motion", async () => {
    const fixture=unsupportedHingeFixture(),target=fixture.tiles.find(t=>t.id==="roof")!;
    const one=assemble("one","One",[{...target,basis:undefined,rotation:{x:0,y:0,z:0}}],"tower");
    const first=await createEngineWorld(one,{drop:false,floorY:0});
    const ends=[];
    try {
      first.bodies.get("roof")!.body.setRotation(basisToQuaternion(target.basis!),true);
      const pair=assemble("pair","Pair",[supportSnapshot(one,first).tiles[0],fixture.tiles.find(t=>t.id!=="roof")!],"tower");
      for (const resumed of [false,true]) {
        const e=await createEngineWorld(pair,{drop:false,floorY:0,...(resumed?{state:first.snapshot()}:{})});
        try {
          for (const {body} of e.bodies.values()) {body.setLinvel({x:0,y:0,z:0},true);body.setAngvel({x:0,y:0,z:0},true);}
          e.bodies.get("x-0--1")!.body.setBodyType(RigidBodyType.Fixed,true);
          expect(e.joints.every(j=>j.joint.contactsEnabled() && (!j.companion || j.companion.contactsEnabled()))).toBe(true);
          const original=e.world.step.bind(e.world);
          vi.spyOn(e.world,"step").mockImplementation(()=>{
            const before=supportSnapshot(pair,e).tiles;
            original();
            const after=supportSnapshot(pair,e).tiles;
            const motion=Math.max(...before.flatMap((t,i)=>tilePrismVertices(t).map((p,j)=>distance(p,tilePrismVertices(after[i])[j]))));
            const depth=Math.max(0,signedBoxDepth(before[0],before[1]));
            e.world.contactPair(e.bodies.get("roof")!.body.collider(0),e.bodies.get("x-0--1")!.body.collider(0),m=>{
              for(let i=0;i<m.numContacts();i++) expect(Math.max(0,-m.contactDist(i))).toBeLessThanOrEqual(depth+2*motion+.002);
            });
          });
          for(let i=0;i<12;i++) e.step();
          const end={...e.bodies.get("roof")!.body.translation()};
          expect(distance(end,target.position)).toBeGreaterThan(1);
          ends.push(end);
        } finally {e.dispose();}
      }
      expect(distance(ends[0],ends[1])).toBeLessThan(.08);
    } finally {first.dispose();}
  });
});
