import { describe, expect, it } from "vitest";
import {
  FOLD_CHOICES,
  DEFAULT_FOLD_INDEX,
  clampChildEdge,
  collectTileSubtree,
  confirmGhostPlacement,
  cycleChildEdge,
  cycleFoldIndex,
  defaultPlacementSettings,
  deriveGhostPreview,
  foldAngleFromIndex,
  placeRootOnGround,
  snapRootPosition,
  type PlacementSettings
} from "@/lib/builder/placement";
import { createEmptyDraft } from "@/lib/builder/operations";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";
import type { AuthoredBuildDraft } from "@/lib/builder/types";

function settingsWith(patch: Partial<PlacementSettings>): PlacementSettings {
  return { ...defaultPlacementSettings(), ...patch };
}

function draftWithFlatRoot(): AuthoredBuildDraft {
  const { draft } = placeRootOnGround(createEmptyDraft("placement fixture"), {
    shape: "small-square",
    color: "#118ab2",
    point: { x: 0, z: 0 }
  });
  return draft;
}

describe("fold angle cycling", () => {
  it("exposes exactly the five valid fold options in order", () => {
    expect(FOLD_CHOICES.map((choice) => choice.radians)).toEqual([
      -Math.PI / 2,
      -Math.PI / 4,
      0,
      Math.PI / 4,
      Math.PI / 2
    ]);
  });

  it("wraps in both directions", () => {
    expect(cycleFoldIndex(FOLD_CHOICES.length - 1, 1)).toBe(0);
    expect(cycleFoldIndex(0, -1)).toBe(FOLD_CHOICES.length - 1);
  });

  it("returns to the starting fold after a full forward cycle", () => {
    let index = DEFAULT_FOLD_INDEX;
    for (let step = 0; step < FOLD_CHOICES.length; step += 1) {
      index = cycleFoldIndex(index, 1);
    }
    expect(index).toBe(DEFAULT_FOLD_INDEX);
  });

  it("maps fold indices to their radians", () => {
    FOLD_CHOICES.forEach((choice, index) => {
      expect(foldAngleFromIndex(index)).toBe(choice.radians);
    });
  });
});

describe("child edge cycling", () => {
  it("wraps at the shape's edge count", () => {
    expect(cycleChildEdge("small-square", 3, 1)).toBe(0);
    expect(cycleChildEdge("small-square", 0, -1)).toBe(3);
    expect(cycleChildEdge("equilateral-triangle", 2, 1)).toBe(0);
  });

  it("clamps the child edge when switching to a shape with fewer edges", () => {
    expect(clampChildEdge("equilateral-triangle", 3)).toBe(0);
    expect(clampChildEdge("equilateral-triangle", 2)).toBe(2);
    expect(clampChildEdge("small-square", 3)).toBe(3);
  });
});

describe("root tile ground placement", () => {
  it("snaps the clicked point to the root grid and rests the tile on the ground", () => {
    const position = snapRootPosition({ x: 1.61, z: -0.7 });
    expect(position.x).toBeCloseTo(1.5);
    expect(position.z).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(TILE_THICKNESS / 2);
  });

  it("snaps to multiples of the grid", () => {
    expect(snapRootPosition({ x: 2.2, z: -2.2 })).toMatchObject({ x: 1.5, z: -1.5 });
    expect(snapRootPosition({ x: 0.76, z: -3.7 })).toMatchObject({ x: 1.5, z: -3 });
  });

  it("places a flat root tile with its normal pointing up", () => {
    const draft = draftWithFlatRoot();
    expect(draft.tiles).toHaveLength(1);
    const root = draft.tiles[0];
    expect(root.root).toBe(true);
    expect(root.basis?.zAxis.y).toBeCloseTo(1);
    expect(root.position.y).toBeCloseTo(TILE_THICKNESS / 2);
  });

  it("refuses to place a root when tiles already exist", () => {
    const draft = draftWithFlatRoot();
    const result = placeRootOnGround(draft, {
      shape: "small-square",
      color: "#ffb703",
      point: { x: 9, z: 9 }
    });
    expect(result.placedTileId).toBeNull();
    expect(result.draft).toBe(draft);
  });
});

describe("ghost preview derivation", () => {
  it("returns null without a hover target", () => {
    expect(deriveGhostPreview(draftWithFlatRoot(), null, settingsWith({}))).toBeNull();
  });

  it("derives a valid wall ghost from a +90 fold on a flat root", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const ghost = deriveGhostPreview(
      draft,
      { tileId: root.id, edge: 0, t: 0.5 },
      settingsWith({ foldIndex: DEFAULT_FOLD_INDEX })
    );
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(true);
    // The ghost rises above the flat root: a wall.
    expect(ghost!.tile.position.y).toBeGreaterThan(root.position.y);
    // And the combined layout has no raw overlap.
    expect(findRawOverlaps([...draft.tiles, ghost!.tile])).toHaveLength(0);
  });

  it("auto-flips the edge direction when a flat extension would cover the parent", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    // Flat fold, reverse=false, child edge 0 onto parent edge 0 folds the child back over
    // the parent. The resolver must flip direction so the tile extends outward instead.
    const ghost = deriveGhostPreview(
      draft,
      { tileId: root.id, edge: 0, t: 0.5 },
      settingsWith({ foldIndex: 2, reverse: false })
    );
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(true);
    expect(ghost!.autoFlipped).toBe(true);
    expect(ghost!.effectiveReverse).toBe(true);
    expect(findRawOverlaps([...draft.tiles, ghost!.tile])).toHaveLength(0);
  });

  it("marks the ghost invalid when no orientation avoids overlap", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const wallSettings = settingsWith({ foldIndex: DEFAULT_FOLD_INDEX });
    const placed = confirmGhostPlacement(draft, { tileId: root.id, edge: 0, t: 0.5 }, wallSettings);
    expect(placed.placedTileId).not.toBeNull();

    // Hovering the same magnet with the same fold now collides with the placed wall.
    const ghost = deriveGhostPreview(placed.draft, { tileId: root.id, edge: 0, t: 0.5 }, wallSettings);
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(false);
    expect(ghost!.reason).toMatch(/overlap/i);
  });
});

describe("ghost placement confirmation", () => {
  it("adds the tile and a connection through the edge-attachment write path", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const result = confirmGhostPlacement(
      draft,
      { tileId: root.id, edge: 1, t: 0.5 },
      settingsWith({ shape: "equilateral-triangle", foldIndex: DEFAULT_FOLD_INDEX, color: "#06d6a0" })
    );

    expect(result.placedTileId).not.toBeNull();
    expect(result.draft.tiles).toHaveLength(2);
    const placedTile = result.draft.tiles[1];
    expect(placedTile.shape).toBe("equilateral-triangle");
    expect(placedTile.parentTileId).toBe(root.id);
    expect(placedTile.authoredMode).toBe("edge-snap");
    expect(placedTile.confirmed).toBe(true);
    expect(
      result.draft.connections.some(
        (connection) => connection.fromTileId === root.id && connection.toTileId === result.placedTileId
      )
    ).toBe(true);
    expect(findRawOverlaps(result.draft.tiles)).toHaveLength(0);
  });

  it("matches the ghost geometry exactly: what you see is what you place", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const hover = { tileId: root.id, edge: 2, t: 0.25 };
    const settings = settingsWith({ foldIndex: 3, color: "#ef476f" });
    const ghost = deriveGhostPreview(draft, hover, settings);
    const result = confirmGhostPlacement(draft, hover, settings);
    const placed = result.draft.tiles.find((tile) => tile.id === result.placedTileId);

    expect(ghost?.valid).toBe(true);
    expect(placed).toBeDefined();
    expect(placed!.position.x).toBeCloseTo(ghost!.tile.position.x);
    expect(placed!.position.y).toBeCloseTo(ghost!.tile.position.y);
    expect(placed!.position.z).toBeCloseTo(ghost!.tile.position.z);
  });

  it("refuses blocked placements and leaves the draft untouched", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const wallSettings = settingsWith({ foldIndex: DEFAULT_FOLD_INDEX });
    const first = confirmGhostPlacement(draft, { tileId: root.id, edge: 0, t: 0.5 }, wallSettings);
    const second = confirmGhostPlacement(first.draft, { tileId: root.id, edge: 0, t: 0.5 }, wallSettings);

    expect(second.placedTileId).toBeNull();
    expect(second.draft).toBe(first.draft);
  });
});

describe("subtree deletion semantics", () => {
  function chainOfThree() {
    const rootDraft = draftWithFlatRoot();
    const root = rootDraft.tiles[0];
    const wall = confirmGhostPlacement(
      rootDraft,
      { tileId: root.id, edge: 0, t: 0.5 },
      settingsWith({ foldIndex: DEFAULT_FOLD_INDEX })
    );
    const roof = confirmGhostPlacement(
      wall.draft,
      { tileId: wall.placedTileId!, edge: 2, t: 0.5 },
      settingsWith({ foldIndex: 3 })
    );
    return {
      draft: roof.draft,
      rootId: root.id,
      wallId: wall.placedTileId!,
      roofId: roof.placedTileId!
    };
  }

  it("collects a tile with all attached descendants", () => {
    const { draft, rootId, wallId, roofId } = chainOfThree();
    expect(collectTileSubtree(draft, rootId)).toEqual([rootId, wallId, roofId]);
    expect(collectTileSubtree(draft, wallId)).toEqual([wallId, roofId]);
    expect(collectTileSubtree(draft, roofId)).toEqual([roofId]);
  });

  it("returns an empty list for unknown tiles", () => {
    const { draft } = chainOfThree();
    expect(collectTileSubtree(draft, "nope")).toEqual([]);
  });
});
