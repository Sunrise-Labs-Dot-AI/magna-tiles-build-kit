import {beforeAll,describe,expect,it,vi} from "vitest";
import {connectionId,normalizeBuild} from "@/lib/engine/build";
import {RigidBodyType} from "@/lib/engine/physics-backend";
import * as engine from "@/lib/engine/rapier-world";
import {evaluateAssembly,type AssemblyResult} from "@/lib/replication/assembly";
import {assemblyOperationPreview} from "@/lib/replication/assembly-preview";
import {planConstructionPaths} from "@/lib/replication/construction";
import * as motion from "@/lib/replication/held-motion";
import * as support from "@/lib/replication/support";
import * as workspace from "@/lib/replication/workspace";
import {continuedPrefixFixture} from "./fixtures/continued-prefix";

const snapshots:workspace.PreparedWorkspace[]=[];
type Input={seed:number;phase:string;args:unknown[]};
const cases:{replica:ReturnType<typeof continuedPrefixFixture>;result:AssemblyResult[];inputs:Input[]}[]=[];
const unearned="left-z-0--1:0->right-z-0--1:0";

beforeAll(async()=>{
  for(const future of [false,true]){
    const replica=continuedPrefixFixture(true,future),before=structuredClone(replica),inputs:Input[]=[];
    const select=workspace.selectWorkspace,create=engine.createEngineWorld,carry=motion.simulateHeldMotion,stabilize=support.simulateSupport;
    const latest=new Map<number,engine.EngineState>(),oldJoints=new Map<number,string[]>();
    let introductions=0;
    vi.spyOn(workspace,"selectWorkspace").mockImplementation((...args)=>{
      const result=select(...args);
      if(args[1]==="bridge"){
        latest.set(args[2],structuredClone(result.state));oldJoints.set(args[2],result.state.joints.map(j=>j.model.id).sort());
        if(!future)snapshots.push(structuredClone(result));
      }
      return result;
    });
    vi.spyOn(engine,"createEngineWorld").mockImplementation(async(...args)=>{
      const world=await create(...args),state=args[1]?.state;
      if(state&&!state.bodies.some(b=>b.referenceTile.id==="right-front")&&args[0].tiles.some(t=>t.id==="right-front")){
        const restored=world.snapshot();introductions++;
        expect(restored.bodies).toHaveLength(8);
        for(const body of state.bodies)expect(restored.bodies.find(b=>b.referenceTile.id===body.referenceTile.id)).toEqual(body);
        expect({...restored,bodies:[]}).toEqual({...state,bodies:[]});
      }
      return world;
    });
    const present=(ids:string[])=>!ids.some(id=>id.startsWith("future-"));
    const checkState=(seed:number,state:engine.EngineState)=>{
      const ids=state.joints.map(j=>j.model.id);
      expect(oldJoints.get(seed)!.every(id=>ids.includes(id))).toBe(true);
      expect(ids).not.toContain(unearned);
      expect(state.poppedJoints).toEqual([]);expect(state.solidFailures).toEqual([]);
    };
    vi.spyOn(motion,"simulateHeldMotion").mockImplementation(async(...args)=>{
      const active=latest.has(args[6])&&present(args[0].tiles.map(t=>t.id));
      if(active){expect(args[1]).toEqual(latest.get(args[6]));inputs.push(structuredClone({seed:args[6],phase:"carry",args:[normalizeBuild(args[0]),...args.slice(1,7)]}));}
      const result=await carry(...args);
      if(active){checkState(args[6],result.state!);latest.set(args[6],structuredClone(result.state!));}
      return result;
    });
    vi.spyOn(support,"simulateSupport").mockImplementation(async(...args)=>{
      const active=latest.has(args[3])&&present(args[0].tiles.map(t=>t.id));
      if(active){expect(args[5]).toEqual(latest.get(args[3]));inputs.push(structuredClone({seed:args[3],phase:"support",args:[normalizeBuild(args[0]),...args.slice(1,8)]}));}
      const result=await stabilize(...args);
      if(active){
        checkState(args[3],result.state);latest.set(args[3],structuredClone(result.state));
        if(!args[1].length)expect(result.state.bodies.every(b=>b.bodyType===RigidBodyType.Dynamic)).toBe(true);
      }
      return result;
    });
    try{cases.push({replica,result:await evaluateAssembly(replica),inputs});}finally{vi.restoreAllMocks();}
    expect(replica).toEqual(before);
    expect(introductions).toBe(future?6:3);
  }
},300000);

describe("ordinary continuation of an earned connected prefix",()=>{
  it("retains the real seven-panel predecessor and earns only the arriving panel's joins on three seeds",()=>{
    const {replica,result}=cases[0],last=result.at(-1)!;
    expect(result.every(s=>s.status==="pass"),JSON.stringify(result.map(s=>({id:s.stageId,status:s.status,detail:s.detail})))).toBe(true);
    expect(snapshots.map(w=>w.seed)).toEqual([0,17,53]);
    const proposed=replica.build.connections.filter(c=>c.fromTileId==="right-front"||c.toTileId==="right-front").map(connectionId).sort();
    expect(proposed).toHaveLength(2);
    for(const [i,row] of last.operations.entries()){
      expect(row.status,row.detail).toBe("pass");expect(row.carry!.dynamicTileCount).toBe(7);expect(row.carry!.heldTileIds).toEqual(["right-front"]);
      const old=snapshots[i].state.joints.map(j=>j.model.id).sort();expect(old).toHaveLength(6);
      for(const phase of row.timeline!)expect([...phase.activeConnectionIds!].sort()).toEqual(phase.phase==="carry"||phase.phase==="support"&&phase.index===0?old:[...old,...proposed].sort());
      expect(row.handTransitions!.some(t=>t.status==="pass"&&t.nextHands.length===0)).toBe(true);
      expect(last.terminalConnections![i].connectionIds).toEqual([...old,...proposed].sort());
    }
    for(const check of last.checkpoints){expect(check.status,check.detail).toBe("pass");expect(check.dynamicTileCount).toBe(8);}
  });

  it("keeps future wall/roof bodies and their nominal joins out of the complete first operation",()=>{
    const base=cases[0],future=cases[1],last=future.result.at(-1)!;
    expect(last.status).toBe("fail");expect(last.terminalConnections).toBeUndefined();
    const attempt=last.rejectedAttempts[0];
    for(const seed of [0,17,53]){
      const before=base.result.at(-1)!.operations.find(r=>r.seed===seed)!;
      const after=attempt.operations.find(r=>r.seed===seed&&r.index===0)!;
      expect(after).toEqual(before);
      const beforeInputs=base.inputs.filter(input=>input.seed===seed);
      // The next operation's initial free support starts from the same state
      // as the short stage's final free checkpoint.
      expect(future.inputs.filter(input=>input.seed===seed).slice(0,beforeInputs.length)).toEqual(beforeInputs);
      // Compare the actual engine/render parts and joins. Authored descriptive
      // bounds are discarded by normalizeBuild; they are never physics input.
      for(const progress of [0,.25,.5,.75,1])expect(normalizeBuild(assemblyOperationPreview(future.replica.build,after,progress))).toEqual(normalizeBuild(assemblyOperationPreview(base.replica.build,before,progress)));
      const end=assemblyOperationPreview(future.replica.build,after,1);
      expect(end.tiles).toHaveLength(8);expect(end.connections.map(connectionId).sort()).toEqual(base.result.at(-1)!.terminalConnections!.find(t=>t.seed===seed)!.connectionIds);
    }
    // Full targets are still accountable. An omitted future operation cannot
    // turn a passing eight-panel prefix into a passing ten-panel stage.
    const omitted=structuredClone(future.replica);omitted.construction!.at(-1)!.operations.splice(1);
    expect(planConstructionPaths(omitted).at(-1)!.detail).toMatch(/every stage part/);
  });

  it.each(["extra-body","missing-body","pose-reset","missing-joint","extra-joint","broken-history","nonfinite"])("does not repair %s in a retained predecessor",mode=>{
    const w=structuredClone(snapshots[0]);
    if(mode==="extra-body")w.state.bodies.push({...w.state.bodies[0],referenceTile:{...w.state.bodies[0].referenceTile,id:"future"}});
    if(mode==="missing-body")w.state.bodies.pop();
    if(mode==="pose-reset")w.build.tiles[0].position.x+=.2;
    if(mode==="missing-joint")w.state.joints.pop();
    if(mode==="extra-joint")w.state.joints.push(w.state.joints[0]);
    if(mode==="broken-history")w.state.poppedJoints.push(w.state.joints[0].model.id);
    if(mode==="nonfinite")w.state.bodies[0].linearVelocity.x=NaN;
    expect(workspace.checkPreparedContinuation(w.build,w.state,w.floorY).status).toBe("fail");
  });
});
