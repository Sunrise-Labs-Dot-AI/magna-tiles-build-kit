import { describe, expect, it } from "vitest";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { add, distance, multiplyQuaternions, quaternionAngle, subtract } from "@/lib/engine/math";
import { assemble, rigidPanel, square, v } from "@/lib/replication/geometry";
import { edgeGrips } from "@/lib/replication/grip";
import { simulatePreparedTransfer, transferTarget, transferWaypoints } from "@/lib/replication/prepared-transfer";
import { tileQuaternion } from "@/lib/replication/rotation-clearance";
import { selectWorkspace, workspaceBuild, type PreparedWorkspace } from "@/lib/replication/workspace";
import { supportSnapshot } from "@/lib/replication/support";
import { simulateSupport } from "@/lib/replication/support";
import { componentContacts } from "@/lib/replication/components";
import { simulateGravitySeat } from "@/lib/replication/seating";
import { closedShell } from "./fixtures/closed-shell";
import { simulateHeldMotion } from "@/lib/replication/held-motion";
import { unsupportedHingeFixture } from "./fixtures/rigid-contact";

const build = () => assemble("workspace","Independent panel",[square("panel",v(-1.5,2,-1.5),v(3,0,0),v(0,0,3),"red",1,"moving")],"tower");

async function workspace(): Promise<PreparedWorkspace> {
  const graph = build(), engine = await createEngineWorld(graph,{ drop: false,floorY: 0 });
  try {
    const body = engine.bodies.get("panel")!.body;
    body.setBodyType(RigidBodyType.Fixed,true);
    return { id: "first:17",stageId: "first",seed: 17,lineage: [],floorY: 0,constructionOffset: v(0,0,0),
      build: supportSnapshot(graph,engine),state: engine.snapshot(),hands: [edgeGrips(graph.tiles[0])[0]],components: [["panel"]] };
  } finally { engine.dispose(); }
}

describe("one continuous prepared workspace", () => {
  it("changes only coordinate labels for the table while preserving the exact world state", async () => {
    const w = await workspace(), original = structuredClone(w);
    const rebased = workspaceBuild(w,-.13), engine = await createEngineWorld(rebased,{ drop: false,floorY: -.13,state: w.state });
    try {
      expect(engine.snapshot()).toEqual(w.state);
      expect(w).toEqual(original);
      expect(rebased.tiles[0].position.x).toBe(w.build.tiles[0].position.x);
      expect(rebased.tiles[0].position.z).toBe(w.build.tiles[0].position.z);
      expect(rebased.tiles[0].position.y).toBeCloseTo(w.build.tiles[0].position.y-.13);
    } finally { engine.dispose(); }
  });
  it.each(["missing-body","reset-pose","stale-physics","omitted-hand","extra-hand","missing-connection"])("rejects %s", async mode => {
    const w = await workspace();
    if (mode === "missing-body") w.build.tiles=[];
    if (mode === "reset-pose") w.build.tiles[0].position.x+=.01;
    if (mode === "stale-physics") w.state.physicsModel="old";
    if (mode === "omitted-hand") w.hands=[];
    if (mode === "extra-hand") w.hands.push({ ...w.hands[0],tileId:"missing" });
    if (mode === "missing-connection") w.state.connections.push({ kind:"edge",fromTileId:"panel",toTileId:"missing",fromEdge:0,toEdge:0 });
    expect(()=>workspaceBuild(w,0)).toThrow();
  });
  it("requires the matching seed, required history and latest ownership instead of merging branches", async () => {
    const first = await workspace(), latest = { ...structuredClone(first),id:"second:17",stageId:"second",predecessorId:first.id,lineage:[first.id] };
    expect(selectWorkspace([first,latest],"second",17,["first"])).toBe(latest);
    expect(()=>selectWorkspace([first,latest],"first",17,[])).toThrow(/stale branch/);
    expect(()=>selectWorkspace([first,latest],"second",53,["first"])).toThrow();
    expect(()=>selectWorkspace([first,latest],"second",17,["independent"])).toThrow(/history/);
  });
  it("keeps an actual deformed module intact in a separate rigid target proposal", () => {
    const nominal = build(), actual = build();
    const neighbor = { ...structuredClone(actual.tiles[0]),id:"neighbor",position:v(3.27,2.04,6) };
    actual.tiles[0].position.z=6; actual.tiles.push(neighbor);
    nominal.tiles.push({ ...neighbor,position:v(3,2,0) });
    actual.tiles[0].basis={ xAxis:v(0,1,0),yAxis:v(0,0,1),zAxis:v(1,0,0) };
    neighbor.basis=structuredClone(actual.tiles[0].basis);
    const unchanged=structuredClone(actual),target=transferTarget(nominal,actual,["panel","neighbor"],"panel");
    expect(actual).toEqual(unchanged);
    expect(distance(target.tiles[0].position,target.tiles[1].position)).toBeCloseTo(distance(actual.tiles[0].position,actual.tiles[1].position),10);
    expect(target.tiles[1].position).not.toEqual(nominal.tiles[1].position);
    expect(quaternionAngle(tileQuaternion(target.tiles[0]),tileQuaternion(nominal.tiles[0]))).toBeLessThan(1e-6);
    const path={ id:"approach",movingTileIds:["panel","neighbor"],fixedTileIds:[],offsets:[v(0,1,0),v(0,0,0)] };
    const points=transferWaypoints(actual,target,"panel",path,0,6.5);
    expect(points[0].position).toEqual(actual.tiles[0].position);
    expect(points.at(-1)!.position).toEqual(target.tiles[0].position);
    for(let i=1;i<points.length;i++) {
      const dt=points[i].seconds-points[i-1].seconds;
      expect(distance(points[i].position,points[i-1].position)/dt).toBeLessThanOrEqual(2);
      expect(quaternionAngle(points[i].rotation,points[i-1].rotation)/dt).toBeLessThanOrEqual(1);
    }
    expect(subtract(points[1].position,points[0].position).z).toBe(0);
  });
  it("checks named independent groups without forgiving missing internal joins or obstacles", async () => {
    const shell=closedShell(1), other=square("other",v(-1.5,.09,5),v(3,0,0),v(0,0,3),"blue",1,"other");
    const graph={ ...shell,tiles:[...shell.tiles,other] },groups=[shell.tiles.map(t=>t.id),[other.id]];
    expect(componentContacts(graph,groups).status).toBe("pass");
    const pass=await simulateSupport(graph,[],0,0,Infinity,undefined,[],groups);
    expect(pass.status,pass.detail).toBe("pass");
    expect(componentContacts(graph,[groups[0]]).status).toBe("fail");
    expect(componentContacts(graph,[...groups,[other.id]]).status).toBe("fail");
    expect(componentContacts({ ...graph,connections:[] },groups).status).toBe("fail");
    const overlapping={ ...graph,tiles:[...shell.tiles,{ ...other,position:shell.tiles[0].position,basis:shell.tiles[0].basis }] };
    expect(componentContacts(overlapping,groups).status).toBe("fail");
  });
  it("places a new panel on the table beside an existing module and counts only the new panel's bearing", async () => {
    const base=square("existing",v(-1.5,.09,-1.5),v(3,0,0),v(0,0,3),"blue",1,"existing");
    const incoming=square("incoming",v(-1.5,.09,5),v(3,0,0),v(0,0,3),"red",2,"incoming");
    const graph=assemble("table-workspace","Independent table placement",[base,incoming],"tower");
    const trial=await simulateGravitySeat(graph,[incoming.id],[edgeGrips(incoming)[0]],.55,0,17,Infinity,undefined,"table",[[base.id],[incoming.id]]);
    expect(trial.status,trial.detail).toBe("pass");
    expect(trial.tableBearingTileIds).toEqual([incoming.id]);
    expect(trial.activeJointIds).toEqual([]);
    expect(trial.earnedJointIds).toEqual([]);
    const floating={ ...graph,tiles:[base,{ ...incoming,position:{ ...incoming.position,y:5 } }] };
    const failure=await simulateGravitySeat(floating,[incoming.id],[edgeGrips(incoming)[0]],.55,0,17,Infinity,undefined,"table",[[base.id],[incoming.id]]);
    expect(failure.status).toBe("fail");
    expect(failure.tableBearingTileIds).not.toContain(base.id);
  });
  it("carries a generic four-panel triangular module around a stationary obstacle with one held panel", async () => {
    const parts=[square("roof",v(0,3.18,0),v(3,0,0),v(0,0,3),"red",1,"module"),
      square("back",v(3.09,.18,0),v(0,3,0),v(0,0,3),"blue",1,"module"),
      ...[-.09,3.09].map((z,i)=>rigidPanel(`side-${i}`,"right-triangle",[v(3,3.18,z),v(0,3.18,z),v(3,.18,z)],"green",1,"module"))];
    const moving=parts.map(t=>t.id),movingParts=parts.map(t=>({...t,position:add(t.position,v(0,2,6))}));
    const obstacle=square("obstacle",v(-1.5,.09,-1.5),v(3,0,0),v(0,0,3),"red",1,"obstacle");
    const graph=assemble("generic-transfer","Independent held module",[...movingParts,obstacle],"tower");
    const held=graph.tiles.find(t=>t.id==="side-1")!,hand=edgeGrips(held)[1],q=tileQuaternion(held);
    const rotated=multiplyQuaternions({x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2},q);
    const trial=await simulateHeldMotion(graph,undefined,moving,[hand],[
      {seconds:0,position:held.position,rotation:q},
      {seconds:2,position:{...held.position,y:6},rotation:q},
      {seconds:4,position:{...held.position,y:6},rotation:rotated},
      {seconds:7,position:v(3.5,6,5),rotation:rotated},
    ],0,17,Infinity,[moving,[obstacle.id]]);
    expect(trial.status,trial.detail).toBe("pass");
    expect(trial.dynamicTileCount).toBe(4);
    expect(trial.poppedJoints).toEqual([]);
    expect(trial.settledSteps).toBeGreaterThanOrEqual(90);
    expect(trial.state!.bodies.filter(b=>b.bodyType!==RigidBodyType.Dynamic).map(b=>b.referenceTile.id)).toEqual([held.id]);
    const end=trial.settled.tiles.find(t=>t.id===held.id)!;
    expect(distance(end.position,v(3.5,6,5))).toBeLessThan(1e-5);
    expect(quaternionAngle(tileQuaternion(end),rotated)).toBeLessThan(1e-5);
    expect(distance(trial.settled.tiles.find(t=>t.id===obstacle.id)!.position,obstacle.position)).toBeLessThan(.03);
    const resumed=await createEngineWorld(trial.settled,{drop:false,floorY:0,state:trial.state});
    try { expect(resumed.snapshot()).toEqual(trial.state); } finally { resumed.dispose(); }
  });
  it("cannot skip the two-to-one handoff or collapse different declared workspace components",async()=>{
    const pair=unsupportedHingeFixture(),obstacle=square("obstacle",v(8,.09,8),v(3,0,0),v(0,0,3),"blue",1,"obstacle");
    const graph={...pair,tiles:[...pair.tiles,obstacle]},moving=pair.tiles.map(t=>t.id),hands=pair.tiles.map(t=>edgeGrips(t)[0]);
    const engine=await createEngineWorld(graph,{drop:false,floorY:0});
    try {
      for(const id of moving) engine.bodies.get(id)!.body.setBodyType(RigidBodyType.Fixed,true);
      const state=engine.snapshot(),before=structuredClone(state);
      const single=await simulatePreparedTransfer(graph,graph,state,moving,[hands[0]],[hands[0]],6.5,0,0,Infinity,[moving,[obstacle.id]],"clear-first");
      expect(single.status).toBe("fail"); expect(single.detail).toMatch(/two prior/);
      const changed=await simulatePreparedTransfer(graph,graph,state,moving,hands,[{...hands[0],localPoint:v(99,99,0)}],6.5,0,0,Infinity,[moving,[obstacle.id]],"clear-first");
      expect(changed.status).toBe("fail"); expect(changed.handoff).toBeUndefined();
      const collapsed=await simulatePreparedTransfer(graph,graph,state,moving,hands,[hands[0]],6.5,0,0,Infinity,[graph.tiles.map(t=>t.id)],"clear-first");
      expect(collapsed.status).toBe("fail"); expect(collapsed.detail).toMatch(/component partitions/);
      expect(state).toEqual(before);
    } finally {engine.dispose();}
  });
});
