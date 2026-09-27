import { describe, expect, it } from "vitest";
import { buildBounds } from "@/lib/engine/build";
import { transformLocal } from "@/lib/engine/math";
import { assemble, v } from "@/lib/replication/geometry";
import { evaluateAssembly, checkClosure } from "@/lib/replication/assembly";
import { checkHandAccess, edgeGrips } from "@/lib/replication/grip";
import { findInsertionPath } from "@/lib/replication/insertion";
import { simulateSupport } from "@/lib/replication/support";
import { closedShell } from "./fixtures/closed-shell";
import { assemblyUFixture } from "./fixtures/assembly";

const fixture = assemblyUFixture;

describe("assembly with explicit individual-panel hand supports", () => {
  it("reaches a complete simulation pass for a three-wall support across three seeds", async () => {
    const result = await evaluateAssembly(fixture());
    expect(result[0].status, JSON.stringify(result, null, 2)).toBe("pass");
    expect(result[0].operations).toHaveLength(9);
    expect(result[0].checkpoints).toHaveLength(3);
    expect(result[0].checkpoints.every(t => t.heldTileIds.length === 0)).toBe(true);
  });
  it("does not move the floor up beneath an unsupported floating panel", async () => {
    const r = fixture(), tile = r.build.tiles[0];
    const build = assemble("floating", "Floating wall", [{ ...tile, position: { ...tile.position, y: tile.position.y + 4 } }], "tower");
    const result = await simulateSupport(build, [], 0, 0);
    expect(result.status).toBe("fail");
    expect(result.peakDisplacement).toBeGreaterThan(0.95);
  });
  it("keeps the held panel fixed while an unsupported hinged panel can fall", async () => {
    // A vertical hinge can maintain two vertical suspended panels, so use the shell roof
    // joined along a horizontal hinge; gravity must fold the unsupported wall.
    const shell = closedShell(1), parts = shell.tiles.filter(t => ["roof", "x-0--1"].includes(t.id));
    const hanging = assemble("hanging", "Hanging hinge", parts.map(t => ({ ...t, position: { ...t.position, y: t.position.y + 5 } })), "tower");
    const result = await simulateSupport(hanging, ["x-0--1"], 0, 0);
    expect(result.status).toBe("fail");
    expect(result.heldTileIds).toEqual(["x-0--1"]);
    const bothHeld = await simulateSupport(hanging, ["x-0--1", "roof"], 0, 0);
    expect(bothHeld.status).toBe("pass");
    expect(bothHeld.dynamicTileCount).toBe(0);
    expect(bothHeld.detail).toMatch(/No free-body stability/);
    expect(result.dynamicTileCount).toBe(1);
  });
  it.each(["three-hands", "missing-hands", "absent-hand", "disconnected", "omitted-operation", "blocked-grip"])("rejects %s", async mode => {
    const r = fixture(), operations = r.construction![0].operations;
    if (mode === "three-hands") operations[2].hands!.push(operations[1].hands![0]);
    if (mode === "missing-hands") delete operations[1].hands;
    if (mode === "absent-hand") operations[0].hands![0].tileId = "missing";
    if (mode === "disconnected") r.build.connections = [];
    if (mode === "omitted-operation") operations.pop();
    if (mode === "blocked-grip") operations[0].hands![0] = edgeGrips(r.build.tiles[0]).find(g => transformLocal(g.localPoint, r.build.tiles[0].position, r.build.tiles[0].basis!).y < 0.1)!;
    expect((await evaluateAssembly(r))[0].status).not.toBe("pass");
  });
  it("does not accept an empty-air insertion as a closed connection", () => {
    const r = fixture(); r.build.connections = [];
    const path = findInsertionPath(r.build, [r.build.tiles[1].id], [r.build.tiles[0].id])!;
    expect(checkClosure(r.build, path).status).toBe("fail");
  });
  it("rejects an invented grip point and reduced proxy size", () => {
    const r = fixture(), op = r.construction![0].operations[0], path = findInsertionPath(r.build, op.tileIds, [])!, floor = buildBounds(r.build.tiles).min.y;
    expect(checkHandAccess(r.build, path, [{ ...op.hands![0], localPoint: v(99, 99, 0) }], floor).status).toBe("fail");
    expect(checkHandAccess(r.build, path, [{ ...op.hands![0], proxy: "tiny" as never }], floor).status).toBe("fail");
  });
  it("rejects support of more than two bodies at the physics boundary", async () => {
    const r = fixture();
    await expect(simulateSupport(r.build, r.build.tiles.map(t => t.id), 0, 0)).rejects.toThrow(/support contract/);
  });
  it("fails when the first panel is released while it is above the stage table", async () => {
    const r = fixture(); r.construction![0].operations[0].releaseAfter = true;
    r.build.tiles[0].position.y += 3;
    const result = (await evaluateAssembly(r))[0];
    expect(result.status).toBe("fail");
    expect(result.operations[0].trials.at(-1)?.heldTileIds).toEqual([]);
    expect(result.operations[0].trials.at(-1)?.peakDisplacement).toBeGreaterThan(0.95);
  });
  it("does not pretend a module can be moved through an untested rotation", async () => {
    const r = fixture();
    r.stages[0].transform = { basis: { xAxis: v(1,0,0), yAxis: v(0,0,1), zAxis: v(0,-1,0) }, translation: v(0,3,0) };
    expect((await evaluateAssembly(r))[0].status).not.toBe("pass");
  });
  it("runs a free checkpoint even when a later stage reuses all parts without inserting any", async () => {
    const r = fixture(); r.stages[0].support = "held";
    r.stages.push({ ...r.stages[0], id: "release", support: "released", installedStageIds: ["u"] });
    r.construction!.push({ stageId: "release", operations: [] });
    const result = await evaluateAssembly(r);
    expect(result[1].status).toBe("pass");
    expect(result[1].operations).toHaveLength(0);
    expect(result[1].checkpoints).toHaveLength(3);
    expect(result[1].checkpoints.every(c => c.heldTileIds.length === 0)).toBe(true);
  });
});
