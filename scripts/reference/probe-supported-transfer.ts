/** Fresh compact-prefix diagnostic with actual engine-mode auditing.
 * Run probe-compact-support-fit.ts first, then:
 * npx vitest run --config scripts/reference/probe-supported-transfer.config.ts
 * This is deliberately outside the default test suite: it needs local fitting
 * evidence and proves no hidden source parts or independently heldout geometry. */
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {it,expect,vi} from "vitest";
import {RigidBodyType} from "../../lib/engine/physics-backend";
import * as worlds from "../../lib/engine/rapier-world";
import * as motions from "../../lib/replication/held-motion";
import * as supports from "../../lib/replication/support";
import {mediumRamp} from "../../lib/replication/models";
import {evaluateAssembly} from "../../lib/replication/assembly";
import {validationCodeHash} from "../../lib/replication/provenance";
import {edgeGrips} from "../../lib/replication/grip";
import {transformLocal} from "../../lib/engine/math";
import {countInventory} from "../../lib/magnetic-tiles/validation";
import type {BuildGraph} from "../../lib/magnetic-tiles/types";

it("records a fresh compact-prefix attempt with one explicit support-back grip",async()=>{
  const input=await readFile("/tmp/magnatiles-compact-support-fit.json","utf8");
  const build=(JSON.parse(input) as {rows:{name:string;build:BuildGraph}[]}).rows.find(r=>r.name==="rear")!.build;
  const replica=mediumRamp();replica.id="compact-supported-transfer-probe";
  replica.title="Compact thirteen-panel construction with a proposed receiving grip";
  replica.build=build;replica.inventory=countInventory(build.tiles);delete replica.route;replica.uncertainties=[];
  const supportIds=build.tiles.filter(t=>t.id.startsWith("support-")).map(t=>t.id);
  replica.stages=replica.stages.slice(0,6).map(stage=>({...stage,
    instruction:"Proposed physical preparation only. Exact source parts, grips and motion remain unverified.",
    tileIds:stage.id==="medium-support"?supportIds:stage.tileIds.some(id=>id.startsWith("support-"))?
      [...stage.tileIds.filter(id=>!id.startsWith("support-")),...supportIds]:stage.tileIds}));
  const grip=(id:string)=>{
    const tile=build.tiles.find(t=>t.id===id)!;
    return edgeGrips(tile).sort((a,b)=>transformLocal(b.localPoint,tile.position,tile.basis!).y-transformLocal(a.localPoint,tile.position,tile.basis!).y)[0];
  };
  replica.construction![2].operations=["support-back","support-side--1-0","support-side-1-0","support-front"].map((id,i)=>({tileIds:[id],
    hands:i===0||i===3?[grip(id)]:[grip(id),grip("support-back")],releaseAfter:i>=2}));
  const operation=replica.construction![3].operations[0],receiverId="support-back";
  operation.hands!.push(edgeGrips(build.tiles.find(t=>t.id===receiverId)!)[2]);
  replica.construction!.at(-1)!.operations[0].bridgeInsertion!.connections=build.connections.filter(c=>c.fromTileId==="turn-floor"||c.toTileId==="turn-floor");
  const create=worlds.createEngineWorld,motion=motions.simulateHeldMotion,support=supports.simulateSupport;
  const modeEvidence:{phase:string;seed:number;heldTileIds:string[];movingTileId?:string;checkedSteps:number;actualModes:{tileId:string;bodyType:number}[];status?:string;settledSteps?:number}[]=[];
  let context:{phase:string;seed:number;heldTileIds:string[];movingTileId?:string}|undefined;
  vi.spyOn(worlds,"createEngineWorld").mockImplementation(async(...args)=>{
    const engine=await create(...args),phase=context;
    if(phase){
      const entry={...phase,checkedSteps:0,actualModes:[] as {tileId:string;bodyType:number}[]};modeEvidence.push(entry);
      const step=engine.step,dispose=engine.dispose;
      engine.step=()=>{
        for(const [id,{body}] of engine.bodies){
          const wanted=id===phase.movingTileId?RigidBodyType.KinematicPositionBased:phase.heldTileIds.includes(id)?RigidBodyType.Fixed:RigidBodyType.Dynamic;
          if(body.bodyType()!==wanted)throw new Error(`Unexpected ${phase.phase} mode: ${id}`);
        }
        entry.checkedSteps++;step();
      };
      engine.dispose=()=>{entry.actualModes=[...engine.bodies].map(([tileId,{body}])=>({tileId,bodyType:body.bodyType()}));dispose();};
    }
    return engine;
  });
  vi.spyOn(motions,"simulateHeldMotion").mockImplementation(async(...args)=>{
    const watched=args[3].some(h=>h.tileId===receiverId)&&args[2].some(id=>id.startsWith("upper-"));
    if(watched)context={phase:"carry",seed:args[6],heldTileIds:args[3].map(h=>h.tileId),movingTileId:args[3].find(h=>args[2].includes(h.tileId))!.tileId};
    const result=await motion(...args);context=undefined;
    if(watched){
      const entry=modeEvidence.at(-1)!;entry.status=result.status;entry.settledSteps=result.settledSteps;
      expect(result.heldTileIds).toHaveLength(2);expect(result.heldTileIds).toContain(receiverId);
      const before=args[1]!.bodies.find(b=>b.referenceTile.id===receiverId)!,after=result.state?.bodies.find(b=>b.referenceTile.id===receiverId);
      if(after){expect(after.position).toEqual(before.position);expect(after.rotation).toEqual(before.rotation);}
    }
    return result;
  });
  vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
    const joined=args[0].connections.some(c=>(c.fromTileId.startsWith("upper-")&&c.toTileId.startsWith("support-"))||(c.toTileId.startsWith("upper-")&&c.fromTileId.startsWith("support-")));
    const watched=args[0].tiles.length===12&&(joined||args[1].includes(receiverId)&&args[1].some(id=>id.startsWith("upper-")));
    if(watched)context={phase:joined?(args[1].length?"connected":"free"):"handoff",seed:args[3],heldTileIds:args[1]};
    const result=await support(...args);context=undefined;
    if(watched){const entry=modeEvidence.at(-1)!;entry.status=result.status;entry.settledSteps=result.settledSteps;}
    return result;
  });
  const started=Date.now();
  let result:Awaited<ReturnType<typeof evaluateAssembly>>;
  try{result=await evaluateAssembly(replica);}finally{vi.restoreAllMocks();}
  const transfer=result.find(s=>s.stageId==="medium-upper-transfer")!;
  if(transfer.status==="pass")for(const seed of [0,17,53]){
    const carry=modeEvidence.find(e=>e.phase==="carry"&&e.seed===seed&&e.status==="pass")!;
    expect(carry.checkedSteps).toBeGreaterThan(0);expect(carry.heldTileIds).toHaveLength(2);expect(carry.heldTileIds).toContain(receiverId);
    const free=modeEvidence.find(e=>e.phase==="free"&&e.seed===seed&&e.status==="pass")!;
    expect(free.heldTileIds).toEqual([]);expect(free.settledSteps).toBeGreaterThanOrEqual(90);
    expect(free.actualModes.every(b=>b.bodyType===RigidBodyType.Dynamic)).toBe(true);
  }
  await writeFile("/tmp/magnatiles-compact-supported-transfer.json",JSON.stringify({
    scope:"Fresh compact thirteen-panel hypothesis, including failed attempts. No complete topology, exact source pieces, measured human grip or independent-source acceptance.",
    inputSha256:createHash("sha256").update(input).digest("hex"),validationCodeHash:await validationCodeHash(),elapsedMs:Date.now()-started,
    receiverId,replica,modeEvidence,result,
  },null,2)+"\n");
  console.log(result.map(s=>({stage:s.stageId,status:s.status,detail:s.detail})));
});
