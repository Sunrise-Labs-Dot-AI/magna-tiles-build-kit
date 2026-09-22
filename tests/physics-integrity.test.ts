import { describe, expect, it } from "vitest";
import smallRamp from "@/build-drafts/small-car-ramp.json";
import { gateBuild } from "@/lib/engine/gate";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import type { EngineBuild } from "@/lib/engine/build";
import { gravityVector } from "@/lib/engine/physics-model";
import {
  addFreeformTile,
  addRootTile,
  createEmptyDraft,
  snapNearestEdge,
} from "@/lib/builder/operations";

describe("physics integrity regressions", () => {
  it("uses inches per second squared for terrestrial gravity", () => {
    expect(gravityVector().y).toBeCloseTo(-9.81 / 0.0254, 1);
  });

  it("detects rotation around a stationary tile center", async () => {
    const engine = await createEngineWorld(smallRamp as EngineBuild, {
      drop: false,
    });
    try {
      const record = [...engine.bodies.values()][0];
      record.body.setRotation(
        { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
        true,
      );
      for (const axis of ["x", "y", "z"] as const)
        expect(record.body.translation()[axis]).toBeCloseTo(
          record.targetPosition[axis],
          5,
        );
      expect(engine.maxDisplacement()).toBeGreaterThan(1);
    } finally {
      engine.dispose();
    }
  });

  it.each(["nonfinite", "nonrigid", "duplicate", "null", "bad-edge"])(
    "rejects %s geometry before running WASM",
    async (mode) => {
      const build = structuredClone(smallRamp) as EngineBuild;
      if (mode === "nonfinite") build.tiles[0].position.x = NaN;
      if (mode === "nonrigid") build.tiles[0].basis!.xAxis.x = 50;
      if (mode === "duplicate") build.tiles.push(build.tiles[0]);
      if (mode === "null") build.tiles.push(null as never);
      if (mode === "bad-edge") build.connections[0].fromEdge = 999;
      await expect(gateBuild(build)).resolves.toMatchObject({ passed: false });
    },
  );

  it("does not teleport distant loose tiles into a magnetic join", () => {
    const base = addRootTile(createEmptyDraft("snap test"), {
      shape: "small-square",
      position: { x: 0, y: 1.5, z: 0 },
    });
    const draft = addFreeformTile(base, {
      shape: "small-square",
      position: { x: 5, y: 1.5, z: 0 },
    });
    expect(snapNearestEdge(draft, draft.tiles[1].id)).toBe(draft);
  });

  it("does not move a locked tile during snapping", () => {
    const base = addRootTile(createEmptyDraft("snap test"), {
      shape: "small-square",
      position: { x: 0, y: 1.5, z: 0 },
    });
    const draft = addFreeformTile(base, {
      shape: "small-square",
      position: { x: 3.05, y: 1.5, z: 0 },
    });
    draft.tiles[1].locked = true;
    expect(snapNearestEdge(draft, draft.tiles[1].id)).toBe(draft);
  });
});
