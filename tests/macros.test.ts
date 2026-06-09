import { describe, expect, it } from "vitest";
import approvedSmallRamp from "@/build-drafts/small-car-ramp.json";
import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import {
  arbitraryFold,
  boundsForTiles,
  box,
  canJoinFullEdges,
  coplanarFlatJoin,
  composeMacros,
  cube,
  edgeLengthClassForShapeEdge,
  gableRoof,
  guardRail,
  joinByPorts,
  macroBom,
  mirrorMacro,
  mirroredPair,
  openBox,
  rampSegment,
  radialFan,
  rocketFinBase,
  rightAngleFold,
  smallLanding,
  steppedRiser,
  switchbackRamp,
  squarePyramid,
  tilePrimitive,
  triangleTent,
  triangularPrism,
  wallGrid,
  wedgePrism,
  type TileMacro
} from "@/lib/magnetic-tiles/macros";
import { gateBuild } from "@/lib/engine";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { CORNER_MAGNET_OFFSET, magnetFractionsForEdge, magnetPositionsForEdge } from "@/lib/magnetic-tiles/magnets";
import { tileNormal, tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type { BuildGraph, Inventory, InventoryPreset, TileBasis, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";

const HAIRLINE_TOLERANCE = 0.03;

describe("magnetic tile structural macros", () => {
  it.each([
    ["small-square", ["edge0", "edge1", "edge2", "edge3", "bottom", "right", "top", "left"], { "small-square": 1 }],
    ["large-square", ["edge0", "edge1", "edge2", "edge3", "bottom", "right", "top", "left"], { "large-square": 1 }],
    ["xl-square", ["edge0", "edge1", "edge2", "edge3", "bottom", "right", "top", "left"], { "xl-square": 1 }],
    ["equilateral-triangle", ["edge0", "edge1", "edge2", "base", "right", "left"], { "equilateral-triangle": 1 }],
    ["right-triangle", ["edge0", "edge1", "edge2", "legA", "hypotenuse", "legB"], { "right-triangle": 1 }],
    ["isosceles-triangle", ["edge0", "edge1", "edge2", "base", "rightLong", "leftLong"], { "isosceles-triangle": 1 }]
  ] as const)("exposes an overlap-free, valid %s primitive with a port on every edge", (shape, ports, expectedBom) => {
    const primitive = tilePrimitive({ id: shape, shape });

    expect(Object.keys(primitive.ports ?? {})).toEqual(expect.arrayContaining([...ports]));
    expect(Object.keys(primitive.ports ?? {})).toEqual(expect.arrayContaining(ports.map((port) => `${shape}.${port}`)));
    expectMacroContract(primitive, expectedBom, shape === "xl-square" ? "builder-xl" : undefined);
  });

  it("documents corrected edge-length classes used by strict full-edge joins", () => {
    expect(edgeLengthClassForShapeEdge("small-square", 0)).toBe("short");
    expect(edgeLengthClassForShapeEdge("equilateral-triangle", 1)).toBe("short");
    expect(edgeLengthClassForShapeEdge("right-triangle", 0)).toBe("short");
    expect(edgeLengthClassForShapeEdge("right-triangle", 1)).toBe("hyp");
    expect(edgeLengthClassForShapeEdge("isosceles-triangle", 0)).toBe("short");
    expect(edgeLengthClassForShapeEdge("isosceles-triangle", 1)).toBe("long");
    expect(edgeLengthClassForShapeEdge("large-square", 0)).toBe("long");
    expect(edgeLengthClassForShapeEdge("xl-square", 0)).toBe("long");
  });

  it("places exactly two corner-proximal magnets on every tile edge", () => {
    for (const shape of Object.keys(TILE_SPECS) as Array<keyof typeof TILE_SPECS>) {
      const tile = tilePrimitive({ id: shape, shape }).tiles[0];

      for (let edgeIndex = 0; edgeIndex < TILE_SPECS[shape].maxEdges; edgeIndex += 1) {
        const positions = magnetPositionsForEdge(tile, edgeIndex);
        const fractions = magnetFractionsForEdge(shape, edgeIndex);
        const expectedInsetFraction = CORNER_MAGNET_OFFSET / edgeLength(tile, edgeIndex);

        expect(positions).toHaveLength(2);
        expect(fractions).toHaveLength(2);
        expect(fractions[0]).toBeCloseTo(expectedInsetFraction, 5);
        expect(fractions[1]).toBeCloseTo(1 - expectedInsetFraction, 5);
      }
    }
  });

  it("accepts same-class full-edge joins and rejects mismatched edge classes", () => {
    const square = tilePrimitive({ id: "square", shape: "small-square" });
    const equilateral = tilePrimitive({ id: "eq", shape: "equilateral-triangle" });
    const right = tilePrimitive({ id: "right", shape: "right-triangle" });
    const large = tilePrimitive({ id: "large", shape: "large-square" });
    const isosceles = tilePrimitive({ id: "iso", shape: "isosceles-triangle" });

    expect(canJoinFullEdges(square, "right", equilateral, "base")).toBe(true);
    expect(canJoinFullEdges(large, "right", isosceles, "rightLong")).toBe(true);
    expect(canJoinFullEdges(square, "right", right, "hypotenuse")).toBe(false);
    expect(() => joinByPorts(square, "right", right, "hypotenuse")).toThrow(/edge length classes must match/);

    expectMacroContract(
      coplanarFlatJoin(square, "right", tilePrimitive({ id: "eq-flat", shape: "equilateral-triangle" }), "base"),
      { "small-square": 1, "equilateral-triangle": 1 }
    );
    expectMacroContract(
      coplanarFlatJoin(
        tilePrimitive({ id: "right-a", shape: "right-triangle" }),
        "hypotenuse",
        tilePrimitive({ id: "right-b", shape: "right-triangle" }),
        "hypotenuse",
        { flip: true }
      ),
      { "right-triangle": 2 }
    );
  });

  it("builds tested fold configurations without relying on overlap exemptions", () => {
    expectMacroContract(
      coplanarFlatJoin(
        tilePrimitive({ id: "flat-a", shape: "small-square" }),
        "right",
        tilePrimitive({ id: "flat-b", shape: "small-square" }),
        "left"
      ),
      { "small-square": 2 }
    );
    expectMacroContract(
      rightAngleFold(
        tilePrimitive({ id: "right-a", shape: "small-square" }),
        "right",
        tilePrimitive({ id: "right-b", shape: "small-square" }),
        "left"
      ),
      { "small-square": 2 }
    );
    expectMacroContract(
      arbitraryFold(
        tilePrimitive({ id: "fold-a", shape: "small-square" }),
        "right",
        tilePrimitive({ id: "fold-b", shape: "small-square" }),
        "left",
        Math.PI / 3
      ),
      { "small-square": 2 }
    );
  });

  it("builds mirrored pairs symmetrically", () => {
    const left = tilePrimitive({ id: "panel", shape: "small-square", origin: { x: -1.5, y: 0, z: 0 } });
    const pair = mirroredPair(left, "x", 0);
    const original = tileById(pair, "panel");
    const mirrored = tileById(pair, "panel-mirror");

    expectMacroContract(pair, { "small-square": 2 });
    expect(original.position.x).toBeCloseTo(-mirrored.position.x, 5);
    expect(original.position.y).toBeCloseTo(mirrored.position.y, 5);
    expect(original.position.z).toBeCloseTo(mirrored.position.z, 5);
  });

  it("exposes stable named connection ports on primitive macros", () => {
    const wedge = wedgePrism({ id: "wedge", deckLength: 1, width: 1, sideShape: "isosceles-triangle" });
    const turnBox = box({ id: "turn", width: 1, height: 1, depth: 1 });
    const wall = wallGrid({ id: "wall", rows: 2, cols: 1, plane: "vertical" });
    const landing = smallLanding({ id: "landing" });
    const rail = guardRail({ id: "rail", side: "left", deckLength: 1, tileShape: "equilateral-triangle" });

    expect(Object.keys(wedge.ports ?? {}).sort()).toEqual([
      "baseFloor",
      "highEdge",
      "leftDeckEdge",
      "lowEdge",
      "rightDeckEdge",
      "wedge.baseFloor",
      "wedge.highEdge",
      "wedge.leftDeckEdge",
      "wedge.lowEdge",
      "wedge.rightDeckEdge"
    ]);
    expect(Object.keys(turnBox.ports ?? {})).toEqual(expect.arrayContaining(["top", "bottom", "front", "back", "left", "right"]));
    expect(Object.keys(wall.ports ?? {})).toEqual(expect.arrayContaining(["baseEdge", "topEdge", "leftEdge", "rightEdge"]));
    expect(Object.keys(landing.ports ?? {})).toEqual(expect.arrayContaining(["wedgeEdge", "frontEdge", "leftEdge", "rightEdge"]));
    expect(Object.keys(rail.ports ?? {})).toEqual(expect.arrayContaining(["deckEdge", "leftDeckEdge"]));
  });

  it("builds an overlap-free, valid isosceles wedge prism with a predictable BOM", () => {
    const wedge = wedgePrism({ id: "wedge", deckLength: 1, width: 1, sideShape: "isosceles-triangle" });

    expect(rawOverlaps(wedge.tiles)).toEqual([]);
    expect(validateMacro(wedge).status).toBe("pass");
    expect(macroBom(wedge)).toMatchObject({
      "small-square": 1,
      "right-triangle": 0,
      "isosceles-triangle": 2
    });
  });

  it.each([
    ["right-triangle", 1, { "small-square": 1, "right-triangle": 2 }],
    ["equilateral-triangle", 1, { "small-square": 1, "equilateral-triangle": 2 }],
    ["isosceles-triangle", 1, { "small-square": 1, "isosceles-triangle": 2 }]
  ] as const)("supports %s side geometry for wedge prisms", (sideShape, deckLength, expectedBom) => {
    const wedge = wedgePrism({ id: sideShape, deckLength, width: 1, sideShape });

    expect(rawOverlaps(wedge.tiles)).toEqual([]);
    expect(validateMacro(wedge).status).toBe("pass");
    expect(macroBom(wedge)).toMatchObject(expectedBom);
  });

  it("keeps the optional wedge floor overlap-free and valid", () => {
    const wedge = wedgePrism({
      id: "floored-wedge",
      deckLength: 1,
      width: 1,
      sideShape: "isosceles-triangle",
      includeFloor: true
    });

    expect(rawOverlaps(wedge.tiles)).toEqual([]);
    expect(validateMacro(wedge).status).toBe("pass");
    expect(macroBom(wedge)).toMatchObject({
      "small-square": 2,
      "isosceles-triangle": 2
    });
  });

  it("builds an overlap-free, valid standalone slope-parallel guard rail with a predictable BOM", () => {
    const rail = guardRail({ id: "left-rail", side: "left", deckLength: 1, tileShape: "equilateral-triangle" });

    expect(rawOverlaps(rail.tiles)).toEqual([]);
    expect(validateMacro(rail).status).toBe("pass");
    expect(macroBom(rail)).toEqual({
      "small-square": 0,
      "large-square": 0,
      "xl-square": 0,
      "equilateral-triangle": 1,
      "right-triangle": 0,
      "isosceles-triangle": 0
    });
    expect(rail.tiles[0]).toMatchObject({
      id: "left-rail-left-rail-1",
      role: "left-rail left slope-parallel guard rail",
      step: 1,
      subassemblyId: "left-rail-guards"
    });
  });

  it("composes one guard rail alongside a wedge deck without turning into a vertical wall", () => {
    const wedge = wedgePrism({ id: "wedge", deckLength: 1, width: 1, sideShape: "isosceles-triangle" });
    const rail = guardRail({ id: "guard", side: "left", deckLength: 1, width: 1, sideShape: "isosceles-triangle", tileShape: "equilateral-triangle" });
    const build = composeMacros(wedge, rail);
    const deck = tileById(build, "wedge-deck-1-1");
    const guard = tileById(build, "guard-left-rail-1");

    expect(rawOverlaps(build.tiles)).toEqual([]);
    expect(validateMacro(build).status).toBe("pass");
    expect(edgeMidpointDistance(deck, 0, guard, 0)).toBeCloseTo(0.24, 5);
    expect(edgeLength(guard, 0)).toBeCloseTo(edgeLength(deck, 0), 5);
    expect(Math.abs(dot(edgeDirection(deck, 0), edgeDirection(guard, 0)))).toBeGreaterThan(0.999);
    expect(Math.abs(dot(tileNormal(deck), tileNormal(guard)))).toBeGreaterThan(0.999);
    expect(Math.abs(dot(tileNormal(guard), { x: 0, y: 0, z: 1 }))).toBeLessThan(0.001);
    expect(guard.position.z).toBeLessThan(deck.position.z);
  });

  it("composes mirrored left and right guard rails symmetrically around a wedge", () => {
    const wedge = wedgePrism({ id: "wedge", deckLength: 1, width: 1, sideShape: "isosceles-triangle" });
    const left = guardRail({ id: "guard", side: "left", deckLength: 1, width: 1, sideShape: "isosceles-triangle", tileShape: "equilateral-triangle" });
    const right = mirrorMacro(left, "z", 0);
    const directRight = guardRail({ id: "guard", side: "right", deckLength: 1, width: 1, sideShape: "isosceles-triangle", tileShape: "equilateral-triangle" });
    const build = composeMacros(wedge, left, right);
    const leftGuard = tileById(build, "guard-left-rail-1");
    const rightGuard = tileById(build, "guard-left-rail-1-mirror");
    const directRightGuard = tileById(directRight, "guard-right-rail-1");
    const leftDeck = tileById(build, "wedge-deck-1-1");
    const rightDeck = tileById(build, "wedge-deck-1-1");

    expect(rawOverlaps(build.tiles)).toEqual([]);
    expect(validateMacro(build).status).toBe("pass");
    expect(edgeMidpointDistance(leftDeck, 0, leftGuard, 0)).toBeCloseTo(0.24, 5);
    expect(edgeMidpointDistance(rightDeck, 2, rightGuard, 0)).toBeCloseTo(0.24, 5);
    expect(Math.abs(dot(tileNormal(leftDeck), tileNormal(leftGuard)))).toBeGreaterThan(0.999);
    expect(Math.abs(dot(tileNormal(rightDeck), tileNormal(rightGuard)))).toBeGreaterThan(0.999);
    expect(leftGuard.position.x).toBeCloseTo(rightGuard.position.x, 5);
    expect(leftGuard.position.y).toBeCloseTo(rightGuard.position.y, 5);
    expect(leftGuard.position.z).toBeCloseTo(-rightGuard.position.z, 5);
    expect(roundedPoint(directRightGuard.position)).toEqual(roundedPoint(rightGuard.position));
    expect(roundedBasis(directRightGuard.basis)).toEqual(roundedBasis(rightGuard.basis));
    expect(rightGuard.role).toBe("guard right slope-parallel guard rail");
  });

  it("builds an overlap-free, valid wall grid with a predictable BOM", () => {
    const wall = wallGrid({ id: "rear-wall", rows: 2, cols: 3, plane: "vertical" });

    expect(rawOverlaps(wall.tiles)).toEqual([]);
    expect(validateMacro(wall).status).toBe("pass");
    expect(macroBom(wall)).toMatchObject({ "small-square": 6 });
  });

  it("builds an overlap-free, valid radial fan with predictable ports and BOM", () => {
    const shell = radialFan({ id: "shell", segments: 11 });

    expect(Object.keys(shell.ports ?? {})).toEqual(expect.arrayContaining([
      "baseEdge",
      "openLeft",
      "openRight",
      "rim1",
      "rim11",
      "shell.baseEdge",
      "shell.openLeft",
      "shell.openRight",
      "shell.rim1",
      "shell.rim11"
    ]));
    expectMacroContract(shell, { "isosceles-triangle": 11 });
  });

  it("builds an overlap-free, valid closed box with a predictable BOM", () => {
    const turnBox = box({ id: "turn-box", width: 1, height: 1, depth: 1 });

    expect(rawOverlaps(turnBox.tiles)).toEqual([]);
    expect(validateMacro(turnBox).status).toBe("pass");
    expect(macroBom(turnBox)).toMatchObject({ "small-square": 6 });
  });

  it.each([
    ["open box", openBox({ id: "open", width: 1, height: 1, depth: 1 }), { "small-square": 5 }],
    ["cube", cube({ id: "cube" }), { "small-square": 6 }],
    [
      "triangular prism",
      triangularPrism({ id: "tri-prism", deckLength: 1, width: 1, sideShape: "isosceles-triangle" }),
      { "small-square": 2, "isosceles-triangle": 2 }
    ],
    [
      "ramp segment",
      rampSegment({ id: "ramp-segment", deckLength: 1, width: 1, sideShape: "isosceles-triangle", withLanding: true }),
      { "small-square": 3, "right-triangle": 2, "isosceles-triangle": 2 }
    ],
    ["stepped riser", steppedRiser({ id: "riser", steps: 2 }), { "small-square": 10 }],
    ["triangle tent", triangleTent({ id: "tent" }), { "small-square": 2, "equilateral-triangle": 2 }],
    ["gable roof", gableRoof({ id: "gable" }), { "small-square": 2, "equilateral-triangle": 2 }],
    ["square pyramid", squarePyramid({ id: "pyramid" }), { "small-square": 1, "equilateral-triangle": 4 }],
    ["radial fan", radialFan({ id: "fan", segments: 11 }), { "isosceles-triangle": 11 }],
    ["rocket fin base", rocketFinBase({ id: "fins" }), { "small-square": 1, "equilateral-triangle": 4 }]
  ] as const)("builds an overlap-free, valid %s composite with predictable BOM", (_name, macro, expectedBom) => {
    expectMacroContract(macro, expectedBom);
  });

  it("exposes stable gable roof ports for attaching to a box body", () => {
    const roof = gableRoof({ id: "roof" });

    expect(Object.keys(roof.ports ?? {})).toEqual(expect.arrayContaining([
      "frontBase",
      "backBase",
      "leftEave",
      "rightEave",
      "ridge",
      "roof.frontBase",
      "roof.backBase",
      "roof.leftEave",
      "roof.rightEave",
      "roof.ridge"
    ]));
    expectMacroContract(roof, { "small-square": 2, "equilateral-triangle": 2 });
  });

  it.each([
    ["cube", cube({ id: "gate-cube" })],
    ["open box", openBox({ id: "gate-open", width: 1, height: 1, depth: 1 })],
    ["stepped riser", steppedRiser({ id: "gate-riser", steps: 2 })],
    ["triangle tent", triangleTent({ id: "gate-tent" })],
    ["gable roof", gableRoof({ id: "gate-gable" })]
  ] as const)("passes the engine standing gate for standable composite %s", async (_name, macro) => {
    const verdict = await gateBuild(buildGraphFor(macro, "classic-100", "castle"));

    expect(verdict.passed, verdict.reasons.join("\n")).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("build stands");
  });

  it("composes a lower wedge, turn box, opposite-leaning upper wedge, and rear wall", () => {
    const build = composeMacros(
      wedgePrism({ id: "lower", deckLength: 1, width: 1, sideShape: "isosceles-triangle" }),
      box({
        id: "turn",
        width: 1,
        height: 1,
        depth: 1,
        origin: { x: 5.25, y: -0.03, z: -1.5 },
        openFaces: ["front", "back", "left"]
      }),
      wedgePrism({
        id: "upper",
        deckLength: 1,
        width: 1,
        sideShape: "right-triangle",
        origin: { x: 8.34, y: 3.2, z: 0 },
        facing: "west"
      }),
      wallGrid({
        id: "rear",
        rows: 2,
        cols: 1,
        plane: "vertical",
        origin: { x: 8.34, y: 0, z: -1.8 },
        facing: "east"
      })
    );

    expect(rawOverlaps(build.tiles)).toEqual([]);
    expect(validateMacro(build).status).toBe("warning");
    expect(macroBom(build)).toMatchObject({
      "small-square": 7,
      "right-triangle": 2,
      "isosceles-triangle": 2
    });
  });

  it("rejects the obsolete two-square isosceles small ramp macro under corrected dimensions", () => {
    const approvedTiles = approvedSmallRamp.tiles as TileInstance[];

    expect(() => wedgePrism({ id: "small-ramp", deckLength: 2, width: 1, sideShape: "isosceles-triangle" }))
      .toThrow(/isosceles-triangle side cannot support 2 deck square/);
    expect(countInventory(approvedTiles)).toMatchObject({
      "small-square": 4,
      "right-triangle": 2,
      "isosceles-triangle": 2
    });
  });

  it("rejects the obsolete two-square lower run for the port-built switchback ramp", () => {
    expect(() => switchbackRamp({
      lowerLength: 2,
      upperLength: 1,
      towerHeight: 2,
      withGuardRails: true
    })).toThrow(/isosceles-triangle side cannot support 2 deck square/);
  });

  it("keeps the shortened port-built switchback ramp rejected until re-authored", () => {
    const build = switchbackRamp({
      lowerLength: 1,
      upperLength: 1,
      towerHeight: 2,
      withGuardRails: true
    });

    const overlaps = rawOverlaps(build.tiles);

    expect(overlaps).toHaveLength(2);
    expect(overlaps[0]).toMatchObject({
      firstTileId: "lower-left-side",
      secondTileId: "upper-right-side"
    });
    expect(overlaps[0].penetration).toBeCloseTo(0.18, 5);
    expect(overlaps[1]).toMatchObject({
      firstTileId: "lower-right-side",
      secondTileId: "upper-left-side"
    });
    expect(overlaps[1].penetration).toBeCloseTo(0.18, 5);
    expect(validateMacro(build).status).toBe("error");
  });
});

function expectMacroContract(macro: TileMacro, expectedBom: Partial<Inventory>, inventoryPreset?: InventoryPreset) {
  expect(rawOverlaps(macro.tiles)).toEqual([]);
  expect(validateMacro(macro, inventoryPreset).status).toBe("pass");
  expect(macroBom(macro)).toMatchObject(expectedBom);
}

function validateMacro(macro: TileMacro, inventoryPreset?: InventoryPreset) {
  return validateBuild(buildGraphFor(macro, inventoryPreset));
}

function buildGraphFor(macro: TileMacro, inventoryPreset?: InventoryPreset, family: BuildGraph["family"] = "ramp"): BuildGraph {
  return {
    id: "macro-test",
    prompt: "macro test",
    title: "Macro Test",
    family,
    inventoryPreset,
    seed: 1,
    summary: "A structural macro test fixture.",
    tiles: macro.tiles,
    connections: macro.connections,
    bounds: boundsForTiles(macro.tiles)
  };
}

function rawOverlaps(tiles: TileInstance[]) {
  const overlaps: Array<{ firstTileId: string; secondTileId: string; penetration: number }> = [];

  for (let firstIndex = 0; firstIndex < tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tiles.length; secondIndex += 1) {
      const first = tiles[firstIndex];
      const second = tiles[secondIndex];
      const intersection = tilesIntersectAsPrisms(first, second);
      if (!intersection.overlaps || intersection.penetration <= HAIRLINE_TOLERANCE) continue;

      overlaps.push({
        firstTileId: first.id,
        secondTileId: second.id,
        penetration: Number(intersection.penetration.toFixed(3))
      });
    }
  }

  return overlaps;
}

function tileById(macro: TileMacro, tileId: string): TileInstance {
  const tile = macro.tiles.find((candidate) => candidate.id === tileId);
  expect(tile).toBeDefined();
  return tile!;
}

function edgeMidpoint(tile: TileInstance, edgeIndex: number): Vec3 {
  const vertices = tileWorldVertices(tile);
  return scale(add(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]), 0.5);
}

function edgeMidpointDistance(first: TileInstance, firstEdge: number, second: TileInstance, secondEdge: number): number {
  return distance(edgeMidpoint(first, firstEdge), edgeMidpoint(second, secondEdge));
}

function edgeLength(tile: TileInstance, edgeIndex: number): number {
  const vertices = tileWorldVertices(tile);
  return distance(vertices[edgeIndex], vertices[(edgeIndex + 1) % vertices.length]);
}

function edgeDirection(tile: TileInstance, edgeIndex: number): Vec3 {
  const vertices = tileWorldVertices(tile);
  return normalize(subtract(vertices[(edgeIndex + 1) % vertices.length], vertices[edgeIndex]));
}

function roundedBasis(basis?: TileBasis) {
  if (!basis) return undefined;
  return {
    xAxis: roundedPoint(basis.xAxis),
    yAxis: roundedPoint(basis.yAxis),
    zAxis: roundedPoint(basis.zAxis)
  };
}

function roundedPoint(point: Vec3) {
  return {
    x: Number(point.x.toFixed(5)),
    y: Number(point.y.toFixed(5)),
    z: Number(point.z.toFixed(5))
  };
}

function add(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scale(point: Vec3, amount: number): Vec3 {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function magnitude(point: Vec3): number {
  return Math.sqrt(dot(point, point));
}

function distance(first: Vec3, second: Vec3): number {
  return magnitude(subtract(first, second));
}

function normalize(point: Vec3): Vec3 {
  const length = magnitude(point);
  return length <= 0.000001 ? { x: 0, y: 0, z: 0 } : scale(point, 1 / length);
}

function countInventory(tiles: TileInstance[]): Inventory {
  return tiles.reduce<Inventory>(
    (counts, tile) => {
      counts[tile.shape] += 1;
      return counts;
    },
    {
      "small-square": 0,
      "large-square": 0,
      "xl-square": 0,
      "equilateral-triangle": 0,
      "right-triangle": 0,
      "isosceles-triangle": 0
    }
  );
}
