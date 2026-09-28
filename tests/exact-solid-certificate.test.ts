import { afterEach, describe, expect, it, vi } from "vitest";
import { solidCertificateIdentity, sameSolidCertificate } from "@/lib/engine/solid-certificate";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { COLLISION_SUBSTEPS } from "@/lib/engine/constants";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import * as solids from "@/lib/magnetic-tiles/swept-prisms";
import { assemble, square, v } from "@/lib/replication/geometry";
import { supportSnapshot } from "@/lib/replication/support";

const panel = (id="panel",x=0) => square(id,v(x-1.5,4,-1.5),v(3,0,0),v(0,0,3),"blue",1,"panel");
afterEach(() => vi.restoreAllMocks());

describe("exact engine-local solid certificates", () => {
  it("copies all consumed geometry and requires exact finite identity", () => {
    const poses = [solids.prismPose(panel())], key = solidCertificateIdentity(poses,0,.03);
    expect(sameSolidCertificate(key,solidCertificateIdentity(structuredClone(poses),0,.03))).toBe(true);
    const changes: ((p:solids.PrismPose[])=>void)[] = [
      p => { p[0].tile.id="changed"; }, p => { p[0].tile.shape="large-square"; },
      p => { p[0].tile.position.x+=Number.EPSILON; }, p => { p[0].rotation.w+=Number.EPSILON; },
      p => { p[0].tile.rotation.x+=Number.EPSILON; }, p => { p[0].tile.basis!.xAxis.x+=Number.EPSILON; },
      p => { p[0].radius+=1e-12; }, p => { p[0].min.y+=1e-12; }, p => { p[0].max.y+=1e-12; },
      p => { p[0].vertices[0].x+=1e-12; }, p => { p[0].edges[0].x+=1e-12; }, p => { p[0].normals[0].x+=1e-12; },
      p => { p[0].vertices.pop(); }, p => { p[0].edges.push(v(0,0,0)); }, p => { p.push(p[0]); },
    ];
    for (const change of changes) {
      const changed = structuredClone(poses); change(changed);
      expect(sameSolidCertificate(key,solidCertificateIdentity(changed,0,.03))).toBe(false);
    }
    expect(sameSolidCertificate(key,solidCertificateIdentity(poses,-0,.03))).toBe(false);
    expect(sameSolidCertificate(key,solidCertificateIdentity(poses,0,.03+1e-12))).toBe(false);
    poses[0].vertices[0].x += .1;
    expect(sameSolidCertificate(key,solidCertificateIdentity(poses,0,.03))).toBe(false);
    for (const bad of [NaN,Infinity,-Infinity]) {
      poses[0].normals[0].z=bad;
      expect(solidCertificateIdentity(poses,0,.03)).toBeUndefined();
    }
    expect(sameSolidCertificate(undefined,undefined)).toBe(false);
  });

  it("reuses an unchanged successful endpoint while still integrating and sampling every native step", async () => {
    const check = vi.spyOn(solids,"checkSolidSweep");
    const engine = await createEngineWorld(assemble("still","Still",[panel()],"tower"),{drop:false,floorY:0});
    try {
      const body = [...engine.bodies.values()][0].body;
      body.setBodyType(RigidBodyType.Fixed,true);
      const native = vi.spyOn(engine.world,"step"), samples = vi.spyOn(body,"linvel");
      expect(check).toHaveBeenCalledTimes(1);
      for (let i=0;i<4;i++) engine.step();
      expect(native).toHaveBeenCalledTimes(4*COLLISION_SUBSTEPS);
      expect(samples.mock.calls.length).toBeGreaterThanOrEqual(native.mock.calls.length);
      expect(check).toHaveBeenCalledTimes(1);
      const peak = engine.peakGroundPenetration;
      body.setTranslation({...body.translation(),x:.2},true); engine.step();
      expect(check).toHaveBeenCalledTimes(2);
      body.setRotation({x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2},true); engine.step();
      expect(check).toHaveBeenCalledTimes(3);
      expect(engine.solidFailures).toEqual([]);
      expect(engine.peakGroundPenetration).toBe(peak);
      body.setTranslation({...body.translation(),y:-.2},true); engine.step();
      expect(check).toHaveBeenCalledTimes(4);
      expect(engine.solidFailures[0].kind).toBe("table");
      const count=native.mock.calls.length; engine.step();
      expect(native).toHaveBeenCalledTimes(count);
    } finally { engine.dispose(); }
  });

  it.each(["id","shape","insert","remove","reorder"] as const)("rechecks changed %s lineage instead of reusing a certificate", async change => {
    const check = vi.spyOn(solids,"checkSolidSweep");
    const engine = await createEngineWorld(assemble("lineage","Lineage",[panel("a"),panel("b",8)],"tower"),{drop:false,floorY:0});
    try {
      for (const {body} of engine.bodies.values()) body.setBodyType(RigidBodyType.Fixed,true);
      engine.step(); expect(check).toHaveBeenCalledTimes(1);
      const a=engine.bodies.get("a")!;
      if(change==="id") a.tile.id="changed";
      if(change==="shape") a.tile.shape="large-square";
      if(change==="insert") engine.bodies.set("c",{...a,tile:{...a.tile,id:"c"}});
      if(change==="remove") engine.bodies.delete("a");
      if(change==="reorder") { engine.bodies.delete("a"); engine.bodies.set("a",a); }
      engine.step();
      expect(check).toHaveBeenCalledTimes(2);
      expect(engine.solidFailures[0].kind).toBe("uncertified-sweep");
    } finally {engine.dispose();}
  });

  it("checks a restored world's initial solids even when the preceding world certified the same pose", async () => {
    const build=assemble("restore","Restore",[panel()],"tower");
    const check=vi.spyOn(solids,"checkSolidSweep");
    const engine=await createEngineWorld(build,{drop:false,floorY:0});
    try {
      [...engine.bodies.values()][0].body.setBodyType(RigidBodyType.Fixed,true); engine.step();
      expect(check).toHaveBeenCalledTimes(1);
      const restored=await createEngineWorld(supportSnapshot(build,engine),{drop:false,floorY:0,state:engine.snapshot()});
      try { expect(check).toHaveBeenCalledTimes(2); restored.step(); expect(check).toHaveBeenCalledTimes(2); }
      finally { restored.dispose(); }
    } finally { engine.dispose(); }
  });

  it("never inherits a certificate across worlds or bypasses initial overlap and nonfinite state", async () => {
    const check = vi.spyOn(solids,"checkSolidSweep");
    for (let i=0;i<2;i++) {
      const engine = await createEngineWorld(assemble("initial","Initial",[panel("a"),panel("b")],"tower"),{drop:false,floorY:0});
      try { expect(engine.solidFailures[0].kind).toBe("overlap"); } finally {engine.dispose();}
    }
    expect(check).toHaveBeenCalledTimes(2);
    const engine = await createEngineWorld(assemble("finite","Finite",[panel()],"tower"),{drop:false,floorY:0});
    try {
      const body=[...engine.bodies.values()][0].body;
      vi.spyOn(body,"linvel").mockReturnValue(v(NaN,0,0));
      const native=vi.spyOn(engine.world,"step"); engine.step();
      expect(engine.invalidState).toBe(true); expect(native).not.toHaveBeenCalled();
    } finally {engine.dispose();}
  });
});
