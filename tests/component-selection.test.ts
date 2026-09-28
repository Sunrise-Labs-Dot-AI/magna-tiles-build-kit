import { describe,expect,it } from "vitest";
import { movingComponent } from "@/lib/replication/components";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import { assemble } from "@/lib/replication/geometry";
import { assemblyUFixture } from "./fixtures/assembly";

function fixture(){
  const r=assemblyUFixture(),ids=r.build.tiles.map(t=>t.id),next=ids.map(id=>`next-${id}`);
  const build=assemble("two-components","Two independent supports",[...r.build.tiles,...r.build.tiles.map(t=>({
    ...t,id:`next-${t.id}`,position:{...t.position,x:t.position.x+6},
  }))],"tower");
  return {build,groups:[ids,next],ids,next};
}

describe("present component resolution",()=>{
  it("selects the complete declared component without adding support or changing the input",()=>{
    const {build,groups,ids,next}=fixture(),before=structuredClone({build,groups});
    expect(movingComponent(build,next[0],groups)).toMatchObject({status:"pass",tileIds:next});
    expect(movingComponent(build,ids[0],groups)).toMatchObject({status:"pass",tileIds:ids});
    const selected=movingComponent(build,next[0],groups);selected.tileIds.pop();
    expect({build,groups}).toEqual(before);
    const single=assemblyUFixture().build;
    expect(movingComponent(single,single.tiles[0].id)).toMatchObject({status:"pass",tileIds:ids});
  });
  it("rejects incomplete or duplicate coverage, missing grips and disconnected internal groups",()=>{
    const {build,groups,ids,next}=fixture();
    for(const partition of [[ids],[...groups,[next[0]]],[[...ids,next[0]],next.slice(1)],[[...ids,...next]]])
      expect(movingComponent(build,next[0],partition)).toMatchObject({status:"fail",tileIds:[]});
    expect(movingComponent(build,"future",groups)).toMatchObject({status:"fail",tileIds:[]});
    expect(movingComponent({...build,connections:[]},next[0],groups)).toMatchObject({status:"fail",tileIds:[]});
    expect(movingComponent(build,next[0])).toMatchObject({status:"fail",tileIds:[]});
  });
  it("rejects actual magnetic contact between independent groups even when the graph omits the join",()=>{
    const r=assemblyUFixture(),tiles=r.build.tiles.slice(0,2),build={...r.build,tiles,connections:[]};
    const result=movingComponent(build,tiles[0].id,tiles.map(t=>[t.id]));
    expect(result).toMatchObject({status:"fail",tileIds:[]});
    expect(result.detail).toContain("magnetic contact");
  });
  it("does not confuse a legacy nearby-edge proposal with a closed magnetic contact",()=>{
    const r=assemblyUFixture(),tiles=structuredClone(r.build.tiles.slice(0,2));
    tiles[1].position.x+=.4;
    expect(findMagneticEdgeMatch(tiles[0],tiles[1])).not.toBeNull();
    const result=movingComponent({...r.build,tiles,connections:[]},tiles[0].id,tiles.map(t=>[t.id]));
    expect(result).toMatchObject({status:"pass",tileIds:[tiles[0].id]});
  });
});
