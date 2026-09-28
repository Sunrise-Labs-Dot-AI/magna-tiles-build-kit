import {beforeAll,describe,expect,it,vi} from "vitest";
import {RigidBodyType} from "@/lib/engine/physics-backend";
import {connectionId} from "@/lib/engine/build";
import {add,distance,subtract} from "@/lib/engine/math";
import {tilePrismVertices} from "@/lib/magnetic-tiles/prism-geometry";
import {evaluateAssembly} from "@/lib/replication/assembly";
import * as transfers from "@/lib/replication/prepared-transfer";
import * as motions from "@/lib/replication/held-motion";
import * as supports from "@/lib/replication/support";
import * as seating from "@/lib/replication/seating";
import * as workspaces from "@/lib/replication/workspace";
import {componentTransferFixture,unearnedFixedConnection} from "./fixtures/component-transfer";

type TransferArgs=Parameters<typeof transfers.simulatePreparedTransfer>;
const unwanted=connectionId(unearnedFixedConnection);
let results:Awaited<ReturnType<typeof evaluateAssembly>>;
const inputs:TransferArgs[]=[],outputs:Awaited<ReturnType<typeof transfers.simulatePreparedTransfer>>[]=[];
const selections:Parameters<typeof workspaces.selectWorkspace>[]=[];
const finalJoints=new Map<string,string[]>();

beforeAll(async()=>{
  const replica=componentTransferFixture();replica.build.connections.push(unearnedFixedConnection);
  const support=supports.simulateSupport,motion=motions.simulateHeldMotion,seat=seating.simulateGravitySeat,transfer=transfers.simulatePreparedTransfer,select=workspaces.selectWorkspace;
  const lastState=new Map<number,Awaited<ReturnType<typeof support>>["state"]>();
  vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
    if(lastState.has(args[3]))expect(args[5]).toEqual(lastState.get(args[3]));
    expect(args[0].connections.map(connectionId)).not.toContain(unwanted);
    const result=await support(...args);lastState.set(args[3],structuredClone(result.state));
    expect(result.state.connections.map(connectionId)).not.toContain(unwanted);
    return result;
  });
  vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async(...args)=>{
    expect(args[1]).toEqual(lastState.get(args[6]));
    expect(args[0].connections.map(connectionId)).not.toContain(unwanted);
    const result=await motion(...args);
    if(result.state)lastState.set(args[6],structuredClone(result.state));
    if(args[2].length===4){
      expect(args[0].tiles).toHaveLength(10);expect(args[8]).toHaveLength(3);
      expect(result.motion[0].tiles).toEqual(args[0].tiles);
      expect(result.movingComponentTileIds).toEqual(args[2]);
      expect(result.state!.bodies.filter(b=>b.bodyType!==RigidBodyType.Dynamic).map(b=>b.referenceTile.id)).toEqual([args[3][0].tileId]);
      for(const frame of result.motion){
        expect(frame.tiles).toHaveLength(10);
        for(const tile of args[0].tiles.filter(t=>t.id.startsWith("third-"))){
          const original=tilePrismVertices(tile),actual=tilePrismVertices(frame.tiles.find(t=>t.id===tile.id)!);
          expect(Math.max(...actual.map((p,i)=>distance(p,original[i])))).toBeLessThan(.03);
        }
      }
    }
    return result;
  });
  vi.spyOn(seating,"simulateGravitySeat").mockImplementation(async(...args)=>{
    expect(args[7]).toEqual(lastState.get(args[5]));
    const result=await seat(...args);
    if(result.state)lastState.set(args[5],structuredClone(result.state));
    return result;
  });
  vi.spyOn(transfers,"simulatePreparedTransfer").mockImplementation(async(...args)=>{
    inputs.push(structuredClone(args));const result=await transfer(...args);outputs.push(structuredClone(result));return result;
  });
  vi.spyOn(workspaces,"selectWorkspace").mockImplementation((...args)=>{
    const result=select(...args);finalJoints.set(result.id,result.state.joints.map(j=>j.model.id).sort());
    if(args[1]==="third")selections.push(structuredClone(args));return result;
  });
  try{results=await evaluateAssembly(replica);}
  finally{vi.restoreAllMocks();}
  for(const [seed,state] of lastState)finalJoints.set(`after-transfer:${seed}`,state.joints.map(j=>j.model.id).sort());
  expect(results.every(s=>s.status==="pass"),JSON.stringify(results.map(({stageId,status,detail})=>({stageId,status,detail})))).toBe(true);
},900000);

describe("released module transfer in one three-component workspace",()=>{
  it("publishes only actual terminal joints after every successful checkpoint",()=>{
    for(const stage of results){
      expect(stage.terminalConnections?.map(t=>t.seed)).toEqual([0,17,53]);
      for(const terminal of stage.terminalConnections!){
        expect(terminal.connectionIds).toEqual(finalJoints.get(`${stage.stageId}:${terminal.seed}`));
        expect(terminal.connectionIds).not.toContain(unwanted);
      }
    }
  });

  it("publishes no accepted terminal evidence when a prerequisite has no grip contract",async()=>{
    const replica=componentTransferFixture();replica.construction![0].operations[0].hands=[];
    const rejected=await evaluateAssembly(replica);
    expect(rejected.every(s=>s.status!=="pass"&&s.terminalConnections===undefined)).toBe(true);
  });
  it("earns only the intended joins and continues with the untouched component retained",()=>{
    expect(inputs).toHaveLength(3);expect(outputs).toHaveLength(3);
    for(const [i,trial] of outputs.entries()){
      expect(inputs[i][2].bodies).toHaveLength(10);
      expect(trial.previousHands).toEqual([]);expect(trial.retainedHands).toEqual([]);expect(trial.acquiredHands).toHaveLength(1);
      expect(trial.handTransition?.status).toBe("pass");
      expect(trial.handoff!.state).toBeDefined();expect(trial.carry!.motion[0].tiles).toEqual(trial.handoff!.settled.tiles);
      expect(trial.componentGroupsBefore).toHaveLength(3);expect(trial.earnedComponentGroups).toHaveLength(2);
      expect(trial.earnedComponentGroups.map(g=>g.length).sort()).toEqual([3,7]);
      expect(trial.earnedCrossConnectionIds).toHaveLength(3);
      expect(trial.earnedCrossConnectionIds).toEqual(trial.withheldCrossConnectionIds);
      expect(trial.state.joints.some(j=>trial.earnedCrossConnectionIds.includes(j.model.id))).toBe(false);
      expect(trial.state.connections.map(connectionId)).not.toContain(unwanted);
    }
    const stage=results.find(s=>s.stageId==="transfer")!,continued=results.find(s=>s.stageId==="after-transfer")!;
    for(const operation of stage.operations){
      const free=operation.trials.at(-1)!;
      expect(free.status,free.detail).toBe("pass");expect(free.heldTileIds).toEqual([]);expect(free.dynamicTileCount).toBe(10);
      expect(free.settledSteps).toBeGreaterThanOrEqual(90);
    }
    expect(continued.checkpoints).toHaveLength(3);
    expect(continued.checkpoints.every(c=>c.status==="pass"&&c.dynamicTileCount===10&&c.heldTileIds.length===0)).toBe(true);
  });

  it.each(["missing-part","incomplete-moving","collapsed-groups","duplicate-edge","two-neighbors","pre-attached","blocked-grip","unrelated-hand","changed-grip"])("rejects %s before pickup support",async mode=>{
    const args=structuredClone(inputs[0]),moving=args[3],cross=args[0].connections.find(c=>moving.includes(c.fromTileId)!==moving.includes(c.toTileId))!;
    if(mode==="missing-part")args[1].tiles.pop();
    if(mode==="incomplete-moving")args[3]=moving.slice(1);
    if(mode==="collapsed-groups")args[10]=[args[10].flat()];
    if(mode==="duplicate-edge")args[0].connections.push({...cross});
    if(mode==="two-neighbors")args[0].connections.push({...cross,fromTileId:moving[0],toTileId:"third-x-0--1"});
    if(mode==="pre-attached")args[1].connections.push({...cross});
    if(mode==="blocked-grip")args[5][0].localPoint={x:99,y:99,z:0};
    if(mode==="unrelated-hand")args[4]=[{...args[5][0],tileId:"third-x-0--1"}];
    if(mode==="changed-grip")args[4]=[{...args[5][0],localPoint:{...args[5][0].localPoint,x:.01}}];
    const before=structuredClone(args[2]),result=await transfers.simulatePreparedTransfer(...args);
    expect(result.status).toBe("fail");expect(result.handoff).toBeUndefined();expect(result.carry).toBeUndefined();
    expect(result.earnedComponentGroups).toEqual([]);expect(args[2]).toEqual(before);
  });

  it("stops before motion when actual one-hand support fails",async()=>{
    const original=supports.simulateSupport,carry=vi.spyOn(motions,"simulateHeldMotion");
    vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
      const result=await original(...args);
      return {...result,status:"fail",detail:"Injected one-hand support failure after real support simulation."};
    });
    try{
      const result=await transfers.simulatePreparedTransfer(...structuredClone(inputs[0]));
      expect(result.status).toBe("fail");expect(result.handoff?.status).toBe("fail");
      expect(carry).not.toHaveBeenCalled();expect(result.earnedCrossConnectionIds).toEqual([]);expect(result.earnedComponentGroups).toEqual([]);
    }finally{vi.restoreAllMocks();}
  },120000);

  it("rejects accidental fixed-to-fixed contact at actual arrival before earning a merge",async()=>{
    const original=motions.simulateHeldMotion;
    vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async(...args)=>{
      const result=await original(...args);expect(result.status,result.detail).toBe("pass");
      // Negative-only fault injection after a real successful carry: rigidly
      // displace the untouched U into closed contact with the stationary base.
      // This altered result must never certify the transfer or earn live joints.
      const fixed=result.settled.tiles.find(t=>t.id==="x-0-1")!,third=result.settled.tiles.find(t=>t.id==="third-x-0--1")!;
      const delta=subtract(add(fixed.position,{x:.195,y:0,z:0}),third.position);
      result.settled.tiles=result.settled.tiles.map(t=>t.id.startsWith("third-")?{...t,position:add(t.position,delta)}:t);
      result.state!.bodies.forEach(b=>{if(b.referenceTile.id.startsWith("third-"))b.position=add(b.position,delta);});
      result.motion.at(-1)!.tiles=structuredClone(result.settled.tiles);
      return result;
    });
    try{
      const result=await transfers.simulatePreparedTransfer(...structuredClone(inputs[0]));
      expect(result.status).toBe("fail");expect(result.detail).toMatch(/unearned magnetic contact/);
      expect(result.earnedCrossConnectionIds).toEqual([]);expect(result.earnedComponentGroups).toEqual([]);
    }finally{vi.restoreAllMocks();}
  },240000);

  it("selects the latest shared history and rejects stale or incomplete histories",()=>{
    expect(selections).toHaveLength(3);
    for(const args of selections){
      expect(args[3]).toEqual(["base","third","moving"]);
      const current=workspaces.selectWorkspace(...args);expect(current.build.tiles).toHaveLength(10);
      expect(()=>workspaces.selectWorkspace(args[0],"moving",args[2],["moving"])).toThrow(/stale branch/);
      const missing=structuredClone(args[0]);missing.find(w=>w.id===current.id)!.lineage=[];
      expect(()=>workspaces.selectWorkspace(missing,...args.slice(1) as [string,number,string[]])).toThrow(/history/);
      expect(()=>workspaces.selectWorkspace(args[0],"third",999,args[3])).toThrow();
    }
  });
});
