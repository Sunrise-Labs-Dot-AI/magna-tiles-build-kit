import { afterEach,describe,expect,it,vi } from "vitest";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { distance,transformLocal } from "@/lib/engine/math";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { assemble,v } from "@/lib/replication/geometry";
import { edgeGrips } from "@/lib/replication/grip";
import * as motions from "@/lib/replication/held-motion";
import * as supports from "@/lib/replication/support";
import { assemblyUFixture } from "./fixtures/assembly";

afterEach(()=>vi.restoreAllMocks());

function fixture(released=false) {
  const r=assemblyUFixture(),next=assemblyUFixture(),rename=(id:string)=>`next-${id}`;
  r.build=assemble("occupied-pickup","Lift beside a released support",[
    ...r.build.tiles,...next.build.tiles.map(t=>({...t,id:rename(t.id)})),
  ],"tower");
  r.stages.push({...next.stages[0],id:"next",tileIds:next.stages[0].tileIds.map(rename)});
  const ops=next.construction![0].operations.map(op=>({...op,tileIds:op.tileIds.map(rename),
    hands:op.hands!.map(h=>({...h,tileId:rename(h.tileId)}))}));
  if(released)Object.assign(ops[1],{releaseAfter:true});
  r.construction!.push({stageId:"next",workspace:{afterStageId:"u",offset:v(6,0,0)},operations:[
    ops[0],ops[1],{...ops[2],pickup:{height:.5,hand:structuredClone(ops[2].hands[1])},lowerBeforeRelease:.32,releaseAfter:true},
  ]});
  return r;
}

describe("component-local pickup and lowering",()=>{
  it.each([false,true])("preserves the occupied world when the new prefix is released=%s",async released=>{
    const r=fixture(released),before=structuredClone(r),obstacleIds=r.stages[0].tileIds;
    const support=supports.simulateSupport,motion=motions.simulateHeldMotion;
    const lastSupport=new Map<number,Awaited<ReturnType<typeof support>>>();
    const lastState=new Map<number,Awaited<ReturnType<typeof support>>["state"]>();
    const observed:{seed:number;lowering:boolean}[]=[];
    vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
      if(lastState.has(args[3]))expect(args[5]).toEqual(lastState.get(args[3]));
      const result=await support(...args);
      lastSupport.set(args[3],structuredClone(result));
      lastState.set(args[3],structuredClone(result.state));
      return result;
    });
    vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async(...args)=>{
      const [build,state,moving,hands,waypoints,,seed]=args;
      const local=build.tiles.filter(t=>t.id.startsWith("next-")).map(t=>t.id);
      if(moving.length===1 || !local.length){
        const result=await motion(...args);
        if(result.state)lastState.set(seed,structuredClone(result.state));
        return result;
      }
      const prior=lastSupport.get(seed)!;
      expect(prior.heldTileIds).toEqual([hands[0].tileId]);
      expect(state).toEqual(prior.state);
      expect(build.tiles).toEqual(prior.settled.tiles);
      expect([...moving].sort()).toEqual([...local].sort());
      expect(build.tiles).toHaveLength(obstacleIds.length+local.length);
      expect(hands).toHaveLength(1);
      expect(obstacleIds).not.toContain(hands[0].tileId);
      const result=await motion(...args);
      expect(result.status,result.detail).toBe("pass");
      expect(result.movingComponentTileIds).toEqual(moving);
      expect(result.motion[0].tiles).toEqual(prior.motion.at(-1)!.tiles);
      expect(result.heldTileIds).toEqual([hands[0].tileId]);
      expect(result.peakDeformation).toBeLessThan(.03);
      for(const body of result.state!.bodies)
        expect(body.bodyType).toBe(body.referenceTile.id===hands[0].tileId ? RigidBodyType.KinematicPositionBased : RigidBodyType.Dynamic);
      for(const frame of result.motion)for(const id of obstacleIds){
        const actual=frame.tiles.find(t=>t.id===id)!;
        expect(actual).toBeDefined();
        const original=tilePrismVertices(build.tiles.find(t=>t.id===id)!);
        expect(Math.max(...tilePrismVertices(actual).map((p,i)=>distance(p,original[i])))).toBeLessThan(.03);
      }
      observed.push({seed,lowering:waypoints[1].position.y<waypoints[0].position.y});
      lastState.set(seed,structuredClone(result.state!));
      return result;
    });
    const [first,next]=await evaluateAssembly(r);
    expect(first.status,first.detail).toBe("pass");
    expect(next.status,next.detail).toBe("pass");
    expect(observed).toEqual([0,17,53].flatMap(seed=>[{seed,lowering:false},{seed,lowering:true}]));
    expect(next.checkpoints).toHaveLength(3);
    for(const checkpoint of next.checkpoints){
      expect(checkpoint.dynamicTileCount).toBe(6);
      expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
    }
    expect(r).toEqual(before);
  },180000);

  it.each(["wrong-component","blocked-acquisition","support-failure"])("rejects %s before lifting or preparing a successor",async mode=>{
    const r=fixture(true),last=r.construction![1].operations[2],motion=motions.simulateHeldMotion,support=supports.simulateSupport;
    if(mode==="wrong-component"){
      const obstacleGrip=structuredClone(r.construction![0].operations[0].hands![0]);
      last.pickup!.hand=obstacleGrip;last.hands![1]=structuredClone(obstacleGrip);
    }
    if(mode==="blocked-acquisition"){
      const tile=r.build.tiles.find(t=>t.id===last.pickup!.hand.tileId)!;
      const bottom=edgeGrips(tile).sort((a,b)=>transformLocal(a.localPoint,tile.position,tile.basis!).y-transformLocal(b.localPoint,tile.position,tile.basis!).y)[0];
      last.pickup!.hand=bottom;last.hands![1]=structuredClone(bottom);
    }
    const failedSupports:number[]=[];
    if(mode==="support-failure")vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
      const result=await support(...args);
      if(args[0].tiles.filter(t=>t.id.startsWith("next-")).length===2 && args[1].length===1){
        // Failure propagation test: run the real trial, then force only a failure.
        // A synthetic success is never allowed to certify the fixture.
        failedSupports.push(args[3]);
        return {...result,status:"fail",detail:"Injected one-hand support failure."};
      }
      return result;
    });
    const spy=vi.spyOn(motions,"simulateHeldMotion").mockImplementation((...args)=>motion(...args));
    const [first,next]=await evaluateAssembly(r);
    expect(first.status,first.detail).toBe("pass");
    expect(next.status).toBe("fail");
    const rows=next.rejectedAttempts.flatMap(a=>a.operations).filter(o=>o.index===2);
    expect(rows).toHaveLength(6);
    expect(rows.every(o=>o.status==="fail" && !o.pickup && !o.lowering)).toBe(true);
    expect(spy.mock.calls.every(args=>args[2].length===1)).toBe(true);
    expect(next.checkpoints).toEqual([]);
    if(mode==="wrong-component")expect(rows.every(o=>o.detail.includes("same declared component"))).toBe(true);
    if(mode==="blocked-acquisition")expect(rows.every(o=>o.pickupHandoff?.status==="fail" && o.detail.includes("table"))).toBe(true);
    if(mode==="support-failure")expect(failedSupports).toEqual([0,17,53,0,17,53]);
  },180000);

  it("never continues from a failed predecessor",async()=>{
    const r=fixture();
    r.construction![0].operations[0].hands![0].localPoint.x=100;
    const [first,next]=await evaluateAssembly(r);
    expect(first.status).toBe("fail");
    expect(next.status).toBe("unverified");
    expect(next.operations).toEqual([]);
    expect(next.checkpoints).toEqual([]);
  });
});
