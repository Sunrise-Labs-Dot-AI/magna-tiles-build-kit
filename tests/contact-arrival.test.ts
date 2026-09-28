import { describe, expect, it } from "vitest";
import { connectionId } from "@/lib/engine/build";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { add } from "@/lib/engine/math";
import { exactContactArrival } from "@/lib/replication/contact-arrival";
import { findHandContacts } from "@/lib/replication/grip";
import { simulateHeldMotion } from "@/lib/replication/held-motion";
import { simulateSupport } from "@/lib/replication/support";
import { tileQuaternion } from "@/lib/replication/rotation-clearance";
import { unsupportedHingeFixture } from "./fixtures/rigid-contact";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

function fixture() {
  const target=unsupportedHingeFixture(),roof=target.tiles.find(t=>t.id==="roof")!,wall=target.tiles.find(t=>t.id!=="roof")!;
  const path={id:"arrival",movingTileIds:[roof.id],fixedTileIds:[wall.id],offsets:[{x:0,y:-1.5,z:0},{x:0,y:0,z:0}]};
  const hands=findHandContacts(target,path,roof.id,wall.id,0)!;
  const build: BuildGraph={...target,connections:[],tiles:target.tiles.map(t=>t.id===roof.id?{...t,position:add(t.position,path.offsets[0])}:t)};
  const start=build.tiles.find(t=>t.id===roof.id)!,q=tileQuaternion(roof);
  const waypoints=[{seconds:0,position:start.position,rotation:q},{seconds:.1,position:start.position,rotation:q},{seconds:1.6,position:roof.position,rotation:q}];
  return {target,build,roof,wall,hands,waypoints};
}

describe("named contact arrival is separate from structural acceptance",()=>{
  it("records actual separated dwell and arrival with joints absent, then rejects the unsupported connected hinge",async()=>{
    const {target,build,roof,wall,hands,waypoints}=fixture();
    expect(hands).not.toBeNull();
    const arrival=await simulateHeldMotion(build,undefined,[roof.id],hands,waypoints,0,0,Infinity,[[roof.id],[wall.id]],{connections:target.connections,separationWaypoint:0});
    expect(arrival.status,arrival.detail).toBe("pass");
    expect(arrival.completion).toBe("contact-arrival");
    expect(arrival.settledSteps).toBeLessThan(90);
    const checkpoint=arrival.separationCheckpoint!;
    expect(checkpoint.waypointIndex).toBe(0);
    expect(checkpoint.requestedSeconds).toBe(0);
    expect(checkpoint.sampledSeconds).toBeGreaterThan(0);
    expect(checkpoint.sampledSeconds).toBeLessThan(.1);
    expect(checkpoint.separations.map(s=>s.connectionId)).toEqual(target.connections.map(connectionId));
    expect(checkpoint.separations.every(s=>s.gap>1)).toBe(true);
    expect(checkpoint.tiles.find(t=>t.id===roof.id)!.position.y).toBeCloseTo(build.tiles.find(t=>t.id===roof.id)!.position.y,5);
    expect(arrival.state!.joints).toEqual([]);
    expect(arrival.state!.connections).toEqual([]);
    const continued=await createEngineWorld(arrival.settled,{drop:false,floorY:0,state:arrival.state});
    try { expect(continued.snapshot()).toEqual(arrival.state); } finally { continued.dispose(); }
    const joined={...arrival.settled,connections:target.connections};
    const supported=await simulateSupport(joined,[wall.id],0,0,Infinity,arrival.state,[hands.find(h=>h.tileId===wall.id)!]);
    expect(supported.status).toBe("fail");
    expect(supported.peakDisplacement).toBeGreaterThan(.95);
    const released=await simulateSupport(joined,[],0,0,Infinity,arrival.state,[]);
    expect(released.status).toBe("fail");
  });
  it.each(["no-dwell","missing-join","wrong-edge","duplicate-join","pre-attached","already-closed"])("rejects %s without a rest or arrival certificate",async mode=>{
    const {target,build,roof,wall,hands,waypoints}=fixture();
    let connections=target.connections;
    if(mode==="no-dwell") waypoints[1].position=add(waypoints[1].position,{x:0,y:.1,z:0});
    if(mode==="missing-join") connections=[];
    if(mode==="wrong-edge") connections=[{...connections[0],fromEdge:99}];
    if(mode==="duplicate-join") connections=[...connections,...connections];
    if(mode==="pre-attached") build.connections=target.connections;
    if(mode==="already-closed") {
      build.tiles=target.tiles;
      waypoints[0].position=roof.position;waypoints[1].position=roof.position;
    }
    const trial=await simulateHeldMotion(build,undefined,[roof.id],hands,waypoints,0,0,Infinity,[[roof.id],[wall.id]],{connections,separationWaypoint:0});
    expect(trial.status,trial.detail).toBe("fail");
    expect(trial.completion).toBe("incomplete");
  });
  it("rejects an undeclared extra actual contact and accepts canonical reversal only once",()=>{
    const {target,roof}=fixture(),c=target.connections[0];
    const reversed={...c,fromTileId:c.toTileId,toTileId:c.fromTileId,fromEdge:c.toEdge,toEdge:c.fromEdge};
    expect(exactContactArrival(target,new Set([roof.id]),[reversed]).status).toBe("pass");
    expect(exactContactArrival(target,new Set([roof.id]),[c,reversed]).status).toBe("fail");
    const wall=target.tiles.find(t=>t.id!==roof.id)!;
    const extra={...target,tiles:[...target.tiles,{...wall,id:"extra-wall"}]};
    expect(exactContactArrival(extra,new Set([roof.id]),[c]).status).toBe("fail");
  });
});
