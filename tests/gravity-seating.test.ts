import { describe, expect, it } from "vitest";
import { assemble, square, v } from "@/lib/replication/geometry";
import { checkSupportFingerClearance, edgeGrips, findHandContacts } from "@/lib/replication/grip";
import { findInsertionPath } from "@/lib/replication/insertion";
import { simulateGravitySeat } from "@/lib/replication/seating";
import { evaluateAssembly } from "@/lib/replication/assembly";
import { assemblyUFixture, seatedRoofFixture } from "./fixtures/assembly";
import { closedShell } from "./fixtures/closed-shell";
import { smallRamp } from "@/lib/replication/models";
import { assemblyOperationPreview } from "@/lib/replication/assembly-preview";

const flat = () => assemble("flat", "Flat foundation", [square("floor", v(-1.5, .09, -1.5), v(3,0,0), v(0,0,3), "red", 1, "foundation")], "tower");

describe("gravity seating earns contacts before any new joint exists", () => {
  it.each([0, 17, 53])("places a horizontal foundation on the unchanged table for seed %i", async seed => {
    const build = flat();
    const result = await simulateGravitySeat(build, ["floor"], [edgeGrips(build.tiles[0])[0]], .55, 0, seed);
    expect(result.status, result.detail).toBe("pass");
    expect(result.settledSteps).toBeGreaterThanOrEqual(90);
    expect(result.motion[0].tiles[0].position.y).toBeCloseTo(.64);
    expect(Math.abs(result.settled.tiles[0].position.y - .09)).toBeLessThan(.03);
    expect(result.heldTileIds).toEqual([]);
    expect(result.activeJointIds).toEqual([]);
    expect(result.placement).toBe("table");
    expect(result.tableBearingTileIds).toEqual(["floor"]);
    expect(result.earnedJointIds).toEqual([]);
  });
  it("seats a roof across an independently assembled U, with every new joint absent during the fall", async () => {
    const r = seatedRoofFixture(), results = await evaluateAssembly(r);
    expect(results[0].status, JSON.stringify(results[0].operations.map(o => ({ index:o.index, seed:o.seed, detail:o.detail, seating:o.seating?.detail })), null, 2)).toBe("pass");
    const placements = results[0].operations.filter(o => o.seating);
    expect(placements).toHaveLength(3);
    for (const { seating } of placements) {
      expect(seating!.withheldJointIds).toHaveLength(3);
      expect(seating!.activeJointIds.some(id => seating!.withheldJointIds.includes(id))).toBe(false);
      expect(seating!.heldTileIds).toEqual([]);
      expect(seating!.placement).toBe("magnetic");
      expect(seating!.earnedJointIds.sort()).toEqual(seating!.withheldJointIds.sort());
      expect(seating!.motion.length).toBeGreaterThan(20);
    }
  });
  it.each(["missing-hand", "blocked-grip", "oversized-drop", "zero-motion", "missing-connection", "invented-connection", "unsupported-target", "separated-near-match"])("rejects %s", async mode => {
    const r = seatedRoofFixture(), build = r.build, roof = build.tiles.find(t => t.id === "roof")!;
    let hands = [edgeGrips(roof)[0]], height = .55;
    if (mode === "missing-hand") hands = [];
    if (mode === "blocked-grip") height = .05;
    if (mode === "oversized-drop") height = 4;
    if (mode === "zero-motion") height = 0;
    if (mode === "missing-connection") build.connections = build.connections.filter(c => c.fromTileId !== "roof" && c.toTileId !== "roof");
    if (mode === "invented-connection") build.connections.push({ kind: "edge", fromTileId: "roof", fromEdge: 99, toTileId: build.tiles[0].id, toEdge: 0 });
    if (mode === "unsupported-target") roof.position.x += 4;
    if (mode === "separated-near-match") roof.position.z += .4;
    const result = await simulateGravitySeat(build, ["roof"], hands, height, 0, 0);
    expect(result.status, result.detail).toBe("fail");
    expect(result.activeJointIds.some(id => result.withheldJointIds.includes(id))).toBe(false);
  });
  it("requires connected support after a gravity placement, rather than accepting rest alone", async () => {
    const r = seatedRoofFixture();
    r.build.tiles.find(t => t.id === "roof")!.position.z += .4;
    expect((await evaluateAssembly(r))[0].status).not.toBe("pass");
  });
  it("rejects a panel crossing a support fingertip between clear endpoint poses", () => {
    const fixture = assemblyUFixture(), held = fixture.build.tiles[0], hand = fixture.construction![0].operations[0].hands![0];
    const crossing = square("crossing", v(-3, 4, -1.5), v(3,0,0), v(0,0,3), "red", 2, "obstacle");
    const before = { ...fixture.build, tiles: [held, crossing], connections: [] };
    const after = { ...before, tiles: [held, { ...crossing, position: { ...crossing.position, y: 2 } }] };
    expect(checkSupportFingerClearance(before, [hand], 0).status).toBe("pass");
    expect(checkSupportFingerClearance(after, [hand], 0).status).toBe("pass");
    expect(checkSupportFingerClearance(after, [hand], 0, before).status).toBe("fail");
  });
  it("does not fall through a real installed panel blocking an otherwise clear release", async () => {
    const moving = square("moving", v(-1.5, 2.75, -1.5), v(3,0,0), v(0,0,3), "red", 2, "moving");
    const obstacle = square("obstacle", v(0, 3, -1.5), v(3,0,0), v(0,0,3), "blue", 1, "obstacle");
    const build = assemble("obstructed", "Obstructed release", [obstacle, moving], "tower");
    build.connections = [{ fromTileId: "obstacle", fromEdge: 0, toTileId: "moving", toEdge: 0, kind: "edge" }];
    const raised = { ...build, tiles: [obstacle, { ...moving, position: { ...moving.position, y: moving.position.y + .75 } }] };
    const path = findInsertionPath(raised, ["moving"], ["obstacle"])!;
    const hands = findHandContacts(raised, path, "moving", "obstacle", 0)!;
    expect(hands).not.toBeNull();
    const result = await simulateGravitySeat(build, ["moving"], hands, .75, 0, 0);
    expect(result.motion.length).toBeGreaterThan(1);
    expect(result.elapsedSeconds).toBeGreaterThan(0);
    expect(result.status).toBe("fail");
    expect(result.earnedJointIds).toEqual([]);
  });
  it("does not grant rest-before-attachment to an edge-only roof with no bearing area", async () => {
    const build = closedShell(1), roof = build.tiles.find(t => t.id === "roof")!;
    const result = await simulateGravitySeat(build, ["roof"], [edgeGrips(roof)[0]], .55, 0, 0);
    expect(result.status).toBe("fail");
    expect(result.motion.at(-1)!.seconds).toBe(result.elapsedSeconds);
    expect(result.motion.at(-1)!.tiles).toEqual(result.settled.tiles);
  });
  it("constructs the source launch on its side across all three seeds, without granting the later rotation", async () => {
    const r = smallRamp(), results = await evaluateAssembly(r), launch = results.find(s => s.stageId === "small-launch")!;
    expect(launch.status, launch.detail).toBe("pass");
    expect(launch.operations).toHaveLength(12);
    expect(launch.operations.filter(o => o.seating)).toHaveLength(3);
    expect(results.find(s => s.stageId === "small-final")!.status).not.toBe("pass");
    const placement = launch.operations[0], frames = placement.seating!.motion;
    const start = assemblyOperationPreview(r.build, placement, .5), end = assemblyOperationPreview(r.build, placement, 1);
    expect(start.tiles).toEqual(frames[0].tiles);
    expect(end.tiles).toEqual(frames.at(-1)!.tiles);
    expect(end.tiles).not.toEqual(r.build.tiles);
    expect(end.tiles).toHaveLength(1);
    expect(start.tiles[0].position.y - end.tiles[0].position.y).toBeGreaterThan(.5);
  });
});
