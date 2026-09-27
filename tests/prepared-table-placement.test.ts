import {beforeAll,describe,expect,it,vi} from "vitest";
import {RigidBodyType} from "@/lib/engine/physics-backend";
import {connectionId} from "@/lib/engine/build";
import {distance} from "@/lib/engine/math";
import {tilePrismVertices} from "@/lib/magnetic-tiles/prism-geometry";
import {evaluateAssembly} from "@/lib/replication/assembly";
import {assemblyOperationPreview} from "@/lib/replication/assembly-preview";
import * as placement from "@/lib/replication/prepared-placement";
import * as support from "@/lib/replication/support";
import * as motion from "@/lib/replication/held-motion";
import * as seating from "@/lib/replication/seating";
import * as engine from "@/lib/engine/rapier-world";
import {tablePlacementFixture} from "./fixtures/table-placement";

type PlacementArgs=Parameters<typeof placement.simulatePreparedTablePlacement>;
const inputs:PlacementArgs[]=[],outputs:Awaited<ReturnType<typeof placement.simulatePreparedTablePlacement>>[]=[];
let results:Awaited<ReturnType<typeof evaluateAssembly>>;

beforeAll(async()=>{
  const replica=tablePlacementFixture(),before=structuredClone(replica);
  const runPlacement=placement.simulatePreparedTablePlacement,runSupport=support.simulateSupport,runMotion=motion.simulateHeldMotion;
  const runSeat=seating.simulateGravitySeat,runRelease=seating.simulatePreparedTableRelease;
  const states=new Map<number,engine.EngineState>(),active=new Set<number>();
  const carries=new Map<number,Awaited<ReturnType<typeof runMotion>>>();
  const ids=(build:{tiles:{id:string}[]})=>build.tiles.map(t=>t.id).sort();
  vi.spyOn(support,"simulateSupport").mockImplementation(async(...args)=>{
    if(states.has(args[3]))expect(args[5]).toEqual(states.get(args[3]));
    if(active.has(args[3]))expect(ids(args[0])).toEqual(args[5]!.bodies.map(b=>b.referenceTile.id).sort());
    const result=await runSupport(...args);states.set(args[3],structuredClone(result.state));return result;
  });
  vi.spyOn(motion,"simulateHeldMotion").mockImplementation(async(...args)=>{
    expect(args[1]).toEqual(states.get(args[6]));
    if(active.has(args[6]))expect(ids(args[0])).toEqual(args[1]!.bodies.map(b=>b.referenceTile.id).sort());
    const result=await runMotion(...args);
    if(result.state)states.set(args[6],structuredClone(result.state));
    if(active.has(args[6])){
      carries.set(args[6],structuredClone(result));
      expect(result.status,result.detail).toBe("pass");
      expect(result.heldTileIds).toEqual([args[3][0].tileId]);
      expect(result.motion[0].tiles).toEqual(args[0].tiles);
      expect(result.state!.bodies.filter(b=>b.bodyType!==RigidBodyType.Dynamic).map(b=>b.referenceTile.id)).toEqual([args[3][0].tileId]);
      for(const frame of result.motion){
        expect(frame.tiles).toHaveLength(7);
        for(const tile of args[0].tiles.filter(t=>t.id.startsWith("neighbor-"))){
          const old=tilePrismVertices(tile),current=tilePrismVertices(frame.tiles.find(t=>t.id===tile.id)!);
          expect(Math.max(...current.map((p,i)=>distance(p,old[i])))).toBeLessThan(.03);
        }
      }
    }
    return result;
  });
  vi.spyOn(seating,"simulateGravitySeat").mockImplementation(async(...args)=>{
    expect(args[7]).toEqual(states.get(args[5]));
    const result=await runSeat(...args);if(result.state)states.set(args[5],structuredClone(result.state));return result;
  });
  vi.spyOn(seating,"simulatePreparedTableRelease").mockImplementation(async(...args)=>{
    const carry=carries.get(args[5])!;
    expect(args[0].tiles).toEqual(carry.settled.tiles);
    expect(args[7]).toEqual(carry.state);
    expect(ids(args[0])).toEqual(args[7].bodies.map(b=>b.referenceTile.id).sort());
    const result=await runRelease(...args);
    expect(result.motion[0].tiles).toEqual(carry.settled.tiles);
    expect(result.activeJointIds.sort()).toEqual(carry.state!.joints.map(j=>j.model.id).sort());
    if(result.state){
      expect(result.state.bodies.every(b=>b.bodyType===RigidBodyType.Dynamic)).toBe(true);
      states.set(args[5],structuredClone(result.state));
    }
    return result;
  });
  vi.spyOn(placement,"simulatePreparedTablePlacement").mockImplementation(async(...args)=>{
    active.add(args[9]);inputs.push(structuredClone(args));
    const result=await runPlacement(...args);outputs.push(structuredClone(result));return result;
  });
  try{results=await evaluateAssembly(replica);}
  finally{vi.restoreAllMocks();}
  expect(replica).toEqual(before);
  expect(results.every(s=>s.status==="pass"),JSON.stringify(results.map(s=>({stage:s.stageId,status:s.status,detail:s.detail})))).toBe(true);
},900000);

describe("prepared table relocation",()=>{
  it("moves the complete prepared component and preserves all existing joints through free release",()=>{
    expect(inputs).toHaveLength(3);expect(outputs).toHaveLength(3);
    for(const [index,result] of outputs.entries()){
      expect(result.status,result.detail).toBe("pass");
      expect(result.horizontalDisplacement).toBeGreaterThan(5.9);
      expect(result.horizontalDisplacement).toBeLessThan(6.1);
      expect(result.componentGroups).toEqual(inputs[index][11]);
      expect(result.componentGroups.map(g=>g.length).sort()).toEqual([3,4]);
      expect(result.seating!.tableBearingTileIds.length).toBeGreaterThan(0);
      expect(result.seating!.settledSteps).toBeGreaterThanOrEqual(90);
      expect(result.seating!.earnedJointIds).toEqual([]);
      expect(result.state.connections.map(connectionId).sort()).toEqual(inputs[index][2].connections.map(connectionId).sort());
      expect(result.state.joints.map(j=>j.model.id).sort()).toEqual(result.activeJointIds);
      expect(result.acquisition?.status).toBe("pass");expect(result.withdrawal?.status).toBe("pass");
    }
    const stage=results[2];
    expect(stage.checkpoints).toHaveLength(3);
    for(const checkpoint of stage.checkpoints){
      expect(checkpoint.status,checkpoint.detail).toBe("pass");
      expect(checkpoint.dynamicTileCount).toBe(7);expect(checkpoint.heldTileIds).toEqual([]);
      expect(checkpoint.poppedJoints).toEqual([]);expect(checkpoint.solidFailures).toEqual([]);
    }
    for(const terminal of stage.terminalConnections!)
      expect(terminal.connectionIds).toEqual(outputs[inputs.findIndex(args=>args[9]===terminal.seed)].activeJointIds);
  });

  it("replays actual carried and fallen poses with the same seven bodies and no invented joins",()=>{
    const row=results[2].operations[0],build=tablePlacementFixture().build;
    const start=assemblyOperationPreview(build,row,0),end=assemblyOperationPreview(build,row,1);
    expect(start.tiles).toEqual(row.trials[0].motion[0].tiles);
    expect(end.tiles).toEqual(row.trials.at(-1)!.motion.at(-1)!.tiles);
    expect(start.tiles).toHaveLength(7);expect(end.tiles).toHaveLength(7);
    expect(start.tiles).not.toEqual(end.tiles);
    expect(start.connections.map(connectionId).sort()).toEqual(end.connections.map(connectionId).sort());
  });

  it.each(["extra-target-body","extra-actual-body","missing-body","partial-component","collapsed-groups","held-neighbor","unrecorded-hold",
    "pose-reset","changed-shape","broken-joint","missing-joint","nonfinite-state","underground-target","floating-target","zero-clearance","blocked-grip","intended-cross-join"])("rejects %s before engine creation",async mode=>{
    const args=structuredClone(inputs[0]);
    if(mode==="extra-target-body")args[0].tiles.push({...args[0].tiles[0],id:"future-blue"});
    if(mode==="extra-actual-body")args[1].tiles.push({...args[1].tiles[0],id:"future-canopy"});
    if(mode==="missing-body")args[1].tiles.pop();
    if(mode==="partial-component")args[3]=args[3].slice(1);
    if(mode==="collapsed-groups")args[11]=[args[11].flat()];
    if(mode==="held-neighbor")args[4]=[{...args[5][0],tileId:args[11].find(g=>g.length===3)![0]}];
    if(mode==="unrecorded-hold")args[2].bodies[0].bodyType=RigidBodyType.Fixed;
    if(mode==="pose-reset")args[1].tiles[0].position.x+=.2;
    if(mode==="changed-shape")args[0].tiles[0].shape="large-square";
    if(mode==="broken-joint")args[2].poppedJoints.push(args[2].joints[0].model.id);
    if(mode==="missing-joint")args[2].joints.pop();
    if(mode==="nonfinite-state")args[2].bodies[0].linearVelocity.x=NaN;
    if(mode==="underground-target"||mode==="floating-target")for(const t of args[0].tiles)if(args[3].includes(t.id))t.position.y+=mode==="floating-target"?2:-.5;
    if(mode==="zero-clearance")args[7]=0;
    if(mode==="blocked-grip")args[5][0].localPoint={x:99,y:99,z:99};
    if(mode==="intended-cross-join")args[0].connections.push({...args[0].connections[0],fromTileId:args[3][0],toTileId:args[11].find(g=>g.length===3)![0]});
    const create=vi.spyOn(engine,"createEngineWorld");
    try{
      const result=await placement.simulatePreparedTablePlacement(...args);
      expect(result.status).toBe("fail");expect(result.handoff).toBeUndefined();
      expect(result.carry).toBeUndefined();expect(result.seating).toBeUndefined();expect(create).not.toHaveBeenCalled();
    }finally{vi.restoreAllMocks();}
  });

  it.each(["extra-body","missing-body","changed-pose","wrong-held-body"])("rejects %s at the actual gravity-release boundary",async mode=>{
    const args=inputs[0],carry=outputs[0].carry!,actual=structuredClone(carry.settled),state=structuredClone(carry.state!);
    if(mode==="extra-body")actual.tiles.push({...actual.tiles[0],id:"future-panel"});
    if(mode==="missing-body")actual.tiles.pop();
    if(mode==="changed-pose")actual.tiles[0].position.z+=.2;
    if(mode==="wrong-held-body")state.bodies.find(b=>b.referenceTile.id!==args[5][0].tileId)!.bodyType=RigidBodyType.Fixed;
    const create=vi.spyOn(engine,"createEngineWorld");
    try{
      const result=await seating.simulatePreparedTableRelease(actual,args[3],args[5],args[7],args[8],args[9],Infinity,state,args[11]);
      expect(result.status).toBe("fail");expect(result.motion).toEqual([]);expect(create).not.toHaveBeenCalled();
    }finally{vi.restoreAllMocks();}
  });

  it("rejects a destination that collides with the retained neighbor during actual motion",async()=>{
    const args=structuredClone(inputs[0]),before=structuredClone(args[2]);
    for(const tile of args[0].tiles)if(args[3].includes(tile.id))tile.position.x-=6;
    const result=await placement.simulatePreparedTablePlacement(...args);
    expect(result.status).toBe("fail");expect(result.carry).toBeDefined();
    expect(result.seating).toBeUndefined();expect(args[2]).toEqual(before);
  },120000);

  it.each(["missing-bearing","no-sustained-rest"])("refuses %s after continuing a real gravity release",async mode=>{
    const args=inputs[0],carry=outputs[0].carry!,create=engine.createEngineWorld;
    vi.spyOn(engine,"createEngineWorld").mockImplementation(async(...worldArgs)=>{
      const world=await create(...worldArgs);
      // Negative-only sensor faults: physics still advances, but missing bearing
      // evidence or reported motion must prevent a successful release verdict.
      if(mode==="missing-bearing")world.world.contactPairsWith=()=>{};
      else for(const {body} of world.bodies.values())body.linvel=()=>({x:1,y:0,z:0});
      return world;
    });
    try{
      const result=await seating.simulatePreparedTableRelease(structuredClone(carry.settled),args[3],args[5],args[7],args[8],args[9],Infinity,structuredClone(carry.state!),args[11]);
      expect(result.status).toBe("fail");expect(result.motion.length).toBeGreaterThan(1);
      expect(result.detail).toMatch(mode==="missing-bearing"?/no actual supporting contact/:/did not reach sustained rest/);
    }finally{vi.restoreAllMocks();}
  },120000);

  it.each(["vertical-offset","oversized-offset","nonfinite-offset","late-initial-offset"])("rejects %s without publishing any prepared state",async mode=>{
    const replica=tablePlacementFixture();
    if(mode==="vertical-offset")replica.construction![0].workspace!.offset.y=1;
    if(mode==="oversized-offset")replica.construction![0].workspace!.offset.x=13;
    if(mode==="nonfinite-offset")replica.construction![0].workspace!.offset.x=NaN;
    if(mode==="late-initial-offset"){
      replica.construction![0].operations[0].hands=[];
      delete replica.construction![1].workspace!.afterStageId;
    }
    const create=vi.spyOn(engine,"createEngineWorld");
    try{
      const result=await evaluateAssembly(replica);
      expect(result.every(s=>s.status!=="pass"&&!s.terminalConnections)).toBe(true);
      if(mode==="late-initial-offset")expect(result[1].detail).toMatch(/Initial construction placement/);
      expect(create).not.toHaveBeenCalled();
    }finally{vi.restoreAllMocks();}
  });
});
