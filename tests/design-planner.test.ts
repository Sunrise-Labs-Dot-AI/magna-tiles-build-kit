import { describe, expect, it } from "vitest";
import { designBuild } from "@/lib/planner/design";
import { parseDesignBrief } from "@/lib/planner/brief";
import { courseCandidates } from "@/lib/planner/candidates";
import { checkCourse } from "@/lib/planner/route-checks";
import { testCars } from "@/lib/planner/car-test";
import { POST } from "@/app/api/design-build/route";

const sprint = "a downhill racecourse for two side by side cars";

describe("simulation-gated design planner", () => {
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
