import { describe,expect,it } from "vitest";
import RAPIER,{ColliderDesc,RigidBodyDesc,ShapeType,type RigidBody} from "@/lib/engine/physics-backend";
import { physicalSpecForTile,tilePrismPoints } from "@/lib/engine/build";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { cross,distance,dot,multiplyQuaternions,quaternionToBasis,subtract,transformLocal } from "@/lib/engine/math";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import { supportSnapshot } from "@/lib/replication/support";
import { frameContactWorld,referenceFrames,runFrameContact,triangleShapes } from "./fixtures/contact-frames";
import { unpatchedContactControl } from "./fixtures/unpatched-contact";

function worldInertia(body:RigidBody):number[] {
  const basis=quaternionToBasis(multiplyQuaternions(body.rotation(),body.principalInertiaLocalFrame()));
  const axes=Object.values(basis).map(a=>[a.x,a.y,a.z]),eigen=Object.values(body.principalInertia());
  return [0,1,2].flatMap(row=>[0,1,2].map(col=>axes.reduce((sum,a,i)=>sum+eigen[i]*a[row]*a[col],0)));
}

describe("exact triangle prism collision frames",()=>{
  it.each(triangleShapes)("preserves %s corners, mass, center of mass and full world inertia",async shape=>{
    for(const frame of referenceFrames) {
      const {build,engine:e}=await frameContactWorld(shape,frame,.37),control=new RAPIER.World({x:0,y:0,z:0});
      try {
        const r=e.bodies.get("side")!,c=r.body.collider(0),spec=physicalSpecForTile(r.tile);
        expect(c.shapeType()).toBe(ShapeType.ConvexPolyhedron);
        e.world.propagateModifiedBodyPositionsToColliders();
        const points=c.vertices(),expected=tilePrismVertices(build.tiles.find(t=>t.id==="side")!);
        expect(points).toHaveLength(18);
        const faces=c.indices()!;
        expect(faces).toHaveLength(24);
        const edgeUses=new Map<string,number>();
        const vertex=(i:number)=>({x:points[i*3],y:points[i*3+1],z:points[i*3+2]});
        const center={x:0,y:0,z:0};
        for(let i=0;i<6;i++){const p=vertex(i);center.x+=p.x/6;center.y+=p.y/6;center.z+=p.z/6;}
        for(let i=0;i<faces.length;i+=3){
          const f=[faces[i],faces[i+1],faces[i+2]],a=vertex(f[0]);
          expect(dot(cross(subtract(vertex(f[1]),a),subtract(vertex(f[2]),a)),subtract(a,center))).toBeGreaterThan(0);
          for(let j=0;j<3;j++){const key=`${f[j]}:${f[(j+1)%3]}`;edgeUses.set(key,(edgeUses.get(key)??0)+1);}
        }
        for(const [edge,count]of edgeUses){expect(count).toBe(1);expect(edgeUses.get(edge.split(":").reverse().join(":"))).toBe(1);}
        for(let i=0;i<points.length;i+=3) {
          const p=transformLocal({x:points[i],y:points[i+1],z:points[i+2]},c.translation(),quaternionToBasis(c.rotation()));
          expect(Math.min(...expected.map(v=>distance(v,p)))).toBeLessThan(4e-6);
        }
        const p=r.body.translation(),old=control.createRigidBody(RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setRotation(r.body.rotation()));
        control.createCollider(ColliderDesc.convexHull(tilePrismPoints(r.tile))!.setMass(spec.mass),old);
        expect(r.body.mass()).toBeCloseTo(spec.mass,7);
        expect(distance(r.body.worldCom(),old.worldCom())).toBeLessThan(2e-6);
        worldInertia(r.body).forEach((x,i)=>expect(x).toBeCloseTo(worldInertia(old)[i],6));
        const state=e.snapshot(),continued=await createEngineWorld(supportSnapshot(build,e),{drop:false,floorY:0,state});
        try{expect(continued.snapshot()).toEqual(state);}finally{continued.dispose();}
        await expect(createEngineWorld(supportSnapshot(build,e),{drop:false,floorY:0,state:{...state,physicsModel:"rigid-contact-v5-exact-box-960"}})).rejects.toThrow(/current physics model/);
      }finally{e.dispose();control.free();}
    }
  });
  it.each(triangleShapes)("bounds actual %s contact by independent geometry in every reference frame",async shape=>{
    for(const frame of referenceFrames)for(const yaw of [0,.37])for(const seed of [0,17,53])for(const hz of [960,1920]) {
      const trial=await runFrameContact(shape,frame,yaw,seed,hz);
      expect(trial.passed,JSON.stringify(trial)).toBe(true);
    }
  },30000);
  it("detects the old touching-prism deep-contact defect without granting it a larger motion budget",async()=>{
    const old=await unpatchedContactControl();
    expect(old.contacts).toBeGreaterThan(0);
    expect(old.depthExcess).toBeGreaterThan(1);
    const corrected=await runFrameContact("right-triangle","identity",0,0);
    expect(corrected.passed,JSON.stringify(corrected)).toBe(true);
  });
  it.each(triangleShapes)("passes the reserved %s orientations without parameter retuning",async shape=>{
    for(const frame of referenceFrames)for(const [seed,yaws] of [[29,[-.61,1.13]],[71,[.23,.89,-1.47]]] as const)
      for(const yaw of yaws)for(const hz of [960,1920]){
        const trial=await runFrameContact(shape,frame,yaw,seed,hz);
        expect(trial.passed,JSON.stringify(trial)).toBe(true);
      }
  });
});
