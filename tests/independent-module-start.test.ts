import { afterEach,describe,expect,it,vi } from "vitest";
import { assemble,square,v } from "@/lib/replication/geometry";
import { checkClosure,evaluateAssembly } from "@/lib/replication/assembly";
import { findInsertionPath } from "@/lib/replication/insertion";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import { assemblyUFixture } from "./fixtures/assembly";
import * as supports from "@/lib/replication/support";
import * as workspaces from "@/lib/replication/workspace";
import type { EngineState } from "@/lib/engine/rapier-world";

afterEach(()=>vi.restoreAllMocks());

const fixture=()=>{
  const r=assemblyUFixture(),first=r.build.tiles[0],second=r.build.tiles[1];
  const obstacle=square("obstacle",v(8,.09,8),v(3,0,0),v(0,0,3),"blue",1,"obstacle");
  const build=assemble("independent","Independent panel beside released obstacle",[first,obstacle],"tower");
  const path=findInsertionPath(build,[first.id],[obstacle.id])!;
  return {r,first,second,obstacle,build,path,groups:[[first.id],[obstacle.id]]};
};

describe("first held placement in an independent workspace component",()=>{
  it("accepts a declared first part while retaining every unrelated obstacle",()=>{
    const {build,path,groups}=fixture(),before=structuredClone(build);
    expect(checkClosure(build,path,groups).status).toBe("pass");
    expect(checkClosure(build,path).status).toBe("fail");
    expect(build).toEqual(before);
  });
  it("rejects missing, duplicate, overlapping and cross-group moving parts",()=>{
    const {build,path,groups,first,obstacle}=fixture();
    expect(checkClosure(build,path,[[first.id]]).status).toBe("fail");
    expect(checkClosure(build,path,[...groups,[first.id]]).status).toBe("fail");
    expect(checkClosure(build,{...path,movingTileIds:[first.id,obstacle.id],fixedTileIds:[]},groups).status).toBe("fail");
    const overlap={...build,tiles:[first,{...first,id:obstacle.id}]};
    expect(checkClosure(overlap,path,groups).status).toBe("fail");
  });
  it("requires a separated new join within the component for every later part",()=>{
    const {first,second,obstacle}=fixture();
    const build=assemble("later","Second part beside an obstacle",[first,second,obstacle],"tower");
    const path=findInsertionPath(build,[second.id],[first.id,obstacle.id])!;
    const groups=[[first.id,second.id],[obstacle.id]];
    expect(checkClosure(build,path,groups).status).toBe("pass");
    expect(checkClosure({...build,connections:[]},path,groups).status).toBe("fail");
    expect(checkClosure(build,{...path,offsets:[v(0,0,0),v(0,0,0)]},groups).status).toBe("fail");
    expect(checkClosure(build,path,[[first.id],[second.id,obstacle.id]]).status).toBe("fail");
  });
  it("rejects an undeclared magnetic join to another component at either endpoint",()=>{
    const {first,second}=fixture();
    const build=assemble("touching","Touching independent panels",[first,second],"tower");
    build.connections=[];
    const path=findInsertionPath(build,[second.id],[first.id])!;
    const groups=[[first.id],[second.id]];
    expect(checkClosure(build,path,groups)).toMatchObject({status:"fail",detail:"Independent workspace components have unearned magnetic contact."});
    const separated={...build,tiles:[first,{...second,position:{...second.position,y:second.position.y+6}}]};
    expect(checkClosure(separated,{...path,offsets:[v(0,-6,0),v(0,0,0)]},groups).detail).toMatch(/another workspace component/);
  });
  it("allows a nearby but unclosed independent component at either endpoint",()=>{
    const {first,second}=fixture();
    const nearby={...second,position:{...second.position,x:second.position.x+.4}};
    expect(findMagneticEdgeMatch(first,nearby)).not.toBeNull();
    const build={...assemble("nearby","Separated near-edge proposals",[first,nearby],"tower"),connections:[]};
    const groups=[[first.id],[second.id]],path={id:"near",movingTileIds:[second.id],fixedTileIds:[first.id],offsets:[v(0,6,0),v(0,0,0)]};
    expect(checkClosure(build,path,groups).status).toBe("pass");
    const high={...build,tiles:[first,{...nearby,position:{...nearby.position,y:nearby.position.y+6}}]};
    expect(checkClosure(high,{...path,offsets:[v(0,-6,0),v(0,0,0)]},groups).status).toBe("pass");
  });
  it("constructs and releases a second U without resetting or omitting the first",async()=>{
    const r=assemblyUFixture(),firstIds=r.stages[0].tileIds,second=assemblyUFixture();
    const rename=(id:string)=>`next-${id}`;
    r.build=assemble("two-u","Two independent U supports",[...r.build.tiles,...second.build.tiles.map(t=>({...t,id:rename(t.id)}))],"tower");
    r.stages.push({...second.stages[0],id:"next",tileIds:firstIds.map(rename)});
    r.construction!.push({stageId:"next",workspace:{afterStageId:"u",offset:v(6,0,0)},operations:second.construction![0].operations.map(op=>({
      ...op,tileIds:op.tileIds.map(rename),hands:op.hands!.map(h=>({...h,tileId:rename(h.tileId)})),
    }))});
    const selected=new Map<number,EngineState>(),observed=new Set<number>();
    const select=workspaces.selectWorkspace,support=supports.simulateSupport;
    vi.spyOn(workspaces,"selectWorkspace").mockImplementation((...args)=>{
      const result=select(...args);selected.set(args[2],structuredClone(result.state));return result;
    });
    vi.spyOn(supports,"simulateSupport").mockImplementation(async(...args)=>{
      if(selected.has(args[3])&&!observed.has(args[3])){
        expect(args[5]).toEqual(selected.get(args[3]));
        expect(args[0].tiles.map(t=>t.id).sort()).toEqual([...firstIds].sort());
        observed.add(args[3]);
      }
      return support(...args);
    });
    const before=structuredClone(r),[previous,next]=await evaluateAssembly(r);
    expect(previous.status,previous.detail).toBe("pass");
    expect(next.status,next.detail).toBe("pass");
    expect(next.operations).toHaveLength(9);
    expect(next.checkpoints).toHaveLength(3);
    expect([...observed].sort((a,b)=>a-b)).toEqual([0,17,53]);
    for(const [i,seed] of [0,17,53].entries()){
      const first=next.operations.find(o=>o.seed===seed&&o.index===0)!;
      expect(first.trials[0].motion[0].tiles).toEqual(previous.checkpoints[i].motion.at(-1)!.tiles);
      expect(first.trials[0].heldTileIds).toEqual([]);
      expect(first.carry!.dynamicTileCount).toBe(3);
      expect(first.carry!.motion.every(frame=>firstIds.every(id=>frame.tiles.some(t=>t.id===id)))).toBe(true);
      expect(next.checkpoints[i].dynamicTileCount).toBe(6);
      expect(next.checkpoints[i].heldTileIds).toEqual([]);
      expect(next.checkpoints[i].solidFailures).toEqual([]);
    }
    expect(r).toEqual(before);
  },120000);
});
