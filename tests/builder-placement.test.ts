import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLD_INDEX,
  FOLD_CHOICES,
  FINE_FOLD_STEP,
  PRESET_FOLDS,
  SNAP_RADIUS,
  SNAP_RELEASE_RADIUS,
  candidateFoldAngles,
  clampChildEdge,
  collectSnapPoints,
  collectTileSubtree,
  confirmGhostPlacement,
  cycleChildEdge,
  cycleFold,
  cycleFoldIndex,
  defaultPlacementSettings,
  deriveGhostPreview,
  deriveHandTile,
  deriveRootGhost,
  foldAngleFromIndex,
  foldLabel,
  hoverKey,
  placeRootOnGround,
  resolveSnapHover,
  rootOrientationFromSettings,
  snapRootPosition,
  validFoldAngles,
  type PlacementSettings
} from "@/lib/builder/placement";
import { createEmptyDraft } from "@/lib/builder/operations";
import { placePrefabOnGround } from "@/lib/builder/prefabs";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
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

  it("starts a NEW grounded island when clicking open ground with tiles present", () => {
    const draft = draftWithFlatRoot();
    const result = placeRootOnGround(draft, {
      shape: "small-square",
      color: "#ffb703",
      point: { x: 9, z: 9 }
    });
    expect(result.placedTileId).not.toBeNull();
    expect(result.draft.tiles).toHaveLength(2);
    const second = result.draft.tiles[1];
    expect(second.root).toBe(true);
    expect(second.subassemblyId).not.toBe(draft.tiles[0].subassemblyId);
  });

  it("refuses a root that would interpenetrate an existing tile", () => {
    const draft = draftWithFlatRoot();
    const result = placeRootOnGround(draft, {
      shape: "small-square",
      color: "#ffb703",
      point: { x: 0, z: 0 }
    });
    expect(result.placedTileId).toBeNull();
    expect(result.draft).toBe(draft);
    expect(result.reason).toBeTruthy();
  });
});

describe("free root orientation", () => {
  it("maps the fold controls onto snapped root orientations", () => {
    // Flat
    expect(rootOrientationFromSettings({ foldAngle: 0, reverse: false })).toEqual({
      standAngle: 0,
      yaw: 0
    });
    // +90 stands upright; -90 stands upright facing the other way.
    expect(rootOrientationFromSettings({ foldAngle: Math.PI / 2, reverse: false })).toEqual({
      standAngle: Math.PI / 2,
      yaw: 0
    });
    expect(rootOrientationFromSettings({ foldAngle: -Math.PI / 2, reverse: false })).toEqual({
      standAngle: Math.PI / 2,
      yaw: Math.PI
    });
    // R adds a half-turn.
    expect(rootOrientationFromSettings({ foldAngle: Math.PI / 2, reverse: true })).toEqual({
      standAngle: Math.PI / 2,
      yaw: Math.PI
    });
    // Fine angles map directly: hinges are continuous.
    expect(rootOrientationFromSettings({ foldAngle: Math.PI / 6, reverse: false })).toEqual({
      standAngle: Math.PI / 6,
      yaw: 0
    });
  });

  it("places a standing root tile (normal horizontal, resting on its edge)", () => {
    const { draft, placedTileId } = placeRootOnGround(createEmptyDraft("standing"), {
      shape: "small-square",
      color: "#118ab2",
      point: { x: 0, z: 0 },
      foldAngle: Math.PI / 2,
      reverse: false
    });
    // Placement is not pre-gated: a lone standing tile is placeable; the engine gate
    // reports honestly whether it would stand.
    expect(placedTileId).not.toBeNull();
    const root = draft.tiles[0];
    expect(Math.abs(root.basis!.zAxis.y)).toBeLessThan(1e-9);
    // Standing on its edge: the center sits half an edge length up (thickness is
    // horizontal when the tile is vertical, so it does not lift the center).
    expect(root.position.y).toBeCloseTo(1.5);
  });

  it("rests the root tile exactly on the ground for every candidate fold angle", () => {
    candidateFoldAngles().forEach((foldAngle) => {
      [false, true].forEach((reverse) => {
        const { draft } = placeRootOnGround(createEmptyDraft(`fold-${foldAngle}-${reverse}`), {
          shape: "equilateral-triangle",
          color: "#06d6a0",
          point: { x: 1.4, z: -2.6 },
          foldAngle,
          reverse
        });
        const root = draft.tiles[0];
        const minY = Math.min(...tilePrismVertices(root, TILE_THICKNESS).map((point) => point.y));
        // The ground is never penetrated, at ANY angle: the resting height is solved.
        expect(minY).toBeGreaterThan(-1e-6);
        expect(minY).toBeLessThan(1e-6);
      });
    });
  });

  it("keeps the legacy flat default when foldAngle is omitted", () => {
    const { draft } = placeRootOnGround(createEmptyDraft("legacy"), {
      shape: "small-square",
      color: "#118ab2",
      point: { x: 0, z: 0 }
    });
    expect(draft.tiles[0].basis?.zAxis.y).toBeCloseTo(1);
    expect(draft.tiles[0].position.y).toBeCloseTo(TILE_THICKNESS / 2);
  });

  it("flips the standing tile's facing with reverse", () => {
    const forward = placeRootOnGround(createEmptyDraft("fwd"), {
      shape: "small-square",
      color: "#118ab2",
      point: { x: 0, z: 0 },
      foldAngle: Math.PI / 2,
      reverse: false
    }).draft.tiles[0];
    const flipped = placeRootOnGround(createEmptyDraft("rev"), {
      shape: "small-square",
      color: "#118ab2",
      point: { x: 0, z: 0 },
      foldAngle: Math.PI / 2,
      reverse: true
    }).draft.tiles[0];
    expect(forward.basis!.zAxis.z).toBeCloseTo(-flipped.basis!.zAxis.z);
  });
});

describe("hand ghost derivation", () => {
  it("derives a root ghost identical to what a click would place (WYSIWYG)", () => {
    const draft = createEmptyDraft("ghost-vs-place");
    const settings = settingsWith({ foldAngle: Math.PI / 2, shape: "large-square", color: "#ef476f" });
    const ghost = deriveRootGhost(draft, settings, { x: 3.2, z: -1.1 });
    const placed = placeRootOnGround(draft, {
      shape: settings.shape,
      color: settings.color,
      point: { x: 3.2, z: -1.1 },
      foldAngle: settings.foldAngle,
      reverse: settings.reverse
    }).draft.tiles[0];

    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(true);
    expect(ghost!.tile.shape).toBe(placed.shape);
    expect(ghost!.tile.position).toEqual(placed.position);
    expect(ghost!.tile.basis).toEqual(placed.basis);
  });

  it("marks the root ghost no-fit when it would land on an existing tile", () => {
    const draft = draftWithFlatRoot();
    const ghost = deriveRootGhost(draft, settingsWith({ foldAngle: 0 }), { x: 0, z: 0 });
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(false);
    // And away from the structure it is valid again (multi-island).
    const clear = deriveRootGhost(draft, settingsWith({ foldAngle: 0 }), { x: 12, z: 12 });
    expect(clear!.valid).toBe(true);
  });

  it("derives a held tile oriented like the root ghost at the origin", () => {
    const settings = settingsWith({ foldAngle: Math.PI / 4, reverse: true, shape: "isosceles-triangle" });
    const hand = deriveHandTile(settings);
    const rootGhost = deriveRootGhost(createEmptyDraft("origin"), settings, { x: 0, z: 0 });
    expect(hand.id).toBe("hand-ghost");
    expect(hand.position).toEqual(rootGhost!.tile.position);
    expect(hand.basis).toEqual(rootGhost!.tile.basis);
  });
});

describe("cursor-proximity snapping", () => {
  it("collects magnet pairs plus edge midpoints for every edge", () => {
    const draft = draftWithFlatRoot();
    const points = collectSnapPoints(draft);
    // small-square: 4 edges × (2 magnets + 1 midpoint)
    expect(points).toHaveLength(12);
    const midpoints = points.filter((point) => point.hover.magnetIndex === undefined);
    expect(midpoints).toHaveLength(4);
  });

  it("acquires the nearest snap point within the snap radius", () => {
    const draft = draftWithFlatRoot();
    const points = collectSnapPoints(draft);
    const target = points[0];
    const cursor = {
      x: target.position.x + SNAP_RADIUS * 0.5,
      y: target.position.y,
      z: target.position.z
    };
    const hover = resolveSnapHover(points, cursor, null);
    expect(hover).not.toBeNull();
    // It picked the actual nearest point, whichever that is.
    const nearest = [...points].sort(
      (a, b) =>
        distanceTo(a.position, cursor) - distanceTo(b.position, cursor)
    )[0];
    expect(hoverKey(hover)).toBe(hoverKey(nearest.hover));
  });

  it("holds the current snap until the cursor leaves the release radius (hysteresis)", () => {
    const draft = draftWithFlatRoot();
    const points = collectSnapPoints(draft);
    const target = points[0];
    const acquired = resolveSnapHover(points, target.position, null);
    expect(acquired).not.toBeNull();

    // Drift just past the acquire radius but inside the release radius: hover must hold.
    const drifted = {
      x: target.position.x,
      y: target.position.y + (SNAP_RADIUS + SNAP_RELEASE_RADIUS) / 2,
      z: target.position.z
    };
    const held = resolveSnapHover(points, drifted, acquired);
    expect(hoverKey(held)).toBe(hoverKey(acquired));

    // Without a current hover the same cursor would NOT acquire: that asymmetry is the
    // hysteresis that makes boundary micro-movements flicker-free.
    if (Math.min(...points.map((p) => distanceTo(p.position, drifted))) > SNAP_RADIUS) {
      expect(resolveSnapHover(points, drifted, null)).toBeNull();
    }

    // Far away: released.
    const far = { x: 50, y: 0, z: 50 };
    expect(resolveSnapHover(points, far, acquired)).toBeNull();
  });

  it("returns null without a cursor", () => {
    const draft = draftWithFlatRoot();
    expect(resolveSnapHover(collectSnapPoints(draft), null, null)).toBeNull();
  });
});

function distanceTo(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

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
      settingsWith({ foldAngle: Math.PI / 2 })
    );
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(true);
    expect(ghost!.autoAngled).toBe(false);
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
      settingsWith({ foldAngle: 0, reverse: false })
    );
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(true);
    expect(ghost!.autoFlipped).toBe(true);
    expect(ghost!.effectiveReverse).toBe(true);
    expect(findRawOverlaps([...draft.tiles, ghost!.tile])).toHaveLength(0);
  });

  it("auto-selects the nearest valid angle instead of offering an invalid ghost", () => {
    // Two flat islands 1.5 apart: a FLAT extension from island A's facing edge would
    // overlap island B, so the ghost must substitute a nearby rising angle instead.
    let draft = draftWithFlatRoot();
    const islandA = draft.tiles[0];
    draft = placeRootOnGround(draft, {
      shape: "small-square",
      color: "#ffb703",
      point: { x: 4.5, z: 0 },
      foldAngle: 0
    }).draft;

    const hover = { tileId: islandA.id, edge: 1, t: 0.5 };
    const flatSettings = settingsWith({ foldAngle: 0 });
    const ghost = deriveGhostPreview(draft, hover, flatSettings);
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(true);
    expect(ghost!.autoAngled).toBe(true);
    expect(Math.abs(ghost!.effectiveFoldAngle)).toBeGreaterThan(0.01);
    expect(findRawOverlaps([...draft.tiles, ghost!.tile])).toHaveLength(0);
  });

  it("shows a quiet no-fit ghost when NO candidate angle fits, and refuses the click", () => {
    // An XL square hinged on an interior bottom edge of a CLOSED box cannot fold
    // anywhere: outward is the wall, inward hits the far wall or lid, down is the floor.
    const { draft } = placePrefabOnGround(createEmptyDraft("no-fit"), "closed-box", { x: 0, z: 0 }, "#118ab2");
    const bottom = draft.tiles.find((tile) => tile.id.includes("bottom"));
    expect(bottom).toBeDefined();

    const settings = settingsWith({ shape: "xl-square", foldAngle: Math.PI / 2 });
    const hover = { tileId: bottom!.id, edge: 0, t: 0.5 };
    expect(validFoldAngles(draft, { kind: "hover", hover }, settings)).toHaveLength(0);

    const ghost = deriveGhostPreview(draft, hover, settings);
    expect(ghost).not.toBeNull();
    expect(ghost!.valid).toBe(false);
    expect(ghost!.noFit).toBe(true);

    const refused = confirmGhostPlacement(draft, hover, settings);
    expect(refused.placedTileId).toBeNull();
    expect(refused.draft).toBe(draft);
  });
});

describe("valid-angle filtering (Q/E never lands on a collision)", () => {
  it("skips collision-invalid angles when cycling presets", () => {
    let draft = draftWithFlatRoot();
    const islandA = draft.tiles[0];
    draft = placeRootOnGround(draft, {
      shape: "small-square",
      color: "#ffb703",
      point: { x: 4.5, z: 0 },
      foldAngle: 0
    }).draft;

    // Flat (0) is blocked toward island B; the valid set must exclude it, and cycling
    // must only ever land on members of the valid set.
    const hover = { tileId: islandA.id, edge: 1, t: 0.5 };
    const context = { kind: "hover", hover } as const;
    const flatSettings = settingsWith({ foldAngle: 0 });
    const valid = validFoldAngles(draft, context, flatSettings);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.every((angle) => Math.abs(angle) > 0.01)).toBe(true);

    let angle = Math.PI / 2;
    for (let step = 0; step < PRESET_FOLDS.length * 2; step += 1) {
      angle = cycleFold(draft, context, { ...flatSettings, foldAngle: angle }, 1, false);
      expect(valid.some((candidate) => Math.abs(candidate - angle) < 0.0001)).toBe(true);
    }
  });

  it("falls back to unfiltered cycling when the aimed spot has NO valid angle", () => {
    // The aimed root cell is occupied: no angle can place there (the click is a no-op),
    // so Q/E still cycles the fold rather than dead-locking.
    const draft = draftWithFlatRoot();
    const context = { kind: "root", point: { x: 0, z: 0 } } as const;
    const settings = settingsWith({ foldAngle: Math.PI / 2 });
    expect(validFoldAngles(draft, context, settings)).toHaveLength(0);
    expect(cycleFold(draft, context, settings, -1, false)).toBeCloseTo(Math.PI / 4, 6);
  });

  it("offers fine ±5° steps that are likewise collision-filtered", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const hover = { tileId: root.id, edge: 1, t: 0.5 };
    const settings = settingsWith({ foldAngle: Math.PI / 4 });
    const context = { kind: "hover", hover } as const;
    const fineUp = cycleFold(draft, context, settings, 1, true);
    expect(fineUp).toBeCloseTo(Math.PI / 4 + FINE_FOLD_STEP, 6);
    const fineDown = cycleFold(draft, context, settings, -1, true);
    expect(fineDown).toBeCloseTo(Math.PI / 4 - FINE_FOLD_STEP, 6);
  });

  it("keeps the legacy preset cycling helpers stable", () => {
    expect(FOLD_CHOICES.map((choice) => choice.radians)).toEqual(PRESET_FOLDS);
    expect(cycleFoldIndex(FOLD_CHOICES.length - 1, 1)).toBe(0);
    expect(foldAngleFromIndex(4)).toBe(Math.PI / 2);
    expect(foldLabel(Math.PI / 6)).toBe("+30°");
    expect(foldLabel(0)).toBe("Flat");
  });
});

describe("ghost placement confirmation", () => {
  it("adds the tile and a connection through the edge-attachment write path", () => {
    const draft = draftWithFlatRoot();
    const root = draft.tiles[0];
    const result = confirmGhostPlacement(
      draft,
      { tileId: root.id, edge: 1, t: 0.5 },
      settingsWith({ shape: "equilateral-triangle", foldAngle: Math.PI / 2, color: "#06d6a0" })
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
    const settings = settingsWith({ foldAngle: Math.PI / 4, color: "#ef476f" });
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
    const wallSettings = settingsWith({ foldAngle: Math.PI / 2 });
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
