import { describe, expect, it } from "vitest";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { releaseCandidate } from "@/lib/replication/release";
import { closedShell } from "./fixtures/closed-shell";

describe("closed magnetic shell contact stability", () => {
  it.each([2, 3])("lets a %i-ring shell reach sustained rest without artificial contact expansion", async (levels) => {
    const build = closedShell(levels);
    expect(findRawOverlaps(build.tiles)).toEqual([]);
    for (const seed of [0, 17, 53]) {
      const result = await releaseCandidate(build, seed);
      expect(result.poppedJoints).toEqual([]);
      expect(result.peakDisplacement).toBeLessThan(0.35);
      expect(result.status).toBe("pass");
      expect(result.settledSteps).toBeGreaterThanOrEqual(90);
    }
  }, 30_000);

  it("keeps colliders and contacts active on every hinged panel", async () => {
    const e = await createEngineWorld(closedShell(2));
    try {
      expect(e.bodies.size).toBe(9);
      for (const { body } of e.bodies.values()) {
        expect(body.numColliders()).toBe(1);
        expect(body.collider(0).isSensor()).toBe(false);
      }
      expect(e.joints.length).toBeGreaterThan(8);
      expect(e.joints.every(j => j.joint.contactsEnabled())).toBe(true);
    } finally { e.dispose(); }
  });
});
