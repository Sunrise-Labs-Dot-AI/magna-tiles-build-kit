import { afterEach,describe,expect,it,vi } from "vitest";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { assemble,square,v } from "@/lib/replication/geometry";
import { checkHandTransition,edgeGrips } from "@/lib/replication/grip";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { transformLocal } from "@/lib/engine/math";
import { assemblyUFixture } from "./fixtures/assembly";
import { closedShell } from "./fixtures/closed-shell";
import * as grips from "@/lib/replication/grip";
import * as supports from "@/lib/replication/support";

afterEach(()=>vi.restoreAllMocks());

const fourthWall=()=>{
  const r=assemblyUFixture(),wall=closedShell(1).tiles.find(t=>t.id==="z-0-1")!;
  r.build=assemble("four-walls","Four walls",[...r.build.tiles,wall],"tower");
  r.stages[0].tileIds.push(wall.id);
  const hand=edgeGrips(wall).sort((a,b)=>transformLocal(b.localPoint,wall.position,wall.basis!).y-transformLocal(a.localPoint,wall.position,wall.basis!).y)[0];
  r.construction![0].operations.push({tileIds:[wall.id],hands:[hand,structuredClone(r.construction![0].operations[1].hands![0])]});
  return r;
};

describe("ordinary support-hand transitions",()=>{
  it("rejects acquiring a third unrelated grip while both previous hands remain occupied",async()=>{
    const [result]=await evaluateAssembly(fourthWall());
    expect(result.status,result.detail).toBe("fail");
    const rows=result.rejectedAttempts.flatMap(a=>a.operations).filter(o=>o.index===3);
    expect(rows).toHaveLength(6);
    for(const row of rows){
      expect(row.detail).toMatch(/third hand/);
      expect(row.trials).toEqual([]);
      expect(row.carry).toBeUndefined();
      expect(row.handTransitions![0]).toMatchObject({status:"fail",beforeTrial:0});
    }
  },120000);
  it("accepts an explicit free checkpoint before acquiring the new support grip",async()=>{
    const r=fourthWall();r.construction![0].operations[2].releaseAfter=true;
    const [result]=await evaluateAssembly(r);
    expect(result.status,result.detail).toBe("pass");
    for(const seed of [0,17,53]){
      const released=result.operations.find(o=>o.seed===seed&&o.index===2)!;
      const acquired=result.operations.find(o=>o.seed===seed&&o.index===3)!;
      expect(released.trials.at(-1)!.heldTileIds).toEqual([]);
      expect(acquired.handTransitions![0]).toMatchObject({status:"pass",previousHands:[],beforeTrial:0});
      expect(acquired.handTransitions![0].nextHands.map(h=>h.tileId)).toEqual([r.build.tiles[1].id]);
      expect(acquired.trials[0].motion[0].tiles).toEqual(released.trials.at(-1)!.motion.at(-1)!.tiles);
    }
    expect(result.checkpointHandTransitions).toHaveLength(3);
    expect(result.checkpointHandTransitions!.every(t=>t.status==="pass"&&t.previousHands.length===2&&t.nextHands.length===0)).toBe(true);
    expect(result.checkpoints.every(t=>t.dynamicTileCount===4&&t.heldTileIds.length===0)).toBe(true);
  },120000);
  it("rejects a same-panel regrasp and blocked withdrawal of an old hand",()=>{
    const r=assemblyUFixture(),hands=r.construction![0].operations[1].hands!;
    const build={...r.build,tiles:r.build.tiles.filter(t=>hands.some(h=>h.tileId===t.id))};
    expect(checkHandTransition(build,hands,[hands[1]],0).status).toBe("pass");
    const changed={...hands[1],localPoint:{...hands[1].localPoint,x:hands[1].localPoint.x+.1}};
    expect(checkHandTransition(build,hands,[changed],0).detail).toMatch(/regrasp/);
    const blocker=square("withdrawal-blocker",v(-1.5,4.1,-4.5),v(3,0,0),v(0,0,3),"red",1,"obstacle");
    const blocked={...build,tiles:[...build.tiles,blocker]};
    expect(checkHandTransition(blocked,[],[hands[1]],0).status).toBe("pass");
    expect(checkHandTransition(blocked,hands,[hands[1]],0).detail).toContain("withdrawal-blocker");
    expect(checkHandTransition(blocked,hands,[],0).status).toBe("fail");
  });
  it("does not mutate caller state and propagates budget expiry",()=>{
    const r=assemblyUFixture(),hands=r.construction![0].operations[0].hands!,before=structuredClone(r);
    const result=checkHandTransition(r.build,[],hands,0);
    expect(result.status).toBe("pass");result.nextHands[0].localPoint.x+=100;
    expect(r).toEqual(before);
    expect(()=>checkHandTransition(r.build,hands,[],0,0)).toThrow(SimulationBudgetExceeded);
  });
  it("rejects blocked final withdrawal before the mandatory free trial",async()=>{
    const check=grips.checkHandTransition,support=supports.simulateSupport;
    const blocker=square("checkpoint-blocker",v(.2,4.1,-1.5),v(3,0,0),v(0,0,3),"red",1,"obstacle");
    vi.spyOn(grips,"checkHandTransition").mockImplementation((build,old,next,...rest)=>
      check(old.length===2&&!next.length?{...build,tiles:[...build.tiles,blocker]}:build,old,next,...rest));
    const simulate=vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>support(...args));
    const [result]=await evaluateAssembly(assemblyUFixture());
    expect(result.status).toBe("fail");
    expect(simulate.mock.calls.some(args=>!args[1].length)).toBe(false);
    for(const attempt of result.rejectedAttempts){
      expect(attempt.checkpoints).toEqual([]);
      expect(attempt.checkpointHandTransitions).toHaveLength(3);
      expect(attempt.checkpointHandTransitions!.every(t=>t.status==="fail"&&t.detail.includes("checkpoint-blocker"))).toBe(true);
    }
  },120000);
});
