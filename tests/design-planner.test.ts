import { describe, expect, it } from "vitest";
import { designBuild } from "@/lib/planner/design";
import { parseDesignBrief } from "@/lib/planner/brief";
import { courseCandidates } from "@/lib/planner/candidates";
import { checkCourse } from "@/lib/planner/route-checks";
import { testCars } from "@/lib/planner/car-test";
import { POST } from "@/app/api/design-build/route";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import { exactPrismDepth } from "./fixtures/contact-frames";

const sprint = "a downhill racecourse for two side by side cars";

describe("simulation-gated design planner", () => {
  it("seats the generated launch platform and rear walls on finite support faces", () => {
    const { build } = courseCandidates(parseDesignBrief(sprint))[0];
    const platform = build.tiles.find((t) => t.id === "large-top-platform-panel")!;
    const top = (tile: typeof platform) =>
      Math.max(...tilePrismVertices(tile).map((p) => p.y));
    const bottom = (tile: typeof platform) =>
      Math.min(...tilePrismVertices(tile).map((p) => p.y));
    const supports = build.tiles.filter((t) => /platform.*wall|side-brace/.test(t.id));
    expect(supports.length).toBeGreaterThan(0);
    for (const support of supports) {
      expect(exactPrismDepth(platform, support)).toBeLessThan(1e-7);
    }
    expect(bottom(platform)).toBeCloseTo(Math.max(...supports.map(top)), 8);
    const walls = build.tiles.filter((t) => /upper-rear-wall/.test(t.id));
    expect(walls).toHaveLength(2);
    for (const wall of walls) {
      expect(bottom(wall)).toBeCloseTo(top(platform), 8);
      expect(exactPrismDepth(platform, wall)).toBeLessThan(1e-7);
    }
  });

  it("produces a two-car sprint with recorded free dynamics and stable assembly steps", async () => {
    const result = await designBuild(sprint);
    expect(result.status).toBe("simulation-passed");
    expect(result.checks.every((c) => c.status === "pass")).toBe(true);
    expect(result.checks.some((c) => c.code === "assembly")).toBe(true);
    expect(result.trials).toHaveLength(2);
    for (const trial of result.trials) {
      expect(trial.passed).toBe(true);
      expect(trial.samples[0].time).toBe(0);
      expect(trial.samples.at(-1)!.position.y).toBeLessThan(
        trial.samples[0].position.y,
      );
      expect(trial.reachedWaypoint).toBe(result.lanes[0].waypoints.length - 1);
      expect(trial.contactEvidence?.roadContactSteps).toBeGreaterThan(10);
      expect(trial.contactEvidence?.postRunStructurePassed).toBe(true);
    }
    expect(new Set(result.instructions.flatMap((s) => s.tileIds)).size).toBe(
      result.build.tiles.length,
    );
    expect(
      result.instructions.every((s) => /P\d+ edge \d/.test(s.instruction)),
    ).toBe(true);
    expect(
      result.candidates.find((c) => c.id === result.build.id)?.passed,
    ).toBe(true);
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
  });

  it("does not substitute a straight ramp for the requested zigzag", async () => {
    const result = await designBuild(
      "a zigzagging downhill racecourse for two side by side cars",
    );
    expect(result.brief).toMatchObject({ lanes: 2, turns: 2, downhill: true });
    expect(result.status).toBe("needs-repair");
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates.every((c) => !c.passed)).toBe(true);
    expect(
      result.checks.some(
        (c) => c.code.endsWith("-turns") && c.status === "fail",
      ),
    ).toBe(true);
    expect(result.trials).toEqual([]);
  });

  it("fails closed when the prompt asks for a feature outside the grammar", async () => {
    const result = await designBuild(`${sprint} with a loop`);
    expect(result.status).toBe("needs-repair");
    expect(
      result.checks.find((c) => c.code === "unsupported-prompt"),
    ).toMatchObject({ status: "unverified" });
    expect(result.brief.unsupportedTerms).toContain("loop");
  });

  it("detects a missing driving tile even when the named route still exists", () => {
    const brief = parseDesignBrief(sprint);
    const { build, lanes } = courseCandidates(brief)[0];
    build.tiles = build.tiles.filter(
      (t) => !lanes[0].surfaceTileIds.includes(t.id),
    );
    const checks = checkCourse(build, lanes, brief);
    expect(
      checks
        .filter((c) => c.code.endsWith("-surface"))
        .every((c) => c.status === "fail"),
    ).toBe(true);
  });

  it("detects a car whose tires cannot fit on the actual surface", () => {
    const brief = parseDesignBrief(sprint);
    const { build, lanes } = courseCandidates(brief)[0];
    brief.car.width = 7;
    expect(
      checkCourse(build, lanes, brief)
        .filter((c) => c.code.endsWith("-width"))
        .every((c) => c.status === "fail"),
    ).toBe(true);
  });

  it("does not steer or propel cars uphill to satisfy waypoints", async () => {
    const brief = parseDesignBrief(sprint);
    const { build, lanes } = courseCandidates(brief)[0];
    const uphill = lanes.map((lane) => ({
      ...lane,
      waypoints: [...lane.waypoints].reverse(),
    }));
    expect(
      (await testCars(build, uphill, brief)).every((trial) => !trial.passed),
    ).toBe(true);
  });

  it("scores translated builds and routes in the same grounded coordinates", async () => {
    const brief = parseDesignBrief(sprint),
      candidate = courseCandidates(brief)[0];
    const original = await testCars(candidate.build, candidate.lanes, brief);
    const shifted = structuredClone(candidate);
    for (const tile of shifted.build.tiles) tile.position.y += 17;
    for (const lane of shifted.lanes) for (const p of lane.waypoints) p.y += 17;
    const translated = await testCars(shifted.build, shifted.lanes, brief);
    expect(original.every((t) => t.passed)).toBe(true);
    expect(translated.map((t) => [t.passed, t.reachedWaypoint])).toEqual(
      original.map((t) => [t.passed, t.reachedWaypoint]),
    );
  });

  it("requires contact with named driving tiles even when another road is present", async () => {
    const brief = parseDesignBrief(sprint),
      { build, lanes } = courseCandidates(brief)[0];
    const support = build.tiles.find(
      (t) => !lanes.flatMap((l) => l.surfaceTileIds).includes(t.id),
    )!;
    expect(support).toBeDefined();
    const results = await testCars(
      build,
      lanes.map((l) => ({ ...l, surfaceTileIds: [support.id] })),
      brief,
    );
    expect(results.every((t) => !t.passed)).toBe(true);
    expect(results.every((t) => t.reason.includes("lost contact"))).toBe(true);
  });

  it("rejects nonfinite routes and missing surface IDs before simulation", async () => {
    const brief = parseDesignBrief(sprint),
      { build, lanes } = courseCandidates(brief)[0];
    lanes[0].waypoints[0].x = NaN;
    lanes[1].surfaceTileIds = ["absent"];
    expect(
      (await testCars(build, lanes, brief)).every(
        (t) => !t.passed && t.samples.length === 0,
      ),
    ).toBe(true);
  });
  it("returns failure for a vertical route instead of constructing a degenerate chassis", async () => {
    const brief = parseDesignBrief(sprint),
      { build, lanes } = courseCandidates(brief)[0];
    for (const lane of lanes)
      lane.waypoints = [
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 1, z: 0 },
      ];
    expect(
      (await testCars(build, lanes, brief)).every(
        (t) => !t.passed && t.samples.length === 0,
      ),
    ).toBe(true);
  });

  it.each([
    "{}",
    "null",
    "{bad json",
    JSON.stringify({ prompt: "x".repeat(1001) }),
  ])("rejects malformed API input: %s", async (body) => {
    const response = await POST(
      new Request("http://localhost/api/design-build", {
        method: "POST",
        body,
      }),
    );
    expect(response.status).toBe(400);
  });
});
