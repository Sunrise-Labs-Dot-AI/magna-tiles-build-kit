import {describe,expect,it} from "vitest";
import {assemble,square,v} from "@/lib/replication/geometry";
import {joinComponentGroups} from "@/lib/replication/components";
import type {MagneticConnection} from "@/lib/magnetic-tiles/types";

const fixture=()=>assemble("groups","Three separate panels",[0,6,12].map((x,i)=>
  square(`panel-${i}`,v(x,.09,0),v(3,0,0),v(0,0,3),"blue",1,"fixture")),"tower");
const groups=()=>[["panel-0"],["panel-1"],["panel-2"]];
const edge=(from="panel-0",to="panel-1"):MagneticConnection=>({kind:"edge",fromTileId:from,fromEdge:1,toTileId:to,toEdge:3});

describe("derive only the earned neighbor component merge",()=>{
  it("proposes one neighbor merge while retaining every untouched group without mutation",()=>{
    const build=fixture(),before=structuredClone(build),partition=groups(),original=structuredClone(partition);
    const result=joinComponentGroups(build,partition,["panel-0"],[edge()]);
    expect(result.status,result.detail).toBe("pass");
    expect(result.groups).toEqual([["panel-0","panel-1"],["panel-2"]]);
    result.groups[0].push("later");
    expect(partition).toEqual(original);expect(build).toEqual(before);
  });
  it.each(["missing-group","duplicate-group","incomplete-moving","duplicate-moving","missing-edge","missing-endpoint","within-group","fixed-to-fixed","two-neighbors","duplicate-edge","reversed-duplicate"])("rejects %s",mode=>{
    const build=fixture(),partition=groups();let moving=["panel-0"],edges=[edge()];
    if(mode==="missing-group")partition.pop();
    if(mode==="duplicate-group")partition.push(["panel-0"]);
    if(mode==="incomplete-moving")moving=["absent"];
    if(mode==="duplicate-moving")moving.push("panel-0");
    if(mode==="missing-edge")edges=[];
    if(mode==="missing-endpoint")edges=[edge("panel-0","absent")];
    if(mode==="within-group")edges=[edge("panel-0","panel-0")];
    if(mode==="fixed-to-fixed")edges=[edge("panel-1","panel-2")];
    if(mode==="two-neighbors")edges.push(edge("panel-0","panel-2"));
    if(mode==="duplicate-edge")edges.push(edge());
    if(mode==="reversed-duplicate")edges.push({...edge(),fromTileId:"panel-1",fromEdge:3,toTileId:"panel-0",toEdge:1});
    const result=joinComponentGroups(build,partition,moving,edges);
    expect(result.status).toBe("fail");expect(result.groups).toEqual([]);
  });
});
