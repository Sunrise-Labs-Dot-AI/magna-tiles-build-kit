import { describe, expect, it } from "vitest";
import { replicas, jet, smallRamp } from "@/lib/replication/models";
import {
  assemble,
  rigidPanel,
  square,
  stageBuild,
  v,
  IDENTITY,
} from "@/lib/replication/geometry";
import {
  fingerprint,
  sha256,
  geometryCheck,
  instructions,
  sourceInventoryCheck,
  validateObservationBinding,
  verifyLocalSource,
} from "@/lib/replication/evaluate";
import { compareObservation, projectPoint } from "@/lib/replication/projection";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { Camera, Observation } from "@/lib/replication/types";
import data from "@/verification/replication/observations.json";
import { releaseCandidate } from "@/lib/replication/release";
import { evaluateReferenceCandidate } from "@/lib/harness/reference";
import { assertArtifactDigest } from "@/lib/replication/provenance";
import sources from "@/verification/replication/sources.json";

function projectionFixture() {
  const tiles = [
    square("floor", v(0, 0, 0), v(3, 0, 0), v(0, 0, 3), "blue", 1, "fixture"),
    square("wall", v(0, 0, 0), v(3, 0, 0), v(0, 3, 0), "red", 1, "fixture"),
    square("check", v(4, 2, 0), v(3, 0, 0), v(0, 3, 0), "green", 1, "fixture"),
  ];
  const build = assemble(
      "projection-fixture",
      "Measured fixture",
      tiles,
      "ramp",
    ),
    camera: Camera = {
      position: v(13, 12, 24),
      target: v(1.5, 1, 1),
      up: v(0, 1, 0),
      focal: 900,
      cx: 640,
      cy: 360,
    };
  const observation: Observation = {
    id: "synthetic-camera",
    replicaId: "fixture",
    frameId: "fixture",
    stageId: "fixture",
    partition: "holdout",
    width: 1280,
    height: 720,
    viewDirection: v(11.5, 11, 23),
    landmarks: tiles.flatMap((t) =>
      tileWorldVertices(t).map((point, vertex) => ({
        id: `${t.id}-${vertex}`,
        tileId: t.id,
        vertex,
        pixel: projectPoint(point, camera),
        uncertaintyPx: 1,
        use: t.id === "check" ? ("check" as const) : ("camera" as const),
      })),
    ),
  };
  return { build, observation, camera };
}

describe("footage-bound reconstruction", () => {
  it("preserves Euler-only part orientations across stage transforms and settling", async () => {
    const tile = square(
      "euler",
      v(0, 0, 0),
      v(3, 0, 0),
      v(0, 3, 0),
      "blue",
      1,
      "fixture",
    );
    delete tile.basis;
    tile.rotation = v(Math.PI / 2, 0, 0);
    tile.position = v(0, 0.09, 0);
    const build = assemble("euler-fixture", "Euler-only tile", [tile], "ramp"),
      before = tileWorldVertices(tile);
    const transformed = stageBuild(
      { build },
      {
        id: "move",
        frameId: "fixture",
        title: "move",
        instruction: "move",
        tileIds: [tile.id],
        support: "released",
        transform: { basis: IDENTITY, translation: v(2, 3, 4) },
      },
    );
    tileWorldVertices(transformed.tiles[0]).forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x + 2);
      expect(p.y).toBeCloseTo(before[i].y + 3);
      expect(p.z).toBeCloseTo(before[i].z + 4);
    });
    const result = await releaseCandidate(build, 0);
    expect(result.status).toBe("pass");
    expect(Math.abs(result.settled.tiles[0].basis!.zAxis.y)).toBeCloseTo(1, 2);
  });
  it("detects edited verdicts and SVGs independently of model fingerprints", () => {
    const original = JSON.stringify({
      fingerprint: "unchanged",
      checks: { fidelity: { status: "fail" } },
    });
    const edited = original.replace('"fail"', '"pass"');
    expect(() =>
      assertArtifactDigest("report", original, sha256(original)),
    ).not.toThrow();
    expect(() =>
      assertArtifactDigest("report", edited, sha256(original)),
    ).toThrow(/artifact changed/);
    expect(() =>
      assertArtifactDigest(
        "comparison.svg",
        "<svg>changed</svg>",
        sha256("<svg/>"),
      ),
    ).toThrow(/artifact changed/);
  });
  it("binds every construction link to its corresponding source operation", () => {
    for (const r of replicas())
      for (const stage of r.stages)
        expect(
          sources.sources
            .find((s) => s.id === r.sourceId)!
            .frames.find((f) => f.id === stage.frameId)?.stage,
        ).toBe(stage.id);
  });
  it("requires sustained rest and records every-step peak motion", async () => {
    const r = smallRamp(),
      before = structuredClone(r.build),
      result = await releaseCandidate(r.build, 0);
    expect(result.status).toBe("pass");
    expect(result.settledSteps).toBeGreaterThanOrEqual(90);
    expect(result.peakDisplacement).toBeGreaterThanOrEqual(
      result.finalDisplacement,
    );
    expect(r.build).toEqual(before);
    await expect(releaseCandidate(r.build, 0, -Infinity)).rejects.toThrow(
      /budget/,
    );
  });
  it("evaluates external candidates through the harness without trusting stored geometry", async () => {
    const target = smallRamp();
    const report = await evaluateReferenceCandidate(
      { ...target.build, tiles: [], connections: [] },
      target,
      [],
    );
    expect(report.checks.geometry.status).toBe("fail");
    expect(report.replication).toBe("not-verified");
  });
  it("retains all four BOMs and catalog dimensions without relaxing intersections", () => {
    expect(replicas().map((r) => r.build.tiles.length)).toEqual([
      40, 9, 37, 51,
    ]);
    for (const r of replicas()) {
      expect(sourceInventoryCheck(r).status).toBe("pass");
      expect(geometryCheck(r.build).status).toBe("pass");
    }
    expect(() =>
      rigidPanel(
        "stretched",
        "small-square",
        [v(0, 0, 0), v(4, 0, 0), v(4, 3, 0), v(0, 3, 0)],
        "red",
        1,
        "bad",
      ),
    ).toThrow(/Non-catalog/);
  });
  it("does not accept a candidate's own inventory, title or old approximation as source truth", async () => {
    const r = jet();
    r.build.tiles.pop();
    r.title = "Verified replica";
    r.inventory["small-square"] = 999;
    expect(sourceInventoryCheck(r).status).toBe("fail");
    r.sourceId = "invented-source";
    expect((await verifyLocalSource(r)).status).toBe("fail");
  });
  it("preserves stage poses and stable part numbers across separately held modules", () => {
    const r = jet(),
      before = structuredClone(r.build),
      stage = r.stages[0],
      upright = stageBuild(r, stage);
    expect(upright.tiles[0].position.y).toBeCloseTo(before.tiles[0].position.x);
    expect(r.build).toEqual(before);
    const small = smallRamp(),
      steps = instructions(small);
    expect(steps[1].instruction).toContain("P6");
    expect(steps[2].instruction).toContain("Reuse the numbered parts");
    expect(() => stageBuild(r, { ...stage, tileIds: ["missing"] })).toThrow(
      /membership/,
    );
    expect(() =>
      stageBuild(r, {
        ...stage,
        transform: {
          translation: v(0, 0, 0),
          basis: { ...IDENTITY, xAxis: v(2, 0, 0) },
        },
      }),
    ).toThrow(/Non-rigid/);
  });
  it("binds observations to the exact source, construction stage and reserved partition", () => {
    const r = smallRamp(),
      o = structuredClone(data.observations[1]) as Observation;
    expect(() => validateObservationBinding(r, o)).not.toThrow();
    o.partition = "fit";
    expect(() => validateObservationBinding(r, o)).toThrow(/mismatch/);
    const invalid = structuredClone(
      data.observations[1],
    ) as unknown as Observation;
    Object.assign(invalid, { partition: "construction" });
    expect(() => validateObservationBinding(r, invalid)).toThrow(/labels/);
    Object.assign(invalid, { partition: "holdout" });
    Object.assign(invalid.landmarks[0], { use: "fit" });
    expect(() => compareObservation(r.build, invalid)).toThrow(/Invalid/);
    expect(fingerprint(r, [o])).not.toBe(
      fingerprint(
        { ...r, build: { ...r.build, tiles: r.build.tiles.slice(1) } },
        [o],
      ),
    );
  });
  it("recovers a perspective camera from independent depth anchors", () => {
    const { build, observation } = projectionFixture(),
      r = compareObservation(build, observation);
    expect(r.status).toBe("pass");
    expect(r.rmsPx).toBeLessThan(0.1);
  });
  it("does not fit the camera to scored corners and rejects displaced target parts", () => {
    const { build, observation } = projectionFixture(),
      original = compareObservation(build, observation);
    const changed = structuredClone(observation);
    for (const l of changed.landmarks) if (l.use === "check") l.pixel[0] += 100;
    const alternate = compareObservation(build, changed);
    expect(alternate.camera).toEqual(original.camera);
    expect(alternate.status).toBe("fail");
    build.tiles[2].position.x += 2;
    expect(
      compareObservation(build, observation, original.camera!).status,
    ).toBe("fail");
  });
  it("rejects degenerate anchors, duplicate scored vertices and oversized observations", () => {
    const { build, observation } = projectionFixture();
    const duplicate = structuredClone(observation);
    duplicate.landmarks.push({ ...duplicate.landmarks[0], id: "duplicate" });
    expect(() => compareObservation(build, duplicate)).toThrow(
      /Invalid landmark/,
    );
    const oversized = {
      ...observation,
      landmarks: Array(100).fill(observation.landmarks[0]),
    };
    expect(() => compareObservation(build, oversized)).toThrow(/oversized/);
    const flat = structuredClone(observation);
    flat.landmarks = flat.landmarks.filter((l) => l.tileId !== "wall");
    expect(compareObservation(build, flat).status).toBe("unverified");
  });
});
