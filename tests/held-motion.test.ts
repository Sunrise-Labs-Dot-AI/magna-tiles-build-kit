import { describe, expect, it } from "vitest";
import { unsupportedHingeFixture } from "./fixtures/rigid-contact";
import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { basisToQuaternion, multiplyQuaternions } from "@/lib/engine/math";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { assemble, square, v } from "@/lib/replication/geometry";
import { checkHandAccess, checkMotionFingerClearance, edgeGrips } from "@/lib/replication/grip";
import { checkSweptPoses, tileQuaternion } from "@/lib/replication/rotation-clearance";
import { simulateHeldMotion } from "@/lib/replication/held-motion";
import { compactMotion } from "@/lib/replication/motion-recording";

const quarter = { x: 0,y: 0,z: Math.SQRT1_2,w: Math.SQRT1_2 };
const tile = square("moving",v(-1.5,2,-0),v(3,0,0),v(0,3,0),"blue",1,"panel");
const single = () => assemble("motion", "Motion", [structuredClone(tile)], "tower");
const grip = () => edgeGrips(tile)[2];

describe("swept rotation and actual held motion", () => {
  it("bounds replay size while keeping actual first and failure poses", () => {
    const frames = Array.from({ length: 150 },(_,i) => ({ seconds: i/100,tiles: [{ ...tile,position: v(i/10,3,0) }] }));
    const compact = compactMotion(frames);
    expect(compact).toHaveLength(32);
    expect(compact[0]).toBe(frames[0]);
    expect(compact.at(-1)).toBe(frames.at(-1));
    expect(compact.every(f => frames.includes(f))).toBe(true);
    expect(compactMotion(frames.map(f => ({ ...f,tiles: [tile] })))).toHaveLength(2);
  });
  it("rejects a rotation that hits only the middle of a turn", () => {
    const moving = { ...tile, position: v(0,3,0) }, obstacle = square("obstacle",v(1.95,1.5,-1.5),v(0,3,0),v(0,0,3),"red",1,"obstacle");
    // Square() requires exact catalog sides, so use a full vertical obstacle with
    // its nearest face at x=1.95. Both square orientations end at x=±1.5.
    obstacle.position = v(1.95,3,0);
    const before = assemble("sweep","Sweep",[moving,obstacle],"tower");
    const after = { ...before, tiles: [{ ...moving, basis: { xAxis: v(0,1,0), yAxis: v(-1,0,0), zAxis: v(0,0,1) } },obstacle] };
    expect(checkSweptPoses(before,before,0).status).toBe("pass");
    expect(checkSweptPoses(after,after,0).status).toBe("pass");
    expect(checkSweptPoses(before,after,0).status).toBe("fail");
  });
  it("rejects a table crossing between clear endpoints", () => {
    const before = single(); before.tiles[0].position.y = 1.6;
    const after = structuredClone(before); after.tiles[0].basis = { xAxis: v(0,1,0),yAxis: v(-1,0,0),zAxis: v(0,0,1) };
    expect(checkSweptPoses(before,before,0).status).toBe("pass");
    expect(checkSweptPoses(after,after,0).status).toBe("pass");
    expect(checkSweptPoses(before,after,0).status).toBe("fail");
  });
  it("catches moving fingertips between clear endpoints even when the tile itself clears", () => {
    const obstacle = square("above",v(-1.5,5.1,-1.5),v(3,0,0),v(0,0,3),"red",1,"obstacle");
    const before = assemble("finger","Finger sweep",[{ ...tile,position: { ...tile.position,x: -4 } },obstacle],"tower");
    const after = { ...before,tiles: [{ ...tile,position: { ...tile.position,x: 4 } },obstacle] };
    expect(checkSweptPoses(before,after,0).status).toBe("pass");
    expect(checkMotionFingerClearance(before,before,[grip()],0).status).toBe("pass");
    expect(checkMotionFingerClearance(after,after,[grip()],0).status).toBe("pass");
    expect(checkMotionFingerClearance(before,after,[grip()],0).status).toBe("fail");
  });
  it("checks each bent finger approach segment against the gripped panel", () => {
    const build = single(), hand = grip(), path = { id: "grip",movingTileIds: [tile.id],fixedTileIds: [],offsets: [v(0,0,0),v(0,0,0)] };
    expect(checkHandAccess(build,path,[hand],0).status).toBe("pass");
    hand.approachOffsets = [v(0,2,0),v(0,-1,.3),v(0,0,0)];
    expect(checkHandAccess(build,path,[hand],0).status).toBe("fail");
  });
  it("carries and rotates one panel continuously, returning its actual kinematic state", async () => {
    const build = single(), q = tileQuaternion(tile), rotated = multiplyQuaternions(quarter,q);
    const result = await simulateHeldMotion(build,undefined,[tile.id],[grip()], [
      { seconds: 0,position: tile.position,rotation: q }, { seconds: 1,position: v(0,5,0),rotation: q },
      { seconds: 3,position: v(0,5,0),rotation: rotated }],0,0);
    expect(result.status,result.detail).toBe("pass");
    expect(result.motion.length).toBeGreaterThan(20);
    expect(result.peakDeformation).toBeLessThan(1e-5);
    expect(result.state!.bodies[0].bodyType).toBe(RigidBodyType.KinematicPositionBased);
    const resumed = await createEngineWorld(result.settled,{ drop: false,floorY: 0,state: result.state });
    try { expect(resumed.snapshot()).toEqual(result.state); } finally { resumed.dispose(); }
  });
  it("does not rigidly carry an unstable two-panel hinge", async () => {
    const build = unsupportedHingeFixture();
    const wall = build.tiles.find(t => t.id === "x-0--1")!, q = basisToQuaternion(wall.basis!);
    const result = await simulateHeldMotion(build,undefined,build.tiles.map(t => t.id),[edgeGrips(wall)[0]], [
      { seconds: 0,position: wall.position,rotation: q }, { seconds: 1,position: { ...wall.position,y: wall.position.y+.5 },rotation: q }],0,0);
    expect(result.status).toBe("fail");
    expect(result.dynamicTileCount).toBe(1);
    expect(result.peakDeformation).toBeGreaterThan(.95);
    expect(result.motion.length).toBeGreaterThan(1);
    expect(result.motion.at(-1)!.seconds).toBeGreaterThan(0);
    expect(result.motion.at(-1)!.tiles).toEqual(result.settled.tiles);
  });
  it.each(["jump","speed","missing-grip","disconnected"])("rejects %s before claiming motion", async mode => {
    const build = single(), start = { seconds: 0,position: tile.position,rotation: tileQuaternion(tile) }, end = { ...start,seconds: 1,position: { ...tile.position,y: tile.position.y+.5 } };
    if (mode === "jump") start.position = v(9,9,9);
    if (mode === "speed") end.position = v(20,20,20);
    if (mode === "disconnected") build.tiles.push({ ...tile,id: "unattached",position: v(8,8,8) });
    const result = await simulateHeldMotion(build,undefined,build.tiles.map(t => t.id),mode === "missing-grip" ? [] : [grip()],[start,end],0,0);
    expect(result.status).toBe("fail");
  });
});
