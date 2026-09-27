import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import Original from "@dimforge/rapier3d-compat";
import RAPIER, { World, ColliderDesc, RigidBodyDesc, JointData, assertIntegrationSettings, integrationSettings } from "@/lib/engine/physics-backend";
import { PHYSICS_BACKEND_ID } from "@/lib/engine/backend-identity";
import { PHYSICS_MODEL_VERSION } from "@/lib/engine/constants";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { assemble, square, v } from "@/lib/replication/geometry";
import { workspaceBuild, type PreparedWorkspace } from "@/lib/replication/workspace";
import profile from "@/vendor/rapier-contact/profile.json";
import provenance from "@/vendor/rapier-contact/provenance.json";

beforeAll(async () => { await RAPIER.init(); await Original.init(); });

describe("one guarded headless physics runtime", () => {
  it("shares the same constructors and initializer through require and import", async () => {
    const required = createRequire(import.meta.url)("@magnatiles/rapier-contact");
    const imported = await import("@magnatiles/rapier-contact");
    expect(imported.RigidBodyDesc).toBe(required.RigidBodyDesc);
    expect(imported.default.init).toBe(required.init);
    expect(RAPIER.init).toBe(required.init);
    expect(RigidBodyDesc).toBe(required.RigidBodyDesc);
    expect(RigidBodyDesc).not.toBe(Original.RigidBodyDesc);
  });

  it("matches the original numerical settings before and after app configuration", () => {
    const selected = new World(v(0,0,0)), original = new Original.World(v(0,0,0));
    try {
      expect(integrationSettings(selected)).toEqual(profile.defaults);
      expect(integrationSettings(original)).toEqual(profile.defaults);
      for (const world of [selected, original]) {
        world.integrationParameters.dt = 1/120;
        world.integrationParameters.numSolverIterations = 16;
        world.integrationParameters.contact_natural_frequency = 120;
      }
      expect(integrationSettings(selected)).toEqual(profile.configured);
      expect(integrationSettings(original)).toEqual(profile.configured);
      expect(() => assertIntegrationSettings(selected, true)).not.toThrow();
      selected.integrationParameters.numSolverIterations = 17;
      expect(() => assertIntegrationSettings(selected, true)).toThrow(/numSolverIterations/);
    } finally { selected.free(); original.free(); }
  });

  it("rejects foreign descriptors, shapes, parents, joints and raw subsystems before entering WASM", () => {
    const a = new World(v(0,0,0)), b = new World(v(0,0,0));
    const original = new Original.World(v(0,0,0));
    try {
      const own = a.createRigidBody(RigidBodyDesc.dynamic()), own2 = a.createRigidBody(RigidBodyDesc.dynamic());
      const other = b.createRigidBody(RigidBodyDesc.dynamic());
      const foreign = original.createRigidBody(Original.RigidBodyDesc.dynamic());
      const collider = a.createCollider(ColliderDesc.cuboid(1,1,1),own);
      const otherCollider = b.createCollider(ColliderDesc.cuboid(1,1,1),other);
      expect(() => a.createRigidBody(Original.RigidBodyDesc.dynamic())).toThrow(/descriptor/);
      expect(() => a.createCollider(Original.ColliderDesc.cuboid(1,1,1))).toThrow(/descriptor/);
      const corrupt = ColliderDesc.cuboid(1,1,1); corrupt.shape = new Original.Cuboid(1,1,1);
      expect(() => a.createCollider(corrupt)).toThrow(/shape/);
      expect(() => collider.setShape(new Original.Cuboid(1,1,1))).toThrow(/shape/);
      for (const parent of [other, foreign]) {
        expect(() => Reflect.apply(a.createCollider,a,[ColliderDesc.cuboid(1,1,1),parent])).toThrow(/another/);
        expect(() => Reflect.apply(a.createImpulseJoint,a,[JointData.spherical(v(0,0,0),v(0,0,0)),own,parent,true])).toThrow(/another/);
        expect(() => Reflect.apply(a.removeRigidBody,a,[parent])).toThrow(/another/);
      }
      expect(() => a.createImpulseJoint(Original.JointData.spherical(v(0,0,0),v(0,0,0)),own,own2,true)).toThrow(/descriptor/);
      expect(() => a.removeCollider(otherCollider,true)).toThrow(/another/);
      expect(() => a.contactPair(collider,otherCollider,() => {})).toThrow(/another/);
      expect(() => a.contactPairsWith(otherCollider,() => {})).toThrow(/another/);
      a.contactPairsWith(collider,() => {});
      const otherJoint = b.createImpulseJoint(JointData.spherical(v(0,0,0),v(0,0,0)),other,b.createRigidBody(RigidBodyDesc.dynamic()),true);
      expect(() => a.removeImpulseJoint(otherJoint,true)).toThrow(/another/);
      expect(() => Reflect.construct(World,[v(0,0,0),original.integrationParameters])).toThrow(/raw subsystem/);
      expect(() => new World(v(NaN,0,0))).toThrow(/finite gravity/);
      expect(() => Reflect.apply(a.step,a,[{}])).toThrow(/external event/);
      expect(() => a.createMultibodyJoint()).toThrow(/impulse joints only/);
      // Every rejection leaves both worlds usable.
      a.step(); b.step(); original.step();
      expect(collider.isValid()).toBe(true);
    } finally { a.free(); b.free(); original.free(); }
  });

  it("rejects removed objects and binary snapshots, and disposes repeatedly without cross-world damage", () => {
    for (let i=0; i<20; i++) {
      const world = new World(v(0,0,0));
      const body = world.createRigidBody(RigidBodyDesc.dynamic());
      const other = world.createRigidBody(RigidBodyDesc.dynamic());
      const collider = world.createCollider(ColliderDesc.cuboid(1,1,1),body);
      const joint = world.createImpulseJoint(JointData.spherical(v(0,0,0),v(0,0,0)),body,other,true);
      expect(() => world.takeSnapshot()).toThrow(/versioned EngineState/);
      expect(() => World.restoreSnapshot()).toThrow(/versioned EngineState/);
      world.removeRigidBody(body);
      expect(() => world.createCollider(ColliderDesc.cuboid(1,1,1),body)).toThrow(/disposed/);
      expect(() => world.removeCollider(collider,true)).toThrow(/disposed/);
      expect(() => world.contactPairsWith(collider,() => {})).toThrow(/disposed/);
      expect(() => collider.setShape(ColliderDesc.cuboid(1,1,1).shape)).toThrow(/disposed/);
      expect(() => world.removeImpulseJoint(joint,true)).toThrow(/disposed/);
      world.step(); world.free(); world.free();
      expect(() => world.step()).toThrow(/disposed/);
      expect(() => world.createRigidBody(RigidBodyDesc.dynamic())).toThrow(/disposed/);
      expect(() => world.removeRigidBody(other)).toThrow(/disposed/);
    }
  });

  it("binds backend identity to the exact packaged artifact and numerical profile", () => {
    const digest = (path: string) => createHash("sha256").update(readFileSync(new URL(path,import.meta.url))).digest("hex");
    const artifact = digest("../vendor/rapier-contact/rapier.cjs");
    expect(artifact).toBe(provenance.artifacts["rapier.cjs"]);
    expect(PHYSICS_BACKEND_ID).toContain(artifact.slice(0,16));
    expect(PHYSICS_BACKEND_ID).toContain(`profile${digest("../vendor/rapier-contact/profile.json").slice(0,16)}`);
    expect(digest("../vendor/rapier-contact/build/parry.patch")).toBe(provenance.patchSha256);
    expect(digest("../vendor/rapier-contact/build/Cargo.lock")).toBe(provenance.rustLockSha256);
    expect(digest("../vendor/rapier-contact/build/package-lock.json")).toBe(provenance.npmLockSha256);
  });

  it.each(PHYSICS_BACKEND_ID.split("-"))("rejects stale %s state in both continuation and prepared workspaces", async component => {
    const build = assemble("state","State",[square("p",v(-1.5,2,-1.5),v(3,0,0),v(0,0,3),"red",1,"panel")],"tower");
    const engine = await createEngineWorld(build,{drop:false,floorY:0});
    try {
      const state = engine.snapshot();
      state.physicsModel = PHYSICS_MODEL_VERSION.replace(component,`${component}-changed`);
      expect(state.physicsModel).not.toBe(PHYSICS_MODEL_VERSION);
      const workspace: PreparedWorkspace = {id:"one:0",stageId:"one",seed:0,lineage:[],floorY:0,constructionOffset:v(0,0,0),build,state,hands:[],components:[["p"]]};
      expect(() => workspaceBuild(workspace,0)).toThrow(/Invalid prepared/);
      await expect(createEngineWorld(build,{drop:false,floorY:0,state})).rejects.toThrow(/current physics model/);
    } finally { engine.dispose(); }
  });
});
