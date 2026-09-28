import { MAX_COLLISION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { describe,expect,it,vi } from "vitest";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { checkSolidSweep,prismPose } from "@/lib/magnetic-tiles/swept-prisms";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { supportSnapshot,simulateSupport } from "@/lib/replication/support";
import { assemble,square,v } from "@/lib/replication/geometry";
import type { TileInstance } from "@/lib/magnetic-tiles/types";

const panel=(id:string,x=0,y=5,z=0)=>square(id,v(x-1.5,y-1.5,z),v(3,0,0),v(0,3,0),"red",1,"fixture");
const check=(a:TileInstance[],b=a)=>checkSolidSweep(a.map(prismPose),b.map(prismPose),0,.03);

describe("continuous solid-prism acceptance",()=>{
  it("rejects embedded solids with exact pair identity and unrounded penetration",()=>{
    const result=check([panel("a"),panel("b",0,5,.047321)]);
    expect(result.failure).toMatchObject({kind:"overlap",tileIds:["b","a"]});
    expect(result.peakSolidOverlap).toBeCloseTo(.18-.047321,12);
    expect(result.failure!.penetration).toBe(result.peakSolidOverlap);
  });
  it("finds a translation crossing with clear endpoints",()=>{
    const a=[panel("wall"),panel("moving",0,5,-1)],b=[a[0],panel("moving",0,5,1)];
    expect(check(a).failure).toBeUndefined();expect(check(b).failure).toBeUndefined();
    expect(check(a,b).failure?.kind).toBe("overlap");
  });
  it("retains near-parallel separating axes instead of replacing them with zero vectors",()=>{
    const a=panel("a"),b={...panel("b",0,5,.14),basis:basisFromEuler(1e-7,0,0)};
    const result=check([a,b]);
    expect(result.failure?.kind).toBe("overlap");
    expect(result.peakSolidOverlap).toBeGreaterThan(.039999);
  });
  it("finds angular tile and table crossings with clear endpoints",()=>{
    const a=panel("turning"),b={...a,basis:basisFromEuler(0,0,Math.PI)},wall=panel("wall",3.1);
    expect(check([a,wall]).failure).toBeUndefined();expect(check([b,wall]).failure).toBeUndefined();
    expect(check([a,wall],[b,wall]).failure?.kind).toBe("overlap");
    const low={...a,position:v(0,1.7,0)},end={...low,basis:b.basis};
    expect(check([low]).failure).toBeUndefined();expect(check([end]).failure).toBeUndefined();
    expect(check([low],[end]).failure?.kind).toBe("table");
  });
  it("refuses ambiguous clearance instead of accepting only safe endpoints",()=>{
    const wall=panel("wall"),a=panel("moving",0,5,.15),b={...a,position:v(.25,5,.15)};
    expect(check([wall,a]).failure).toBeUndefined();expect(check([wall,b]).failure).toBeUndefined();
    expect(check([wall,a],[wall,b]).failure?.kind).toBe("uncertified-sweep");
  });
  it("preserves solids with a reversed legacy normal during interpolation",()=>{
    const a=panel("legacy",0,1.7),b={...a,basis:{...a.basis!,zAxis:v(0,0,-1)}};
    expect(check([b],[b]).failure).toBeUndefined();
    expect(check([a],[b]).failure).toBeUndefined();
  });
  it("retains a transient collision through later poses and state handoff",async()=>{
    const build=assemble("sweep","Sweep",[panel("wall"),panel("moving",0,5,-1)],"tower");
    const e=await createEngineWorld(build,{drop:false,floorY:0});
    try{
      for(const r of e.bodies.values())r.body.setBodyType(RigidBodyType.Fixed,true);
      const body=e.bodies.get("moving")!.body,step=vi.spyOn(e.world,"step").mockImplementation(()=>body.setTranslation(v(0,5,1),true));
      e.step();expect(step).toHaveBeenCalledTimes(1);
      expect(e.solidFailures[0].kind).toBe("overlap");
      expect(e.groundPenetration).toBe(0);
      const state=e.snapshot(),actual=supportSnapshot(build,e),continued=await createEngineWorld(actual,{drop:false,floorY:0,state});
      try{
        expect(continued.solidFailures).toEqual(e.solidFailures);
        expect(continued.peakSolidOverlap).toBe(e.peakSolidOverlap);
        const next=vi.spyOn(continued.world,"step");continued.step();expect(next).not.toHaveBeenCalled();
      }finally{continued.dispose();}
      const support=await simulateSupport(actual,["wall","moving"],0,0,Infinity,state,undefined,[["wall"],["moving"]]);
      expect(support.status).toBe("fail");expect(support.solidFailures).toEqual(state.solidFailures);
    }finally{e.dispose();}
  });
  it("rejects unobservable full rotations before integrating",async()=>{
    const build=assemble("spin","Spin",[panel("spin")],"tower"),e=await createEngineWorld(build,{drop:false,floorY:0});
    try{
      e.bodies.get("spin")!.body.setAngvel(v(0,0,Math.PI/MAX_COLLISION_TIMESTEP_SECONDS*2),true);
      const step=vi.spyOn(e.world,"step");e.step();
      expect(step).not.toHaveBeenCalled();expect(e.solidFailures[0].kind).toBe("uncertified-sweep");
    }finally{e.dispose();}
  });
  it("rejects angular travel introduced by the solver within a step",async()=>{
    const build=assemble("spin","Spin",[panel("spin")],"tower"),e=await createEngineWorld(build,{drop:false,floorY:0});
    try{
      vi.spyOn(e.world,"step").mockImplementation(()=>e.bodies.get("spin")!.body.setAngvel(v(0,0,Math.PI/MAX_COLLISION_TIMESTEP_SECONDS*2),true));
      e.step();expect(e.solidFailures[0].kind).toBe("uncertified-sweep");
    }finally{e.dispose();}
  });
});
