import { describe, expect, it } from "vitest";
import { createEmptyDraft, draftToBuildGraph } from "@/lib/builder/operations";
import { placeRootOnGround } from "@/lib/builder/placement";
import { validateMagneticBuild } from "@/lib/engine/build";
import { gateBuild } from "@/lib/engine";
import type { EngineBuild } from "@/lib/engine";
import type { TileInstance } from "@/lib/magnetic-tiles/types";

/**
 * Multi-island gate semantics: connectivity is judged per connected component, with
 * per-component ground support. Two separate grounded towers on a table are physically
 * real; a floating fragment is not. This is a semantic correction, not a loosening —
 * floating tiles still fail, and declared-but-fake connections still fail.
 */
describe("per-component ground support (multi-island builds)", () => {
  it("accepts two disconnected, individually grounded islands", async () => {
    let draft = placeRootOnGround(createEmptyDraft("two-islands"), {
      shape: "small-square",
      color: "#118ab2",
      point: { x: 0, z: 0 }
    }).draft;
    draft = placeRootOnGround(draft, {
      shape: "small-square",
      color: "#ffb703",
      point: { x: 9, z: 0 }
    }).draft;
    expect(draft.tiles).toHaveLength(2);

    const build = draftToBuildGraph(draft);
    const validation = validateMagneticBuild({ ...build, connections: build.connections ?? [] });
    expect(validation.rejectedReasons).toEqual([]);

    const verdict = await gateBuild(build);
    expect(verdict.passed).toBe(true);
  });

  it("accepts two grounded STANDING islands (each rests on its own edge)", async () => {
    let draft = placeRootOnGround(createEmptyDraft("two-walls"), {
      shape: "small-square",
      color: "#118ab2",
      point: { x: 0, z: 0 },
      foldAngle: 0
    }).draft;
    draft = placeRootOnGround(draft, {
      shape: "large-square",
      color: "#06d6a0",
      point: { x: 12, z: 0 },
      foldAngle: 0
    }).draft;
    const validation = validateMagneticBuild(draftToBuildGraph(draft));
    expect(validation.rejectedReasons).toEqual([]);
  });

  it("still rejects a genuinely floating tile (component with no ground support)", async () => {
    const floating: EngineBuild = {
      id: "floating-fragment",
      title: "Floating fragment",
      family: "house",
      tiles: [
        groundedTile("grounded", { x: 0, y: 0.09, z: 0 }),
        { ...groundedTile("floater", { x: 9, y: 4, z: 0 }), root: true }
      ],
      connections: []
    };

    const validation = validateMagneticBuild(floating);
    expect(validation.rejectedReasons.some((reason) => reason.startsWith("ungrounded-component:floater"))).toBe(true);
    // The grounded tile's own component is fine — only the floater is rejected.
    expect(validation.rejectedReasons.some((reason) => reason.endsWith(":grounded"))).toBe(false);

    const verdict = await gateBuild(floating);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("ungrounded-component:floater");
  });

  it("still rejects a declared connection that is not a real magnetic edge match", async () => {
    const fake: EngineBuild = {
      id: "fake-connection",
      title: "Fake connection",
      family: "house",
      tiles: [
        groundedTile("first", { x: 0, y: 0.09, z: 0 }),
        groundedTile("second", { x: 9, y: 0.09, z: 0 })
      ],
      connections: [{ fromTileId: "first", fromEdge: 1, toTileId: "second", toEdge: 3, kind: "edge" }]
    };

    const validation = validateMagneticBuild(fake);
    expect(validation.rejectedReasons.some((reason) => reason.startsWith("invalid-edge:"))).toBe(true);

    const verdict = await gateBuild(fake);
    expect(verdict.passed).toBe(false);
  });
});

function groundedTile(id: string, position: { x: number; y: number; z: number }): TileInstance {
  return {
    id,
    shape: "small-square",
    color: "#118ab2",
    position,
    rotation: { x: 0, y: 0, z: 0 },
    basis: {
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 0, y: 1, z: 0 }
    },
    step: 1,
    role: "flat panel",
    root: true
  };
}
