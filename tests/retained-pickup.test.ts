import { afterEach,describe,expect,it,vi } from "vitest";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { GRIP_PROXY, sameHandContact } from "@/lib/replication/grip";
import * as grips from "@/lib/replication/grip";
import * as motion from "@/lib/replication/held-motion";
import { scale } from "@/lib/engine/math";
import { square, v } from "@/lib/replication/geometry";
import { assemblyUFixture } from "./fixtures/assembly";

afterEach(()=>vi.restoreAllMocks());
const fixture=()=>{
  const r=assemblyUFixture(),ops=r.construction![0].operations;
  const hand=structuredClone(ops[2].hands![1]);
  hand.approachOffsets=[scale(hand.localOutward,GRIP_PROXY.approachLength),v(0,0,0)];
  ops[2].pickup={height:.5,hand};
  ops[2].releaseAfter=true;
  return r;
};
const allOperations=(result:Awaited<ReturnType<typeof evaluateAssembly>>[number])=>[...result.operations,...result.rejectedAttempts.flatMap(a=>a.operations)];

describe("physical grip identity",()=>{
  it("normalizes default approach and property ordering without permitting a regrasp",()=>{
    const hand=fixture().construction![0].operations[2].pickup!.hand;
    const explicit={proxy:hand.proxy,localOutward:{z:hand.localOutward.z,y:hand.localOutward.y,x:hand.localOutward.x},
      localPoint:{z:hand.localPoint.z,x:hand.localPoint.x,y:hand.localPoint.y},tileId:hand.tileId,
      approachOffsets:[scale(hand.localOutward,GRIP_PROXY.approachLength),v(0,0,0)]};
    expect(sameHandContact(hand,explicit)).toBe(true);
    expect(sameHandContact(explicit,hand)).toBe(true);
    for(const field of ["localPoint","localOutward"] as const) {
      const changed=structuredClone(explicit);changed[field].x+=1e-9;expect(sameHandContact(hand,changed)).toBe(false);
    }
    const changed=structuredClone(explicit);changed.approachOffsets[0].z+=1e-9;
    expect(sameHandContact(hand,changed)).toBe(false);
    expect(sameHandContact(hand,{...hand,tileId:"another"})).toBe(false);
    expect(sameHandContact({...hand,localPoint:v(NaN,0,0)},{...hand,localPoint:v(NaN,0,0)})).toBe(false);
    expect(sameHandContact({...hand,approachOffsets:[]},{...hand,approachOffsets:[]})).toBe(false);
  });
});

describe("retained one-panel pickup",()=>{
  it("withdraws the previous second hand before lifting and requires actual final free release",async()=>{
    const r=fixture(),carry=motion.simulateHeldMotion,starts:unknown[]=[];
    vi.spyOn(motion,"simulateHeldMotion").mockImplementation(async(...args)=>{
      if(args[2].length===2)starts.push({build:structuredClone(args[0]),state:structuredClone(args[1]),hands:structuredClone(args[3])});
      return carry(...args);
    });
    const [result]=await evaluateAssembly(r);
    expect(result.status,result.detail).toBe("pass");
    const rows=result.operations.filter(o=>o.index===2);
    expect(rows).toHaveLength(3);expect(starts).toHaveLength(3);
    for(const [i,row] of rows.entries()) {
      expect(row.pickupHandoff?.status,row.detail).toBe("pass");
      expect(row.pickupHandoff!.previousHands).toHaveLength(2);
      expect(row.pickupHandoff!.retainedHands).toHaveLength(1);
      expect(row.timeline![0]).toMatchObject({phase:"support",index:0});
      expect(row.timeline![1].phase).toBe("pickup");
      expect(row.trials[0].heldTileIds).toEqual([r.build.tiles[0].id]);
      expect(row.trials[0].dynamicTileCount).toBe(1);
      expect(row.trials[0].status).toBe("pass");
      expect(row.pickup!.motion[0].tiles).toEqual(row.trials[0].motion.at(-1)!.tiles);
      expect((starts[i] as {build:{tiles:unknown[]}}).build.tiles).toEqual(row.trials[0].motion.at(-1)!.tiles);
      expect(row.pickup!.dynamicTileCount).toBe(1);
      expect(row.trials[1].heldTileIds).toHaveLength(1);
      expect(row.trials.at(-1)!.heldTileIds).toEqual([]);
      expect(row.trials.at(-1)!.dynamicTileCount).toBe(3);
      expect(row.trials.at(-1)!.status,row.detail).toBe("pass");
    }
  },120000);

  it.each(["regrasp","previous-regrasp","zero-height","too-high","absent-panel","duplicate-hand","third-hand"])("rejects %s without lifting",async mode=>{
    const r=fixture(),ops=r.construction![0].operations,last=ops[2];
    if(mode==="regrasp")last.pickup!.hand.localPoint.x+=.1;
    if(mode==="previous-regrasp"){
      last.pickup!.hand.localPoint.x+=.1;last.hands![1]=structuredClone(last.pickup!.hand);
    }
    if(mode==="zero-height")last.pickup!.height=0;
    if(mode==="too-high")last.pickup!.height=.91;
    if(mode==="absent-panel")last.pickup!.hand.tileId="absent";
    if(mode==="duplicate-hand")last.hands!.push(structuredClone(last.hands![1]));
    if(mode==="third-hand")last.hands!.push(structuredClone(ops[1].hands![0]));
    const carry=motion.simulateHeldMotion;
    const spy=vi.spyOn(motion,"simulateHeldMotion").mockImplementation(async(...args)=>carry(...args));
    const [result]=await evaluateAssembly(r);
    expect(result.status).toBe("fail");
    expect(allOperations(result).filter(o=>o.index===2).every(o=>o.status==="fail"&& !o.pickup)).toBe(true);
    expect(spy.mock.calls.some(args=>args[2].length>1)).toBe(false);
  },120000);

  it("rejects blocked withdrawal of an inherited second hand before motion",async()=>{
    const access=grips.checkHandAccess,carry=motion.simulateHeldMotion;
    // Inject a real obstacle into the inherited access snapshot. It intersects
    // the old second hand's outward path, while the retained hand still clears.
    const blocker=square("withdrawal-blocker",v(-1.5,4.1,-4.5),v(3,0,0),v(0,0,3),"red",1,"obstacle");
    const accessSpy=vi.spyOn(grips,"checkHandAccess").mockImplementation((...args)=>{
      if(args[1].id!=="pickup-withdrawal" || args[2].length!==2)return access(...args);
      const build={...args[0],tiles:[...args[0].tiles,blocker]},path={...args[1],fixedTileIds:[...args[1].fixedTileIds,blocker.id]};
      expect(access(build,path,[args[2][0]],args[3]).status).toBe("pass");
      return access(build,path,args[2],args[3]);
    });
    const carrySpy=vi.spyOn(motion,"simulateHeldMotion").mockImplementation(async(...args)=>carry(...args));
    const [result]=await evaluateAssembly(fixture());
    expect(result.status).toBe("fail");
    const rows=allOperations(result).filter(o=>o.index===2);
    expect(rows).toHaveLength(6);
    for(const row of rows){expect(row.pickupHandoff?.status).toBe("fail");expect(row.detail).toContain("withdrawal-blocker");expect(row.pickup).toBeUndefined();}
    expect(accessSpy.mock.calls.filter(args=>args[1].id==="pickup-withdrawal")).toHaveLength(6);
    expect(carrySpy.mock.calls.some(args=>args[2].length>1)).toBe(false);
  },120000);
});
