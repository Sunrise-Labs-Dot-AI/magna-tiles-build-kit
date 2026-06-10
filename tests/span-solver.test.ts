import { describe, expect, it } from "vitest";
import { createEmptyDraft, draftToBuildGraph } from "@/lib/builder/operations";
import { placeTilesAsIsland } from "@/lib/builder/prefabs";
import { PRESET_FOLDS } from "@/lib/builder/placement";
import { commitSpanPlacement, solveSpanPlacement } from "@/lib/builder/span";
import { gateBuild } from "@/lib/engine";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { box } from "@/lib/magnetic-tiles/macros";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import type { AuthoredBuildDraft } from "@/lib/builder/types";

/**
 * The user's two-tower ramp: a 3-high 2-wide tower (3x2x2 of small squares), a 2x2x2
 * tower across a gap, and an XL square spanning from the taller tower's top edge to the
 * shorter tower's top edge. The solved fold is a non-preset angle (the ≈30° class set
 * by the 1-square drop over the XL span), and the whole scene must pass the gate.
 */

/** Distance between facing wall planes so hinge→target distance is exactly the XL span (6). */
const EXACT_WALL_GAP = Math.sqrt(6 * 6 - 3 * 3); // √27 ≈ 5.196

function towerScene(wallGap: number): {
  draft: AuthoredBuildDraft;
  anchor: { tileId: string; edge: number };
  target: { tileId: string; edge: number };
} {
  let draft = createEmptyDraft("two-tower ramp");
  const tall = box({ id: "tall", width: 2, height: 3, depth: 2, openFaces: ["top", "bottom"], color: "#118ab2" });
  const short = box({ id: "short", width: 2, height: 2, depth: 2, openFaces: ["top", "bottom"], color: "#06d6a0" });

  const tallResult = placeTilesAsIsland(draft, tall, { x: 0, y: 0, z: 0 }, "tall");
  expect(tallResult.placedTileIds.length).toBeGreaterThan(0);
  draft = tallResult.draft;

  // The tall tower's right wall plane sits at x = 6.09; the short tower's left wall
  // plane sits at origin.x − 0.09.
  const shortOriginX = 6.09 + wallGap + 0.09;
  const shortResult = placeTilesAsIsland(draft, short, { x: shortOriginX, y: 0, z: 0 }, "short");
  expect(shortResult.placedTileIds.length).toBeGreaterThan(0);
  draft = shortResult.draft;

  return {
    draft,
    anchor: { tileId: "pf1-tall-right-1-3", edge: 2 },
    target: { tileId: "pf2-short-left-1-2", edge: 2 }
  };
}

describe("solved-angle span placement (the two-tower ramp)", () => {
  it("solves the XL ramp between a 3-high and a 2-high tower at a non-preset ≈30° slope, and the scene passes the gate", async () => {
    const { draft, anchor, target } = towerScene(EXACT_WALL_GAP);

    const solution = solveSpanPlacement(draft, anchor, target, {
      shape: "xl-square",
      childEdge: 0,
      color: "#ef476f"
    });
    expect(solution.ok).toBe(true);
    if (!solution.ok) return;

    // The solved fold is NOT one of the Q/E presets.
    expect(PRESET_FOLDS.every((preset) => Math.abs(solution.foldAngle - preset) > 0.05)).toBe(true);

    // The ramp plane slopes ≈30° from horizontal: a 3 drop across the XL span of 6.
    const normal = solution.tile.basis!.zAxis;
    const slopeDegrees = (Math.acos(Math.abs(normal.y)) * 180) / Math.PI;
    expect(slopeDegrees).toBeGreaterThan(28);
    expect(slopeDegrees).toBeLessThan(32);

    // The far edge seats on the target edge within magnetic tolerance.
    expect(solution.seatDistance).toBeLessThanOrEqual(0.68);

    const committed = commitSpanPlacement(draft, anchor, target, solution, {
      shape: "xl-square",
      childEdge: 0,
      color: "#ef476f"
    });
    expect(committed.placedTileId).not.toBeNull();
    const placed = committed.draft.tiles.find((tile) => tile.id === committed.placedTileId)!;

    // Connected on BOTH edges: the hinge to the tall tower and the seat on the short one.
    const connections = committed.draft.connections.filter(
      (connection) => connection.fromTileId === placed.id || connection.toTileId === placed.id
    );
    const partnerIds = connections.flatMap((connection) => [connection.fromTileId, connection.toTileId]);
    expect(partnerIds).toContain(anchor.tileId);
    expect(partnerIds).toContain(target.tileId);

    const targetTile = committed.draft.tiles.find((tile) => tile.id === target.tileId)!;
    expect(findMagneticEdgeMatch(placed, targetTile)).not.toBeNull();

    // No raw overlaps anywhere, and the whole scene passes the engine gate.
    expect(findRawOverlaps(committed.draft.tiles)).toHaveLength(0);
    const verdict = await gateBuild(draftToBuildGraph(committed.draft));
    expect(verdict.passed).toBe(true);
  }, 60_000);

  it("REFUSES with the measured gap when the towers are too far apart (no forced snap)", () => {
    const farGap = 6.5; // hinge→target distance ≈ 7.16, gap ≈ 1.16 beyond the XL span
    const { draft, anchor, target } = towerScene(farGap);
    const tileCountBefore = draft.tiles.length;

    const refusal = solveSpanPlacement(draft, anchor, target, {
      shape: "xl-square",
      childEdge: 0,
      color: "#ef476f"
    });
    expect(refusal.ok).toBe(false);
    if (refusal.ok) return;
    expect(refusal.gap).toBeDefined();
    const expectedGap = Math.abs(Math.sqrt(farGap * farGap + 9) - 6);
    expect(refusal.gap!).toBeCloseTo(expectedGap, 2);
    expect(refusal.reason).toMatch(/gap/i);
    expect(draft.tiles).toHaveLength(tileCountBefore);
  });

  it("refuses non-parallel edges and non-quad tiles honestly", () => {
    const { draft, anchor } = towerScene(EXACT_WALL_GAP);
    // A side edge of the same wall is perpendicular to the anchor edge.
    const perpendicular = solveSpanPlacement(
      draft,
      anchor,
      { tileId: "pf1-tall-right-1-3", edge: 1 },
      { shape: "xl-square", childEdge: 0, color: "#ef476f" }
    );
    expect(perpendicular.ok).toBe(false);

    const triangle = solveSpanPlacement(
      draft,
      anchor,
      { tileId: "pf2-short-left-1-2", edge: 2 },
      { shape: "equilateral-triangle", childEdge: 0, color: "#ef476f" }
    );
    expect(triangle.ok).toBe(false);
    if (!triangle.ok) expect(triangle.reason).toMatch(/four-sided/i);
  });
});
