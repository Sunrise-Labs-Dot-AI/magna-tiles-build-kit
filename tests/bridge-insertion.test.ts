import {beforeAll,describe,expect,it,vi} from "vitest";
import {connectionId} from "@/lib/engine/build";
import {distance} from "@/lib/engine/math";
import {RigidBodyType} from "@/lib/engine/physics-backend";
import * as engine from "@/lib/engine/rapier-world";
import {tilePrismVertices} from "@/lib/magnetic-tiles/prism-geometry";
import {evaluateAssembly} from "@/lib/replication/assembly";
import {assemblyOperationPreview} from "@/lib/replication/assembly-preview";
import * as bridge from "@/lib/replication/bridge-insertion";
import * as motion from "@/lib/replication/held-motion";
import * as support from "@/lib/replication/support";
import * as grip from "@/lib/replication/grip";
import {exactContactArrival} from "@/lib/replication/contact-arrival";
import {bridgePanelFixture} from "./fixtures/bridge-panel";

type Args=Parameters<typeof bridge.simulateBridgeInsertion>;
const inputs:Args[]=[],outputs:bridge.BridgeTrial[]=[];
let results:Awaited<ReturnType<typeof evaluateAssembly>>;

beforeAll(async()=>{
  const replica=bridgePanelFixture(),before=structuredClone(replica);
  const runBridge=bridge.simulateBridgeInsertion,create=engine.createEngineWorld,runMotion=motion.simulateHeldMotion,runSupport=support.simulateSupport;
  const active=new Set<number>(),latest=new Map<number,engine.EngineState>();
  let introductions=0;
  vi.spyOn(engine,"createEngineWorld").mockImplementation(async(...args)=>{
    const world=await create(...args),saved=args[1]?.state;
    if(saved&&!saved.bodies.some(b=>b.referenceTile.id==="bridge")&&args[0].tiles.some(t=>t.id==="bridge")){
      const snapshot=world.snapshot();introductions++;
      expect(snapshot.bodies).toHaveLength(8);
      for(const body of saved.bodies)expect(snapshot.bodies.find(b=>b.referenceTile.id===body.referenceTile.id)).toEqual(body);
      expect({...snapshot,bodies:[]}).toEqual({...saved,bodies:[]});
    }
    return world;
  });
  vi.spyOn(motion,"simulateHeldMotion").mockImplementation(async(...args)=>{
    if(active.has(args[6])){
      const beforeState=latest.get(args[6])!;
      expect(args[0].tiles).toHaveLength(8);expect(args[1]!.bodies).toHaveLength(8);
      for(const body of beforeState.bodies)expect(args[1]!.bodies.find(b=>b.referenceTile.id===body.referenceTile.id)).toEqual(body);
      expect(args[1]!.bodies.filter(b=>b.bodyType!==RigidBodyType.Dynamic).map(b=>b.referenceTile.id)).toEqual(["bridge"]);
      expect(args[1]!.joints).toEqual(beforeState.joints);
    }
    const result=await runMotion(...args);
    if(active.has(args[6])){
      latest.set(args[6],structuredClone(result.state!));
      expect(result.motion[0].tiles).toEqual(args[0].tiles);
      expect(result.status,result.detail).toBe("pass");
      for(const frame of result.motion){
        expect(frame.tiles.map(t=>t.id).sort()).toEqual(args[0].tiles.map(t=>t.id).sort());
        const a=tilePrismVertices(args[0].tiles.find(t=>t.id==="bystander")!),b=tilePrismVertices(frame.tiles.find(t=>t.id==="bystander")!);
        expect(Math.max(...a.map((p,i)=>distance(p,b[i])))).toBeLessThan(.03);
      }
    }
    return result;
  });
  vi.spyOn(support,"simulateSupport").mockImplementation(async(...args)=>{
    if(active.has(args[3])){
      expect(args[5]).toEqual(latest.get(args[3]));
      expect(args[0].tiles).toHaveLength(8);expect(args[5]!.bodies).toHaveLength(8);
    }
    const result=await runSupport(...args);
    if(active.has(args[3])){
      latest.set(args[3],structuredClone(result.state));
      expect(result.state.bodies).toHaveLength(8);
      if(!args[1].length)expect(result.state.bodies.every(b=>b.bodyType===RigidBodyType.Dynamic)).toBe(true);
    }
    return result;
  });
  vi.spyOn(bridge,"simulateBridgeInsertion").mockImplementation(async(...args)=>{
    active.add(args[8]);latest.set(args[8],structuredClone(args[2]));inputs.push(structuredClone(args));
    const beforeArgs=structuredClone(args),result=await runBridge(...args);
    expect(args).toEqual(beforeArgs);outputs.push(structuredClone(result));return result;
  });
  try{results=await evaluateAssembly(replica);}finally{vi.restoreAllMocks();}
  expect(replica).toEqual(before);expect(introductions).toBe(3);
  expect(results.every(s=>s.status==="pass"),JSON.stringify(results.map(s=>({id:s.stageId,status:s.status,detail:s.detail})))).toBe(true);
},900000);

describe("one-panel bridge insertion",()=>{
  it("earns exactly two joins after separated arrival and preserves the unrelated component on all seeds",()=>{
    expect(inputs.map(a=>a[8])).toEqual([0,17,53]);expect(outputs).toHaveLength(3);
    for(const [i,result] of outputs.entries()){
      const old=inputs[i][2].joints.map(j=>j.model.id).sort(),added=inputs[i][4].map(connectionId).sort();
      expect(result.status,result.detail).toBe("pass");
      expect(result.introduction!.bodyIdsBefore).toHaveLength(7);expect(result.introduction!.bodyIdsAfter).toHaveLength(8);
      expect(result.introduction!.activeJointIds).toEqual(old);expect(old).toHaveLength(4);
      expect(result.activeJointIdsBeforeClosure).toEqual(old);expect(result.earnedConnectionIds).toEqual(added);
      expect(added).toHaveLength(2);expect(result.state.joints.map(j=>j.model.id).sort()).toEqual([...old,...added].sort());
      expect(result.earnedComponentGroups).toEqual([[...inputs[i][10][0],...inputs[i][10][1],"bridge"],["bystander"]]);
      expect(result.carry!.completion).toBe("contact-arrival");
      expect(result.carry!.separationCheckpoint!.separations.every(p=>p.gap>0)).toBe(true);
      expect(result.carry!.arrivalContacts!.sourceConnectionIds).toEqual(added);
      expect(result.carry!.heldTileIds).toEqual(["bridge"]);expect(result.carry!.dynamicTileCount).toBe(7);
    }
    for(const check of results.at(-1)!.checkpoints){
      expect(check.status,check.detail).toBe("pass");expect(check.dynamicTileCount).toBe(8);expect(check.heldTileIds).toEqual([]);
      expect(check.poppedJoints).toEqual([]);expect(check.solidFailures).toEqual([]);
    }
    expect(results.at(-1)!.terminalConnections!.map(r=>r.connectionIds.length)).toEqual([6,6,6]);
  });

  it("plays actual eight-body frames and withholds new joins until connected stabilization",()=>{
    const row=results.at(-1)!.operations[0],build=bridgePanelFixture().build;
    for(const phase of row.timeline!)expect(phase.activeConnectionIds).toHaveLength(phase.phase==="carry"?4:6);
    const start=assemblyOperationPreview(build,row,0),end=assemblyOperationPreview(build,row,1);
    expect(start.tiles).toEqual(row.carry!.motion[0].tiles);expect(start.connections).toHaveLength(4);
    expect(end.tiles).toEqual(row.trials.at(-1)!.motion.at(-1)!.tiles);expect(end.connections).toHaveLength(6);
    expect(start.tiles).toHaveLength(8);expect(end.tiles).toHaveLength(8);
    expect(row.handTransitions!.some(t=>t.status==="pass"&&t.nextHands.length===0)).toBe(true);
  });

  it("physically acquires an optional existing support grip without resetting its workspace",async()=>{
    const args=structuredClone(inputs[0]);
    args[6].push(bridgePanelFixture().construction![0].operations[0].hands![0]);
    const result=await bridge.simulateBridgeInsertion(...args);
    expect(result.status,result.detail).toBe("pass");expect(result.handTransition!.status).toBe("pass");
    expect(result.handoff!.status).toBe("pass");expect(result.handoff!.motion[0].tiles).toEqual(args[1].tiles);
    expect(result.carry!.heldTileIds).toEqual(args[6].map(h=>h.tileId));expect(result.carry!.dynamicTileCount).toBe(6);
    expect(result.earnedComponentGroups).toEqual(outputs[0].earnedComponentGroups);
  },120000);

  it.each(["extra-target","extra-actual","missing-actual","missing-saved","reused-incoming","pose-reset","shape-reset","hidden-hold","previous-hand",
    "broken-joint","missing-joint","nonfinite","bad-groups","one-neighbor","fixed-fixed-edge","duplicate-pair","reverse-duplicate","reused-incoming-edge","unknown-endpoint","blocked-grip","too-many-hands"])("rejects %s before creating a new body",async mode=>{
    const args=structuredClone(inputs[0]);
    if(mode==="extra-target")args[0].tiles.push({...args[0].tiles[0],id:"future"});
    if(mode==="extra-actual")args[1].tiles.push({...args[1].tiles[0],id:"future"});
    if(mode==="missing-actual")args[1].tiles.pop();
    if(mode==="missing-saved")args[2].bodies.pop();
    if(mode==="reused-incoming")args[3]=args[1].tiles[0].id;
    if(mode==="pose-reset")args[1].tiles[0].position.x+=.2;
    if(mode==="shape-reset")args[0].tiles[0].shape="large-square";
    if(mode==="hidden-hold")args[2].bodies[0].bodyType=RigidBodyType.Fixed;
    if(mode==="previous-hand")args[5]=[args[6][0]];
    if(mode==="broken-joint")args[2].poppedJoints.push(args[2].joints[0].model.id);
    if(mode==="missing-joint")args[2].joints.pop();
    if(mode==="nonfinite")args[2].bodies[0].linearVelocity.x=NaN;
    if(mode==="bad-groups")args[10][0].pop();
    if(mode==="one-neighbor")args[4].pop();
    if(mode==="fixed-fixed-edge")args[4][0]=args[1].connections[0];
    if(mode==="duplicate-pair")args[4].push(args[4][0]);
    if(mode==="reverse-duplicate"){
      const c=args[4][0];args[4].push({...c,fromTileId:c.toTileId,fromEdge:c.toEdge,toTileId:c.fromTileId,toEdge:c.fromEdge});
    }
    if(mode==="reused-incoming-edge"){
      const first=args[4][0],edge=first.fromTileId===args[3]?first.fromEdge:first.toEdge;
      if(args[4][1].fromTileId===args[3])args[4][1].fromEdge=edge;else args[4][1].toEdge=edge;
    }
    if(mode==="unknown-endpoint")args[4][0].fromEdge=99;
    if(mode==="blocked-grip")args[6][0].localPoint={x:99,y:99,z:99};
    if(mode==="too-many-hands")args[6].push(args[6][0],args[6][0]);
    const create=vi.spyOn(engine,"createEngineWorld");
    try{
      const result=await bridge.simulateBridgeInsertion(...args);
      expect(result.status,result.detail).toBe("fail");expect(result.earnedConnectionIds).toEqual([]);
      expect(result.introduction).toBeUndefined();expect(create).not.toHaveBeenCalled();
    }finally{vi.restoreAllMocks();}
  });

  it.each(["pose","mode","joint","extra-body"])("detects a restored %s change before motion",async mode=>{
    const create=engine.createEngineWorld,carry=vi.spyOn(motion,"simulateHeldMotion");
    vi.spyOn(engine,"createEngineWorld").mockImplementation(async(...args)=>{
      const world=await create(...args),snapshot=world.snapshot.bind(world);
      world.snapshot=()=>{
        const state=snapshot();
        if(mode==="pose")state.bodies[0].position.x+=.2;
        if(mode==="mode")state.bodies[0].bodyType=RigidBodyType.Fixed;
        if(mode==="joint")state.joints.pop();
        if(mode==="extra-body")state.bodies.push({...state.bodies[0],referenceTile:{...state.bodies[0].referenceTile,id:"future"}});
        return state;
      };
      return world;
    });
    try{
      const result=await bridge.simulateBridgeInsertion(...structuredClone(inputs[0]));
      expect(result.status).toBe("fail");expect(result.detail).toMatch(/before motion/);expect(carry).not.toHaveBeenCalled();
    }finally{vi.restoreAllMocks();}
  });

  it("rejects missing and unexpected actual contacts independently of the requested graph",()=>{
    const actual=outputs[0].carry!.settled,edges=inputs[0][4],moving=new Set(["bridge"]);
    expect(exactContactArrival(actual,moving,edges).status).toBe("pass");
    expect(exactContactArrival(actual,moving,edges.slice(1)).status).toBe("fail");
    const separated=structuredClone(actual);separated.tiles.find(t=>t.id==="bridge")!.position.y+=1;
    expect(exactContactArrival(separated,moving,edges).status).toBe("fail");
  });

  it.each(["missing-arrival","unexpected-arrival","premature-joint"])("does not stabilize %s evidence",async mode=>{
    // Corrupt only a previously measured carry result to exercise fail-closed
    // boundaries. No successful assembly in this suite uses canned physics.
    const carried=structuredClone(outputs[0].carry!);
    if(mode==="missing-arrival")carried.arrivalContacts!.sourceConnectionIds.pop();
    if(mode==="unexpected-arrival")carried.arrivalContacts!.physicalConnectionIds.push("invented");
    if(mode==="premature-joint")carried.state!.joints.push(outputs[0].state.joints.find(j=>outputs[0].earnedConnectionIds.includes(j.model.id))!);
    vi.spyOn(motion,"simulateHeldMotion").mockResolvedValue(carried);
    const stabilize=vi.spyOn(support,"simulateSupport");
    try{
      const result=await bridge.simulateBridgeInsertion(...structuredClone(inputs[0]));
      expect(result.status).toBe("fail");expect(result.earnedConnectionIds).toEqual([]);expect(stabilize).not.toHaveBeenCalled();
    }finally{vi.restoreAllMocks();}
  });

  it.each(["withdrawal","free-release"])("publishes no terminal evidence after a failed %s",async mode=>{
    const transition=grip.checkHandTransition,runSupport=support.simulateSupport;
    vi.spyOn(grip,"checkHandTransition").mockImplementation((...args)=>{
      const result=transition(...args);
      return mode==="withdrawal"&&args[1].some(h=>h.tileId==="bridge")&&!args[2].length
        ?{...result,status:"fail",detail:"Injected blocked withdrawal"}:result;
    });
    vi.spyOn(support,"simulateSupport").mockImplementation(async(...args)=>{
      const result=await runSupport(...args);
      return mode==="free-release"&&args[0].tiles.some(t=>t.id==="bridge")&&!args[1].length
        ?{...result,status:"fail",detail:"Injected failed free rest"}:result;
    });
    try{
      const result=(await evaluateAssembly(bridgePanelFixture())).at(-1)!;
      expect(result.status).toBe("fail");expect(result.terminalConnections).toBeUndefined();expect(result.operations).toEqual([]);
      expect(result.rejectedAttempts.every(a=>a.operations.some(o=>o.bridge?.status==="pass"&&o.status==="fail"))).toBe(true);
    }finally{vi.restoreAllMocks();}
  },300000);
});
