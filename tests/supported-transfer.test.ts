import {beforeAll,describe,expect,it,vi} from "vitest";
import {RigidBodyType} from "@/lib/engine/physics-backend";
import * as worlds from "@/lib/engine/rapier-world";
import {evaluateAssembly} from "@/lib/replication/assembly";
import {edgeGrips,checkHandAccess} from "@/lib/replication/grip";
import * as transfers from "@/lib/replication/prepared-transfer";
import * as motions from "@/lib/replication/held-motion";
import * as supports from "@/lib/replication/support";
import * as seating from "@/lib/replication/seating";
import {supportedComponentTransferFixture as fixture} from "./fixtures/component-transfer";

const receiverId="x-0--1";
type TransferArgs=Parameters<typeof transfers.simulatePreparedTransfer>;
let results:Awaited<ReturnType<typeof evaluateAssembly>>;
const inputs:TransferArgs[]=[],outputs:Awaited<ReturnType<typeof transfers.simulatePreparedTransfer>>[]=[];
const released=new Map<number,worlds.EngineState>();
let checkedCarrySteps=0,checkedSupportSteps=0;

beforeAll(async()=>{
  const support=supports.simulateSupport,motion=motions.simulateHeldMotion,seat=seating.simulateGravitySeat,transfer=transfers.simulatePreparedTransfer,create=worlds.createEngineWorld;
  const lastState=new Map<number,worlds.EngineState>();
  let modes:{kind:"carry"|"support";held:string[];moving?:string}|undefined;
  vi.spyOn(worlds,"createEngineWorld").mockImplementation(async(...args)=>{
    const engine=await create(...args),expected=modes;
    // Inspect restored state before support changes any mode or integrates.
    if(args[1]?.state){
      const restored=engine.snapshot(),prior=args[1].state;
      for(const body of prior.bodies)expect(restored.bodies.find(b=>b.referenceTile.id===body.referenceTile.id)).toEqual(body);
      for(const joint of prior.joints)expect(restored.joints.find(j=>j.model.id===joint.model.id)).toEqual(joint);
    }
    if(expected){
      const step=engine.step;
      engine.step=()=>{
        for(const [id,{body}] of engine.bodies){
          const wanted=id===expected.moving?RigidBodyType.KinematicPositionBased:expected.held.includes(id)?RigidBodyType.Fixed:RigidBodyType.Dynamic;
          if(body.bodyType()!==wanted)throw new Error(`Unexpected ${expected.kind} body mode for ${id}`);
        }
        if(expected.kind==="carry")checkedCarrySteps++;else checkedSupportSteps++;
        step();
      };
    }
    return engine;
  });
  vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
    if(lastState.has(args[3]))expect(args[5]).toEqual(lastState.get(args[3]));
    modes={kind:"support",held:args[1]};
    const result=await support(...args);modes=undefined;
    lastState.set(args[3],structuredClone(result.state));
    if(args[0].tiles.length===10&&args[0].connections.some(c=>c.fromTileId.startsWith("moving-")!==c.toTileId.startsWith("moving-"))){
      expect(result.state.bodies.filter(b=>b.bodyType!==RigidBodyType.Dynamic).map(b=>b.referenceTile.id).sort()).toEqual([...args[1]].sort());
      if(!args[1].length)released.set(args[3],structuredClone(result.state));
      else expect([...args[1]].sort()).toEqual(["moving-roof",receiverId].sort());
    }
    return result;
  });
  vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async(...args)=>{
    expect(args[1]).toEqual(lastState.get(args[6]));
    const held=args[3].find(h=>args[2].includes(h.tileId))!;
    modes={kind:"carry",held:args[3].map(h=>h.tileId),moving:held.tileId};
    const result=await motion(...args);modes=undefined;
    if(result.state)lastState.set(args[6],structuredClone(result.state));
    if(args[2].length===4){
      expect(result.heldTileIds).toHaveLength(2);expect(result.heldTileIds).toContain(receiverId);
      expect(result.dynamicTileCount).toBe(8);
      const receiver=result.state!.bodies.find(b=>b.referenceTile.id===receiverId)!,before=args[1]!.bodies.find(b=>b.referenceTile.id===receiverId)!;
      expect(receiver.bodyType).toBe(RigidBodyType.Fixed);
      expect(receiver.position).toEqual(before.position);expect(receiver.rotation).toEqual(before.rotation);
      expect(result.state!.bodies.find(b=>b.referenceTile.id===held.tileId)!.bodyType).toBe(RigidBodyType.KinematicPositionBased);
      for(const b of result.state!.bodies.filter(b=>b.referenceTile.id.startsWith("third-")))expect(b.bodyType).toBe(RigidBodyType.Dynamic);
    }
    return result;
  });
  vi.spyOn(seating,"simulateGravitySeat").mockImplementation(async(...args)=>{
    expect(args[7]).toEqual(lastState.get(args[5]));const result=await seat(...args);
    if(result.state)lastState.set(args[5],structuredClone(result.state));return result;
  });
  vi.spyOn(transfers,"simulatePreparedTransfer").mockImplementation(async(...args)=>{
    inputs.push(structuredClone(args));const result=await transfer(...args);outputs.push(structuredClone(result));return result;
  });
  try{results=await evaluateAssembly(fixture());}finally{vi.restoreAllMocks();}
  expect(results.every(s=>s.status==="pass"),JSON.stringify(results.map(({stageId,status,detail})=>({stageId,status,detail})))).toBe(true);
},900000);

describe("prepared transfer with one explicit receiving-panel grip",()=>{
  it("earns exact joins on all seeds while the bystander stays dynamic and separate",()=>{
    expect(inputs).toHaveLength(3);expect(outputs).toHaveLength(3);
    expect(checkedCarrySteps).toBeGreaterThan(1000);expect(checkedSupportSteps).toBeGreaterThan(1000);
    for(const result of outputs){
      expect(result.status,result.detail).toBe("pass");expect(result.acquiredHands).toHaveLength(2);
      expect(result.carry!.heldTileIds).toEqual(["moving-roof",receiverId]);
      expect(result.earnedCrossConnectionIds).toEqual(result.withheldCrossConnectionIds);expect(result.earnedCrossConnectionIds).toHaveLength(3);
      expect(result.earnedComponentGroups.map(g=>g.length).sort()).toEqual([3,7]);
      expect(result.state.joints.some(j=>result.earnedCrossConnectionIds.includes(j.model.id))).toBe(false);
    }
    expect([...released.keys()]).toEqual([0,17,53]);
    for(const state of released.values()){
      expect(state.bodies).toHaveLength(10);expect(state.bodies.every(b=>b.bodyType===RigidBodyType.Dynamic)).toBe(true);
      expect(state.joints.filter(j=>j.model.fromTileId.startsWith("third-")!==j.model.toTileId.startsWith("third-"))).toEqual([]);
    }
    for(const operation of results.find(s=>s.stageId==="transfer")!.operations){
      const free=operation.trials.at(-1)!;
      expect(free.status,free.detail).toBe("pass");expect(free.heldTileIds).toEqual([]);expect(free.settledSteps).toBeGreaterThanOrEqual(90);
    }
  });

  it("uses component roles rather than incoming hand order",async()=>{
    const args=structuredClone(inputs[0]);args[5].reverse();
    const result=await transfers.simulatePreparedTransfer(...args);
    expect(result.status,result.detail).toBe("pass");
    expect(result.state).toEqual(outputs[0].state);expect(result.settled).toEqual(outputs[0].settled);
    expect(result.earnedCrossConnectionIds).toEqual(outputs[0].earnedCrossConnectionIds);
  },240000);

  it("retains an actual moving-panel hold while acquiring the receiving grip",async()=>{
    const args=structuredClone(inputs[0]),movingHand=args[5][0];
    const held=await supports.simulateSupport(args[1],[movingHand.tileId],args[7],args[8],args[9],args[2],[movingHand],args[10]);
    expect(held.status,held.detail).toBe("pass");
    args[1]=held.settled;args[2]=held.state;args[4]=[movingHand];
    const result=await transfers.simulatePreparedTransfer(...args);
    expect(result.status,result.detail).toBe("pass");expect(result.retainedHands).toEqual([movingHand]);
    expect(result.acquiredHands).toEqual([args[5][1]]);
  },240000);

  it.each(["handoff","arrival","closure"])("cannot earn a transfer after a two-hand %s failure",async phase=>{
    // Fault injection starts from real measured fixture results, with no positive
    // credit for a mocked trial. Each case must fail its own downstream guard.
    if(phase==="handoff")vi.spyOn(supports,"simulateSupport").mockResolvedValue({...structuredClone(outputs[0].handoff!),status:"fail",detail:"Injected two-panel handoff failure."});
    const carry=vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async(...args)=>{
      expect(args[1]).toEqual(outputs[0].handoff!.state);
      const result=structuredClone(outputs[0].carry!);
      if(phase==="arrival")return {...result,status:"fail",completion:"incomplete",detail:"Injected missed contact at actual arrival."};
      // A negative-only receiver displacement invalidates the actual declared
      // contact despite the preserved earlier arrival metadata.
      result.settled.tiles.find(t=>t.id===receiverId)!.position.x-=.5;
      return result;
    });
    try{
      const result=await transfers.simulatePreparedTransfer(...structuredClone(inputs[0]));
      expect(result.status).toBe("fail");expect(result.earnedCrossConnectionIds).toEqual([]);expect(result.earnedComponentGroups).toEqual([]);
      if(phase==="handoff"){expect(carry).not.toHaveBeenCalled();expect(result.handoff?.status).toBe("fail");}
      else{expect(carry).toHaveBeenCalledOnce();if(phase==="arrival")expect(result.carry?.status).toBe("fail");}
    }finally{vi.restoreAllMocks();}
  },120000);

  it.each(["unrelated-receiver","inaccessible-receiver","two-moving-grips","third-hand","changed-retained"])("rejects %s before support or motion",async mode=>{
    const args=structuredClone(inputs[0]);
    if(mode==="unrelated-receiver")args[5][1]={...args[5][1],tileId:"third-x-0--1"};
    if(mode==="inaccessible-receiver")args[5][1].localPoint={x:99,y:99,z:0};
    if(mode==="third-hand")args[4]=edgeGrips(args[1].tiles.find(t=>t.id==="moving-x-0--1")!).slice(2,3).concat(args[5].slice(0,1));
    if(mode==="changed-retained")args[4]=[{...args[5][0],localPoint:{...args[5][0].localPoint,x:.01}}];
    if(mode==="two-moving-grips"){
      args[5][1]=edgeGrips(args[1].tiles.find(t=>t.id==="moving-x-0--1")!)[2];
      const access=checkHandAccess(args[1],{id:"negative-access",movingTileIds:[args[5][0].tileId],fixedTileIds:args[1].tiles.filter(t=>t.id!==args[5][0].tileId).map(t=>t.id),offsets:[{x:0,y:0,z:0},{x:0,y:0,z:0}]},args[5],args[7]);
      expect(access.status,access.detail).toBe("pass");
    }
    const before=structuredClone(args[2]),result=await transfers.simulatePreparedTransfer(...args);
    expect(result.status).toBe("fail");expect(result.handoff).toBeUndefined();expect(result.carry).toBeUndefined();
    expect(result.earnedCrossConnectionIds).toEqual([]);expect(args[2]).toEqual(before);
  });

  it.each(["receiver-reset","stale-state"])("refuses %s without adopting changed state",async mode=>{
    const args=structuredClone(inputs[0]);
    if(mode==="receiver-reset"){
      const receiving=args[10].find(group=>group.includes(receiverId))!;
      for(const tile of args[1].tiles)if(receiving.includes(tile.id))tile.position.y+=.1;
    }
    else args[2].physicsModel="stale";
    const before=structuredClone(args[2]);
    await expect(transfers.simulatePreparedTransfer(...args)).rejects.toThrow();
    expect(args[2]).toEqual(before);
  });

  it("cannot publish a transfer when its free checkpoint fails",async()=>{
    const original=supports.simulateSupport;
    vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
      const result=await original(...args);
      const joined=args[0].connections.some(c=>c.fromTileId.startsWith("moving-")!==c.toTileId.startsWith("moving-"));
      return joined&&!args[1].length?{...result,status:"fail",detail:"Injected failure after actual free release."}:result;
    });
    try{
      const rejected=await evaluateAssembly(fixture());
      const stage=rejected.find(s=>s.stageId==="transfer")!;
      expect(stage.status).toBe("fail");expect(stage.terminalConnections).toBeUndefined();
      expect(rejected.at(-1)!.status).toBe("unverified");
    }finally{vi.restoreAllMocks();}
  },900000);

  it("requires an explicit terminal release contract before assembly",async()=>{
    const replica=fixture();replica.construction![3].operations[0].releaseAfter=false;
    const result=await evaluateAssembly(replica);
    expect(result.slice(0,3).every(s=>s.status==="pass")).toBe(true);
    const transfer=result.find(s=>s.stageId==="transfer")!;
    expect(transfer.status).toBe("unverified");expect(transfer.detail).toMatch(/continuous transfer contract/);
    expect(transfer.terminalConnections).toBeUndefined();expect(result.at(-1)!.status).toBe("unverified");
  },900000);
});
