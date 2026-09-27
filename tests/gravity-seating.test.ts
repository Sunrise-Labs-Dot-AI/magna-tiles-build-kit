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
import { connectionId } from "@/lib/engine/build";

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
  it("constructs the source modules in one workspace and requires free rest after actual transfer", async () => {
    const r = smallRamp(), results = await evaluateAssembly(r), launch = results.find(s => s.stageId === "small-launch")!;
    expect(launch.status, launch.detail).toBe("pass");
    expect(launch.operations).toHaveLength(12);
    expect(launch.operations.filter(o => o.seating)).toHaveLength(3);
    const final=results.find(s=>s.stageId==="small-final")!;
    expect(final.operations).toHaveLength(3);
    for(const operation of final.operations) {
      expect(operation.transfer?.status,operation.detail).toBe("pass");
      expect(operation.transfer!.previousHands).toHaveLength(2);
      expect(operation.transfer!.retainedHands.map(h=>h.tileId)).toEqual(["launch-side-1"]);
      expect(operation.carry?.completion,operation.detail).toBe("contact-arrival");
      expect(operation.carry!.separationCheckpoint!.tiles).toHaveLength(9);
      expect(operation.carry!.separationCheckpoint!.separations.every(s=>s.gap>0)).toBe(true);
      expect(operation.transfer!.earnedCrossConnectionIds).toEqual(operation.transfer!.withheldCrossConnectionIds);
      expect(operation.transfer!.activeJointIdsBeforeClosure.some(id=>operation.transfer!.earnedCrossConnectionIds.includes(id))).toBe(false);
      expect(operation.carry!.arrivalContacts!.physicalConnectionIds).toEqual(operation.transfer!.physicalCrossConnectionIds);
      const free=operation.trials.at(-1)!;
      expect(operation.trials[0].heldTileIds).toEqual(["launch-side-1"]);
      expect(operation.trials[1].status,operation.detail).toBe("pass");
      expect(free.heldTileIds).toEqual([]);
      expect(free.dynamicTileCount).toBe(9);
      expect(operation.status).toBe(free.status);
      if(operation.status==="pass") {
        expect(free.settledSteps).toBeGreaterThanOrEqual(90);
        expect(free.peakGroundPenetration).toBeLessThanOrEqual(.03);
      }
      const initial=assemblyOperationPreview(r.build,operation,0),terminal=assemblyOperationPreview(r.build,operation,1);
      expect(initial.tiles).toHaveLength(9);
      expect(initial.connections.some(c=>operation.transfer!.earnedCrossConnectionIds.includes(connectionId(c)))).toBe(false);
      expect(operation.transfer!.earnedCrossConnectionIds.every(id=>terminal.connections.some(c=>connectionId(c)===id))).toBe(true);
      expect(terminal.tiles).toEqual(free.motion.at(-1)!.tiles);
    }
    const wedge = results.find(s => s.stageId === "small-wedge")!;
    expect(wedge.status,wedge.detail).toBe("pass");
    for (const seed of [0,17,53]) {
      const operations = wedge.operations.filter(o => o.seed === seed);
      expect(operations, wedge.detail).toHaveLength(5);
      expect(operations.slice(0,4).every(o => o.status === "pass"),wedge.detail).toBe(true);
      const last = operations[4];
      expect(last.pickup?.status,last.detail).toBe("pass");
      expect(last.lowering?.status,last.detail).toBe("pass");
      expect(last.docking?.status,last.detail).toBe("pass");
      expect(last.trials[0].heldTileIds).toHaveLength(2);
      expect(last.trials[1].heldTileIds).toHaveLength(1);
      expect(last.trials.at(-1)!.heldTileIds).toEqual([]);
      expect(last.status,last.detail).toBe("pass");
      expect(last.trials.at(-1)!.settledSteps).toBeGreaterThanOrEqual(90);
      expect(last.trials.at(-1)!.peakGroundPenetration).toBeLessThanOrEqual(.03);
      expect(last.trials.at(-1)!.poppedJoints).toEqual([]);
      expect(assemblyOperationPreview(r.build,last,1).tiles).toEqual(last.trials.at(-1)!.motion.at(-1)!.tiles);
    }
    const placement = launch.operations[0], frames = placement.seating!.motion;
    const seatingProgress = placement.timeline!.findIndex(p => p.phase === "seating")/placement.timeline!.length;
    const start = assemblyOperationPreview(r.build, placement, seatingProgress), end = assemblyOperationPreview(r.build, placement, 1);
    expect(start.tiles).toEqual(frames[0].tiles);
    expect(end.tiles).toEqual(placement.trials.at(-1)!.motion.at(-1)!.tiles);
    expect(end.tiles).not.toEqual(r.build.tiles);
    expect(end.tiles).toHaveLength(6);
    expect(end.tiles.filter(t=>t.id.startsWith("small-")).map(t=>t.id).sort()).toEqual([...r.stages[0].tileIds].sort());
    expect(start.tiles.find(t=>t.id==="launch-back")!.position.y - end.tiles.find(t=>t.id==="launch-back")!.position.y).toBeGreaterThan(.5);
  }, 240_000);
});
