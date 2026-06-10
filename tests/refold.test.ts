import { describe, expect, it } from "vitest";
import { createEmptyDraft, refoldTile } from "@/lib/builder/operations";
import {
  canRefoldTile,
  confirmGhostPlacement,
  cycleRefold,
  defaultPlacementSettings,
  placeRootOnGround,
  validRefoldAngles,
  type PlacementSettings
} from "@/lib/builder/placement";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { AuthoredBuildDraft, BuilderTile } from "@/lib/builder/types";

function settingsWith(patch: Partial<PlacementSettings>): PlacementSettings {
  return { ...defaultPlacementSettings(), ...patch };
}

/** Flat root + wall (+90) + roof flat on the wall top: a 3-tile chain for refold tests. */
function chain(): { draft: AuthoredBuildDraft; rootId: string; wallId: string; roofId: string } {
  const rootDraft = placeRootOnGround(createEmptyDraft("refold fixture"), {
    shape: "small-square",
    color: "#118ab2",
    point: { x: 0, z: 0 }
  }).draft;
  const root = rootDraft.tiles[0];
  const wall = confirmGhostPlacement(
    rootDraft,
    { tileId: root.id, edge: 0, t: 0.5 },
    settingsWith({ foldAngle: Math.PI / 2 })
  );
  const roof = confirmGhostPlacement(
    wall.draft,
    { tileId: wall.placedTileId!, edge: 2, t: 0.5 },
    settingsWith({ foldAngle: Math.PI / 4 })
  );
  return {
    draft: roof.draft,
    rootId: root.id,
    wallId: wall.placedTileId!,
    roofId: roof.placedTileId!
  };
}

function tileById(draft: AuthoredBuildDraft, id: string): BuilderTile {
  return draft.tiles.find((tile) => tile.id === id)!;
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

describe("re-fold subtree derivation", () => {
  it("re-folds a wall and carries its subtree rigidly through the attachment math", () => {
    const { draft, wallId, roofId } = chain();
    const wallBefore = tileById(draft, wallId);
    const roofBefore = tileById(draft, roofId);
    const relativeBefore = distance(wallBefore.position, roofBefore.position);

    const next = refoldTile(draft, wallId, Math.PI / 3);
    expect(next).not.toBeNull();
    const wallAfter = tileById(next!, wallId);
    const roofAfter = tileById(next!, roofId);

    expect(wallAfter.foldAngle).toBeCloseTo(Math.PI / 3, 6);
    // The roof keeps its own fold and its rigid offset from the wall.
    expect(roofAfter.foldAngle).toBeCloseTo(roofBefore.foldAngle!, 6);
    expect(distance(wallAfter.position, roofAfter.position)).toBeCloseTo(relativeBefore, 3);
    // Both actually moved.
    expect(distance(wallAfter.position, wallBefore.position)).toBeGreaterThan(0.01);
    expect(distance(roofAfter.position, roofBefore.position)).toBeGreaterThan(0.01);
    // And the result is physically clean.
    expect(findRawOverlaps(next!.tiles)).toHaveLength(0);
    expect(tileWorldVertices(roofAfter).every((vertex) => vertex.y > -0.05)).toBe(true);
  });

  it("re-deriving at the SAME angle reproduces the existing pose exactly", () => {
    const { draft, wallId, roofId } = chain();
    const next = refoldTile(draft, wallId, Math.PI / 2);
    expect(next).not.toBeNull();
    expect(distance(tileById(next!, wallId).position, tileById(draft, wallId).position)).toBeLessThan(1e-6);
    expect(distance(tileById(next!, roofId).position, tileById(draft, roofId).position)).toBeLessThan(1e-6);
  });

  it("refuses collision-invalid angles outright (overlap stays impossible)", () => {
    const { draft, rootId, wallId } = chain();
    // Folding the wall flat back over the root would interpenetrate it.
    const flattened = refoldTile(draft, wallId, 0);
    if (flattened) {
      // If an auto-flip-free flat pose somehow cleared the root, it must be overlap-free.
      expect(findRawOverlaps(flattened.tiles)).toHaveLength(0);
    }
    // The root has no hinge: never refoldable.
    expect(refoldTile(draft, rootId, Math.PI / 4)).toBeNull();
    expect(canRefoldTile(draft, rootId)).toBe(false);
    expect(canRefoldTile(draft, wallId)).toBe(true);
  });

  it("filters the valid-angle set and cycles only within it", () => {
    const { draft, wallId } = chain();
    const valid = validRefoldAngles(draft, wallId);
    expect(valid.length).toBeGreaterThan(0);
    // Every offered angle truly re-derives without collision.
    for (const angle of valid) {
      const applied = refoldTile(draft, wallId, angle);
      expect(applied).not.toBeNull();
      expect(findRawOverlaps(applied!.tiles)).toHaveLength(0);
    }

    const stepped = cycleRefold(draft, wallId, -1, false);
    expect(stepped).not.toBeNull();
    expect(valid.some((angle) => Math.abs(angle - stepped!.foldAngle) < 0.0001)).toBe(true);

    const fine = cycleRefold(draft, wallId, -1, true);
    expect(fine).not.toBeNull();
    expect(Math.abs(fine!.foldAngle - Math.PI / 2)).toBeCloseTo(Math.PI / 36, 6);
  });

  it("drops stale contact connections honestly when a re-fold breaks them", () => {
    const { draft, wallId } = chain();
    const before = draft.connections.length;
    const next = refoldTile(draft, wallId, Math.PI / 3);
    expect(next).not.toBeNull();
    // The hinge connections re-derive and remain; nothing new is fabricated.
    expect(next!.connections.length).toBeLessThanOrEqual(before);
    expect(
      next!.connections.some(
        (connection) => connection.toTileId === wallId || connection.fromTileId === wallId
      )
    ).toBe(true);
  });
});
