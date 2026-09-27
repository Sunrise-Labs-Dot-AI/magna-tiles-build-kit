import { describe, expect, it } from "vitest";
import { assemble, square, v } from "@/lib/replication/geometry";
import { findInsertionPath, validateInsertionPath, type InsertionPath } from "@/lib/replication/insertion";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { closedShell } from "./fixtures/closed-shell";
import { planConstructionPaths } from "@/lib/replication/construction";
import { smallRamp } from "@/lib/replication/models";
import { insertionPreview } from "@/lib/replication/insertion";

const fixture = () => assemble("path-fixture", "Insertion fixture", [
  square("floor", v(0, 0, 0), v(3, 0, 0), v(0, 0, 3), "blue", 1, "fixture"),
  square("wall", v(0, 0.18, 3.09), v(3, 0, 0), v(0, 3, 0), "red", 2, "fixture"),
], "tower");
const path = (offsets = [v(0, 4, 0), v(0, 0, 0)]): InsertionPath => ({
  id: "wall-insertion", movingTileIds: ["wall"], fixedTileIds: ["floor"], offsets,
});

describe("continuous insertion clearance", () => {
  it("accepts an unobstructed path with physical edge contact at closure", () => {
    expect(validateInsertionPath(fixture(), path()).status).toBe("pass");
  });

  it("rejects a collision between clear endpoints, even over a very long move", () => {
    const build = fixture();
    build.tiles.push(square("obstacle", v(0, 3.5, 2), v(3, 0, 0), v(0, 0, 3), "green", 3, "fixture"));
    const candidate = path([v(0, 9999, 0), v(0, 0, 0)]);
    candidate.fixedTileIds.push("obstacle");
    const result = validateInsertionPath(build, candidate);
    expect(result.status).toBe("fail");
    expect(result.collision?.obstacle).toBe("obstacle");
    expect(result.collision!.fraction).toBeGreaterThan(0.999);
  });

  it("can approach a blocked roof from the side without going through it", () => {
    const build = fixture();
    build.tiles.push(square("obstacle", v(0, 3.5, 2), v(3, 0, 0), v(0, 0, 3), "green", 3, "fixture"));
    const proposal = findInsertionPath(build, ["wall"], ["floor", "obstacle"]);
    expect(proposal).not.toBeNull();
    expect(proposal!.offsets[0].y).toBe(0);
    expect(validateInsertionPath(build, proposal!).status).toBe("pass");
  });

  it("rejects going below the assembly table", () => {
    expect(validateInsertionPath(fixture(), path([v(0, -4, 0), v(0, 0, 0)])).detail).toMatch(/table/);
  });

  it("checks every segment of a dogleg instead of only its start and end", () => {
    const build = fixture();
    build.tiles.push(square("barrier", v(0, 0.18, -1), v(3, 0, 0), v(0, 3, 0), "green", 3, "fixture"));
    const candidate = path([v(5, 0, 0), v(0, 0, -6), v(0, 0, 0)]);
    candidate.fixedTileIds.push("barrier");
    const result = validateInsertionPath(build, candidate);
    expect(result.status).toBe("fail");
    expect(result.collision?.obstacle).toBe("barrier");
  });

  it.each(["nonfinite", "missing", "duplicate", "fixed-moving", "no-move", "wrong-end", "oversized"])("rejects %s paths", mode => {
    const candidate = path();
    if (mode === "nonfinite") candidate.offsets[0].x = NaN;
    if (mode === "missing") candidate.movingTileIds = ["unknown"];
    if (mode === "duplicate") candidate.fixedTileIds.push("floor");
    if (mode === "fixed-moving") candidate.fixedTileIds.push("wall");
    if (mode === "no-move") candidate.offsets = [v(0, 0, 0), v(0, 0, 0)];
    if (mode === "wrong-end") candidate.offsets[1].x = 2;
    if (mode === "oversized") candidate.offsets = Array.from({length:65}, () => v(0,0,0));
    expect(validateInsertionPath(fixture(), candidate).status).toBe("fail");
  });

  it("does not let colliding moving parts masquerade as a prebuilt module", () => {
    const build = fixture();
    build.tiles.push({ ...build.tiles[1], id: "duplicate-panel" });
    const candidate = path();
    candidate.movingTileIds.push("duplicate-panel");
    expect(validateInsertionPath(build, candidate).detail).toMatch(/intersecting/);
  });

  it("honors the shared computation deadline", () => {
    expect(() => validateInsertionPath(fixture(), path(), Date.now() - 1)).toThrow(SimulationBudgetExceeded);
  });

  it("cannot insert a trapped panel through a completed shell", () => {
    const build = closedShell(1);
    build.tiles.push(square("trapped", v(-1.5, 1.5, -1.5), v(3,0,0), v(0,0,3), "red", 9, "fixture"));
    expect(findInsertionPath(build, ["trapped"], build.tiles.filter(t => t.id !== "trapped").map(t => t.id))).toBeNull();
  });

  it("renders the checked path with all installed obstacles and no future parts", () => {
    const build = fixture();
    build.tiles.push(square("future", v(6, 0, 0), v(3,0,0), v(0,0,3), "red", 9, "fixture"));
    const preview = insertionPreview(build, path(), 0.5);
    expect(preview.tiles.map(t => t.id)).toEqual(["floor", "wall"]);
    expect(preview.tiles[1].position.y).toBeCloseTo(build.tiles[1].position.y + 2);
    expect(preview.tiles[0]).toEqual(build.tiles[0]);
    expect(insertionPreview(build, path(), 1).tiles[1]).toEqual(build.tiles[1]);
  });
});

describe("complete source-stage insertion coverage", () => {
  it("plans all nine small-ramp parts and the separate module join", () => {
    const replica = smallRamp(), results = planConstructionPaths(replica);
    expect(results.map(r => r.status)).toEqual(["pass", "pass", "pass"]);
    expect(results.map(r => r.paths.length)).toEqual([5, 4, 1]);
    expect(results[2].paths[0].fixedTileIds).toEqual(replica.stages[0].tileIds);
    expect(results[2].paths[0].movingTileIds).toEqual(replica.stages[1].tileIds);
  });

  it.each(["missing", "hold-everything", "future-module", "duplicate", "extra-module-part"])("rejects %s construction shortcuts", mode => {
    const replica = smallRamp();
    if (mode === "missing") replica.construction![0].operations.pop();
    if (mode === "hold-everything") replica.construction![0].operations = [{ tileIds: replica.stages[0].tileIds }];
    if (mode === "future-module") replica.stages[0].installedStageIds = ["small-final"];
    if (mode === "duplicate") replica.construction!.push(replica.construction![0]);
    if (mode === "extra-module-part") replica.construction![2].operations[0].tileIds.push("small-back");
    expect(planConstructionPaths(replica).some(r => r.status === "fail")).toBe(true);
  });

  it("cannot clear the already installed wedge by reinstalling it after the launch", () => {
    const replica = smallRamp();
    replica.construction![2].operations.push({ tileIds: replica.stages[0].tileIds, preparedStageId: "small-wedge" });
    const final = planConstructionPaths(replica)[2];
    expect(final.status).toBe("fail");
    expect(final.paths[0].fixedTileIds).toEqual(replica.stages[0].tileIds);
    expect(final.detail).toMatch(/already installed/);
  });
});
