import { describe, expect, it } from "vitest";
import largeCarRampDraft from "@/build-drafts/large-car-ramp.json";
import mediumCarRampDraft from "@/build-drafts/medium-car-ramp.json";
import smallCarRampDraft from "@/build-drafts/small-car-ramp.json";
import { gateBuild, MAGNET_HOLD_FORCE, rollTest, simulate, TILE_FRICTION, TILE_MASS_KG, TILE_THICKNESS } from "@/lib/engine";
import type { EngineBuild } from "@/lib/engine";
import type { MagneticConnection, TileInstance } from "@/lib/magnetic-tiles/types";

describe("headless Magna-Tiles physics calibration", () => {
  it("documents the assumed and calibrated physical constants in one place", () => {
    expect(TILE_THICKNESS).toBe(0.18);
    expect(TILE_MASS_KG).toBeGreaterThan(0);
    expect(TILE_FRICTION).toBeGreaterThan(0);
    expect(MAGNET_HOLD_FORCE).toBeGreaterThan(0);
    expect(Number.isFinite(MAGNET_HOLD_FORCE)).toBe(true);
  });

  it("keeps the approved small car ramp standing and rollable", async () => {
    const simulation = await simulate(smallCarRampDraft as EngineBuild);
    const roll = await rollTest(smallCarRampDraft as EngineBuild);

    expect(simulation.stands).toBe(true);
    expect(simulation.poppedJoints).toEqual([]);
    expect(roll).toEqual({ reachedBottom: true, fellOff: false });
    await expect(gateBuild(smallCarRampDraft as EngineBuild)).resolves.toMatchObject({ passed: true });
  });

  it("keeps the approved medium car ramp rollable through a clear descent", async () => {
    const roll = await rollTest(mediumCarRampDraft as EngineBuild);

    expect(roll).toEqual({ reachedBottom: true, fellOff: false });
    await expect(gateBuild(mediumCarRampDraft as EngineBuild)).resolves.toMatchObject({ passed: true });
  });

  it("rejects a wall-blocked ramp path even when the build stands", async () => {
    const blockedRamp = wallBlockedLargeRampFixture();
    const simulation = await simulate(blockedRamp);
    const roll = await rollTest(blockedRamp);
    const verdict = await gateBuild(blockedRamp);

    expect(simulation.stands).toBe(true);
    expect(roll).toEqual({ reachedBottom: false, fellOff: true });
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("roll test reachedBottom=false fellOff=true");
  });

  it("tips a deliberately tall one-tile-wide tower", async () => {
    const simulation = await simulate(thinTowerFixture());

    expect(simulation.stands).toBe(false);
  });

  it("rejects a horizontal deck with an unsupported center seam", async () => {
    const unsupportedSpan = unsupportedCenterSeamSpanFixture();
    const simulation = await simulate(unsupportedSpan);
    const verdict = await gateBuild(unsupportedSpan);

    expect(simulation.stands).toBe(false);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toContain("pre-filter passed: no raw tile overlaps");
    expect(verdict.reasons.join(" ")).toContain("pre-filter passed:");
    expect(verdict.reasons.join(" ")).toContain("engine failed: build does not stand");
  });

  it("rejects a reproducible floating-arm fixture without depending on deleted git history", async () => {
    const floating = structuredClone(smallCarRampDraft) as EngineBuild;
    const arm = structuredClone(floating.tiles[0]);
    arm.id = 'unsupported-floating-arm';
    arm.position.y += 12;
    arm.position.x += 12;
    arm.root = false;
    arm.parentTileId = undefined;
    floating.tiles.push(arm);
    const verdict = await gateBuild(floating);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('disconnected-tile:unsupported-floating-arm');
  });
});

function wallBlockedLargeRampFixture(): EngineBuild {
  const blocked = structuredClone(largeCarRampDraft as EngineBuild);
  const verticalWallBasis: TileInstance["basis"] = {
    xAxis: { x: 0, y: 0, z: 1 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: -1, y: 0, z: 0 }
  };

  blocked.id = "wall-blocked-large-ramp-fixture";
  blocked.tiles.push(
    {
      id: "blocked-left-high-edge-wall",
      shape: "small-square",
      color: "#118ab2",
      position: { x: 5.43, y: 1.5, z: -1.5 },
      rotation: { x: 0, y: 0, z: 0 },
      basis: verticalWallBasis,
      step: 99,
      role: "deliberate wall obstruction blocking high-edge ramp path",
      parentTileId: "large-rigid-sloped-driving-panel",
      parentEdge: 1,
      childEdge: 2,
      foldAngle: Math.PI / 2
    },
    {
      id: "blocked-right-high-edge-wall",
      shape: "small-square",
      color: "#118ab2",
      position: { x: 5.43, y: 1.5, z: 1.5 },
      rotation: { x: 0, y: 0, z: 0 },
      basis: verticalWallBasis,
      step: 99,
      role: "deliberate wall obstruction blocking high-edge ramp path",
      parentTileId: "blocked-left-high-edge-wall",
      parentEdge: 1,
      childEdge: 3,
      foldAngle: 0
    }
  );
  blocked.connections.push(
    connection("blocked-left-high-edge-wall", 2, "large-rigid-sloped-driving-panel", 1),
    connection("blocked-right-high-edge-wall", 2, "large-rigid-sloped-driving-panel", 1),
    connection("blocked-left-high-edge-wall", 1, "blocked-right-high-edge-wall", 3)
  );

  return blocked;
}

function thinTowerFixture(): EngineBuild {
  const tiles: TileInstance[] = Array.from({ length: 6 }, (_, index) => ({
    id: `tower-${index}`,
    shape: "small-square",
    color: "#118ab2",
    position: { x: 0, y: 1.5 + index * 3, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    basis: {
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    step: index + 1,
    role: "thin tower face",
    root: index === 0,
    parentTileId: index === 0 ? undefined : `tower-${index - 1}`,
    parentEdge: index === 0 ? undefined : 2,
    childEdge: index === 0 ? undefined : 0,
    foldAngle: 0
  }));
  const connections: MagneticConnection[] = tiles.slice(1).map((tile, index) => ({
    fromTileId: `tower-${index}`,
    fromEdge: 2,
    toTileId: tile.id,
    toEdge: 0,
    kind: "edge"
  }));

  return {
    id: "thin-tower",
    title: "Deliberately Tall Thin Tower",
    family: "tower",
    tiles,
    connections
  };
}

function unsupportedCenterSeamSpanFixture(): EngineBuild {
  const horizontalDeck: TileInstance["basis"] = {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 0, y: -1, z: 0 }
  };
  const verticalSupport: TileInstance["basis"] = {
    xAxis: { x: 0, y: 0, z: 1 },
    yAxis: { x: 0, y: 1, z: 0 },
    zAxis: { x: -1, y: 0, z: 0 }
  };
  const tiles: TileInstance[] = [
    square("span-left-front-deck", { x: -1.5, y: 3, z: -1.5 }, horizontalDeck, "unsupported horizontal driving deck", true),
    square("span-left-back-deck", { x: -1.5, y: 3, z: 1.5 }, horizontalDeck, "unsupported horizontal driving deck", {
      parentTileId: "span-left-front-deck",
      parentEdge: 2,
      childEdge: 0,
      foldAngle: 0
    }),
    square("span-right-front-deck", { x: 1.5, y: 3, z: -1.5 }, horizontalDeck, "unsupported horizontal driving deck", {
      parentTileId: "span-left-front-deck",
      parentEdge: 1,
      childEdge: 3,
      foldAngle: 0
    }),
    square("span-right-back-deck", { x: 1.5, y: 3, z: 1.5 }, horizontalDeck, "unsupported horizontal driving deck", {
      parentTileId: "span-right-front-deck",
      parentEdge: 2,
      childEdge: 0,
      foldAngle: 0
    }),
    square("span-left-front-support", { x: -3.09, y: 1.5, z: -1.5 }, verticalSupport, "outer-edge vertical support", {
      parentTileId: "span-left-front-deck",
      parentEdge: 3,
      childEdge: 2,
      foldAngle: Math.PI / 2
    }),
    square("span-left-back-support", { x: -3.09, y: 1.5, z: 1.5 }, verticalSupport, "outer-edge vertical support", {
      parentTileId: "span-left-back-deck",
      parentEdge: 3,
      childEdge: 2,
      foldAngle: Math.PI / 2
    }),
    square("span-right-front-support", { x: 3.09, y: 1.5, z: -1.5 }, verticalSupport, "outer-edge vertical support", {
      parentTileId: "span-right-front-deck",
      parentEdge: 1,
      childEdge: 2,
      foldAngle: -Math.PI / 2
    }),
    square("span-right-back-support", { x: 3.09, y: 1.5, z: 1.5 }, verticalSupport, "outer-edge vertical support", {
      parentTileId: "span-right-back-deck",
      parentEdge: 1,
      childEdge: 2,
      foldAngle: -Math.PI / 2
    })
  ];
  const connections: MagneticConnection[] = [
    connection("span-left-front-deck", 2, "span-left-back-deck", 0),
    connection("span-right-front-deck", 2, "span-right-back-deck", 0),
    connection("span-left-front-deck", 1, "span-right-front-deck", 3),
    connection("span-left-back-deck", 1, "span-right-back-deck", 3),
    connection("span-left-front-support", 2, "span-left-front-deck", 3),
    connection("span-left-back-support", 2, "span-left-back-deck", 3),
    connection("span-right-front-support", 2, "span-right-front-deck", 1),
    connection("span-right-back-support", 2, "span-right-back-deck", 1)
  ];

  return {
    id: "unsupported-center-seam-span",
    title: "Unsupported Center Seam Span",
    family: "ramp",
    tiles,
    connections
  };
}

function square(
  id: string,
  position: TileInstance["position"],
  basis: TileInstance["basis"],
  role: string,
  parent: Pick<TileInstance, "parentTileId" | "parentEdge" | "childEdge" | "foldAngle"> | boolean = false
): TileInstance {
  return {
    id,
    shape: "small-square",
    color: "#118ab2",
    position,
    rotation: { x: 0, y: 0, z: 0 },
    basis,
    step: 1,
    role,
    ...(parent === true ? { root: true } : parent || {})
  };
}

function connection(fromTileId: string, fromEdge: number, toTileId: string, toEdge: number): MagneticConnection {
  return {
    fromTileId,
    fromEdge,
    toTileId,
    toEdge,
    kind: "edge"
  };
}
