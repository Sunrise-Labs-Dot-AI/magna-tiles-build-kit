import { describe, expect, it } from "vitest";
import { unsupportedHingeFixture } from "./fixtures/rigid-contact";
import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { basisToQuaternion, distance, magnitude, multiplyQuaternions, quaternionToBasis, subtract, transformLocal } from "@/lib/engine/math";
import { simulateSupport, supportSnapshot } from "@/lib/replication/support";
import { assemble } from "@/lib/replication/geometry";
import { closedShell } from "./fixtures/closed-shell";

describe("physical state between assembly phases", () => {
  it("retains rotated geometry, velocities, body mode, CCD and original hinge anchors", async () => {
    const build = closedShell(1), first = await createEngineWorld(build, { drop: false, floorY: 0 });
    try {
      for (let i = 0; i < 50; i++) first.step();
      const body = first.bodies.get("roof")!.body;
      body.setBodyType(RigidBodyType.KinematicPositionBased, true);
      body.enableCcd(true);
      body.setLinvel({ x: 1, y: 2, z: 3 }, true);
      body.setAngvel({ x: .1, y: .2, z: .3 }, true);
      const actual = supportSnapshot(build, first), state = first.snapshot();
      const second = await createEngineWorld(actual, { drop: false, floorY: 0, state });
      try {
        expect(second.snapshot()).toEqual(state);
        expect(supportSnapshot(actual, second)).toEqual(actual);
        expect(second.maxDisplacement()).toBeLessThan(1e-8);
        second.bodies.get("roof")!.body.setTranslation({ x: 3, y: 4, z: 5 }, true);
        expect(second.maxDisplacement()).toBeGreaterThan(1);
        expect(first.snapshot()).toEqual(state);
      } finally { second.dispose(); }
      await expect(createEngineWorld(build, { drop: false, floorY: 0, state })).rejects.toThrow(/reset or omit/);
      await expect(createEngineWorld(actual, { drop: true, floorY: 0, state })).rejects.toThrow(/no new drop/);
      await expect(createEngineWorld({ ...actual, connections: [] }, { drop: false, floorY: 0, state })).rejects.toThrow(/omit an existing/);
    } finally { first.dispose(); }
  });

  it("never resurrects a popped join on continuation", async () => {
    const shell = closedShell(1), build = assemble("pair", "Pair", shell.tiles.filter(t => ["roof", "x-0--1"].includes(t.id)), "tower");
    const first = await createEngineWorld(build, { drop: false, floorY: 0 });
    try {
      for (const { body } of first.bodies.values()) body.setBodyType(RigidBodyType.Fixed, true);
      const roof = first.bodies.get("roof")!.body, p = roof.translation();
      roof.setTranslation({ ...p, y: p.y + 1 }, true);
      first.step();
      expect(first.poppedJoints).toHaveLength(1);
      const actual = supportSnapshot(build, first), state = first.snapshot();
      const next = await createEngineWorld(actual, { drop: false, floorY: 0, state });
      try {
        expect(next.joints).toHaveLength(0);
        expect(next.poppedJoints).toEqual(first.poppedJoints);
      } finally { next.dispose(); }
    } finally { first.dispose(); }
  });

  it("releases a previously held panel and preserves momentum without reseeding", async () => {
    const build = assemble("fall", "Falling roof", closedShell(1).tiles.filter(t => t.id === "roof"), "tower");
    const first = await createEngineWorld(build, { drop: false, floorY: 0 });
    try {
      const body = first.bodies.get("roof")!.body;
      body.setBodyType(RigidBodyType.Fixed, true);
      const state = first.snapshot();
      const release = await simulateSupport(build, [], 0, 53, Infinity, state);
      expect(release.status).toBe("fail");
      expect(release.peakDisplacement).toBeGreaterThan(.95);
      expect(release.state.bodies[0].bodyType).toBe(RigidBodyType.Dynamic);
    } finally { first.dispose(); }
  });

  it("adds a free hinge to an already rotated body using both local axis frames", async () => {
    const shell = unsupportedHingeFixture(), target = shell.tiles.find(t => t.id === "roof")!;
    const unrotated = { ...target, basis: undefined, rotation: { x: 0, y: 0, z: 0 } };
    const one = assemble("roof", "Roof", [unrotated], "tower");
    const original = await createEngineWorld(one, { drop: false, floorY: 0 });
    try {
      const roof = original.bodies.get("roof")!.body;
      roof.setRotation(basisToQuaternion(target.basis!), true);
      roof.setLinvel({ x: 0, y: 0, z: 0 }, true);
      roof.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // Its edge along z has different coordinates in the rotated roof and new wall.
      const pair = assemble("pair", "Pair", [supportSnapshot(one, original).tiles[0], shell.tiles.find(t => t.id === "x-0--1")!], "tower");
      expect(pair.connections).toHaveLength(1);
      const next = await createEngineWorld(pair, { drop: false, floorY: 0, state: original.snapshot() });
      try {
        expect(next.rejectedReasons).toEqual([]);
        expect(next.joints[0].companion).toBeDefined();
        expect(next.joints[0].companion!.contactsEnabled()).toBe(true);
        next.bodies.get("x-0--1")!.body.setBodyType(RigidBodyType.Fixed, true);
        const before = { ...next.bodies.get("roof")!.body.translation() };
        for (let i = 0; i < 35; i++) next.step();
        expect(distance(before, next.bodies.get("roof")!.body.translation())).toBeGreaterThan(.1);
        expect(magnitude(next.bodies.get("roof")!.body.angvel())).toBeGreaterThan(.1);
        expect(next.poppedJoints).toEqual([]);
        // The same gravity fold occurs with a fresh unrotated-frame revolute joint.
        const control = await createEngineWorld(pair, { drop: false, floorY: 0 });
        try {
          for (const { body } of control.bodies.values()) { body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
          control.bodies.get("x-0--1")!.body.setBodyType(RigidBodyType.Fixed, true);
          for (let i = 0; i < 35; i++) control.step();
          expect(distance(control.bodies.get("roof")!.body.translation(), next.bodies.get("roof")!.body.translation())).toBeLessThan(.08);
        } finally { control.dispose(); }
        // Rotate about the primary anchor, leaving it coincident while tearing
        // the companion anchor away. Both constraints must break together.
        const joint = next.joints[0], from = next.bodies.get(joint.model.fromTileId)!.body;
        for (const { body } of next.bodies.values()) body.setBodyType(RigidBodyType.Fixed,true);
        const pivot = transformLocal(joint.model.fromLocalAnchor,from.translation(),quaternionToBasis(from.rotation()));
        const q = multiplyQuaternions({ x: Math.sin(.5),y: 0,z: 0,w: Math.cos(.5) },from.rotation());
        from.setRotation(q,true);
        from.setTranslation(subtract(pivot,transformLocal(joint.model.fromLocalAnchor,{ x: 0,y: 0,z: 0 },quaternionToBasis(q))),true);
        next.step();
        expect(joint.previousDistance).toBeLessThan(.01);
        expect(next.poppedJoints).toEqual([joint.id]);
        expect(next.joints).toHaveLength(0);
        expect(joint.companion!.isValid()).toBe(false);
      } finally { next.dispose(); }
    } finally { original.dispose(); }
  });
});
