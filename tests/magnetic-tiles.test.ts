import { describe, expect, it } from "vitest";
import largeCarRampDraft from "@/build-drafts/large-car-ramp.json";
import { CLASSIC_100_INVENTORY, SHAPE_ORDER, XL_SQUARE_EDGE } from "@/lib/magnetic-tiles/catalog";
import { attachTile, basisFromEuler, makeAnchorTile, worldEdge } from "@/lib/magnetic-tiles/edge-attachment";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";
import { findMagneticEdgeMatch, tileLocalVertices, tileWorldMagnetPoints } from "@/lib/magnetic-tiles/magnet-geometry";
import { classifyPrompt, hashPrompt } from "@/lib/magnetic-tiles/prompt";
import { compileBuildRecipe, type BuildRecipe } from "@/lib/magnetic-tiles/recipe-compiler";
import { SMALL_CAR_RAMP_RECIPE } from "@/lib/magnetic-tiles/recipes/small-car-ramp";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type { BuildGraph, TileInstance, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";

const ACCEPTANCE_PROMPTS = [
  "Jet Aircraft",
  "Small Car Ramp",
  "Medium Car Ramp",
  "Large Car Ramp"
];

const OUT_OF_SCOPE_GENERIC_PROMPTS = [
  "a tall rainbow castle",
  "a rocket ship",
  "a bridge for toy cars",
  "a small dog",
  "a garage",
  "a tower with a wide base",
  "a princess castle",
  "a spaceship",
  "a little house",
  "a dinosaur"
];

function edgePlacedToTile(tile: ReturnType<typeof makeAnchorTile>): TileInstance {
  return {
    id: tile.key,
    shape: tile.shape,
    color: tile.color ?? "#118ab2",
    position: tile.position,
    rotation: { x: 0, y: 0, z: 0 },
    basis: tile.basis,
    step: tile.step,
    role: tile.role
  };
}

describe("prompt mapping", () => {
  it("is deterministic for the same prompt", () => {
    expect(hashPrompt("a tall rainbow castle")).toEqual(hashPrompt("a tall rainbow castle"));
    expect(classifyPrompt("a rocket ship")).toEqual(classifyPrompt("a rocket ship"));
  });

  it("maps common prompts to expected families", () => {
    expect(classifyPrompt("a tall rainbow castle").family).toBe("castle");
    expect(classifyPrompt("a rocket ship").family).toBe("rocket");
    expect(classifyPrompt("Jet Aircraft").family).toBe("aircraft");
    expect(classifyPrompt("a bridge for toy cars").family).toBe("bridge");
    expect(classifyPrompt("Small Car Ramp").family).toBe("ramp");
    expect(classifyPrompt("a small dog").family).toBe("animal");
    expect(classifyPrompt("a garage").family).toBe("house");
    expect(classifyPrompt("a tower with a wide base").family).toBe("tower");
  });

  it("renders the encoded reference prompts as first-class templates", () => {
    const jet = generateBuild("Jet Aircraft");
    const smallRamp = generateBuild("Small Car Ramp");
    const mediumRamp = generateBuild("Medium Car Ramp");
    const largeRamp = generateBuild("Large Car Ramp");

    expect(jet.build.family).toBe("aircraft");
    expect(jet.build.title).toBe("Jet Aircraft");
    expect(jet.instructions.some((step) => /wing|aircraft/i.test(step.instruction))).toBe(true);
    expect(jet.validation.issues.some((issue) => issue.code === "floating-tiles")).toBe(false);
    expect(jet.validation.usedInventory["small-square"]).toBe(16);
    expect(jet.validation.usedInventory["equilateral-triangle"]).toBe(9);
    expect(jet.validation.usedInventory["right-triangle"]).toBe(10);
    expect(jet.validation.usedInventory["isosceles-triangle"]).toBe(5);
    expect(jet.validation.issues.some((issue) => issue.code === "tile-overlap")).toBe(false);

    expect(smallRamp.build.family).toBe("ramp");
    expect(smallRamp.build.title).toBe("Small Car Ramp");
    expect(smallRamp.instructions.some((step) => /ramp|sloped|driving surface/i.test(step.instruction))).toBe(true);

    expect(mediumRamp.build.family).toBe("ramp");
    expect(mediumRamp.build.title).toBe("Medium Car Ramp");

    expect(largeRamp.build.family).toBe("ramp");
    expect(largeRamp.build.title).toBe("Large Car Ramp");
    expect(largeRamp.validation.usedInventory).toMatchObject({
      "small-square": 42,
      "large-square": 3,
      "equilateral-triangle": 6
    });
  });

  it("keeps Jet Aircraft on the connection-first compiler path", () => {
    const jet = generateBuild("Jet Aircraft");
    const joinedTiles = jet.build.tiles.filter((tile) => tile.parentTileId);
    const tileIds = new Set(jet.build.tiles.map((tile) => tile.id));

    expect(joinedTiles.length).toBeGreaterThan(20);
    expect(joinedTiles.every((tile) => tile.parentTileId && tileIds.has(tile.parentTileId))).toBe(true);
  });

  it("compiles Small Car Ramp from explicit magnetic joins", () => {
    const ramp = generateBuild("Small Car Ramp");

    expect(ramp.validation.usedInventory).toMatchObject({
      "small-square": 5,
      "large-square": 0,
      "equilateral-triangle": 0,
      "right-triangle": 2,
      "isosceles-triangle": 2
    });
    expect(ramp.build.tiles.every((tile) => tile.root || tile.parentTileId)).toBe(true);
    expect(ramp.build.connections.length).toBe(ramp.build.tiles.length - 1);
    expect(ramp.build.tiles.map((tile) => tile.id)).toEqual(
      expect.arrayContaining([
        "left-wedge-side",
        "right-wedge-side",
        "sloped-driving-panel",
        "top-landing-panel",
        "lower-runout-panel",
        "rear-support-panel",
        "front-support-panel",
        "left-side-guard",
        "right-side-guard"
      ])
    );
  });

  it("keeps every generated ramp template on the connection-first compiler path", () => {
    for (const prompt of ["Small Car Ramp", "Medium Car Ramp", "Large Car Ramp"]) {
      const ramp = generateBuild(prompt);

      expect(ramp.build.tiles.every((tile) => tile.root || tile.parentTileId)).toBe(true);
      expect(ramp.build.connections.length).toBe(ramp.build.tiles.length - 1);
    }
  });
});

describe("template generation", () => {
  it("resolves every curated library build to a renderable instruction set", () => {
    expect(BUILD_LIBRARY.length).toBeGreaterThanOrEqual(4);

    BUILD_LIBRARY.forEach((item) => {
      const result = generateBuild(item.prompt);

      expect(result.build.title).toBe(item.title);
      expect(result.build.tiles.length).toBeGreaterThan(0);
      expect(result.instructions.length).toBeGreaterThan(0);
      expect(result.validation.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    });
  });

  it.each(ACCEPTANCE_PROMPTS)("generates an in-scope draft build for %s", (prompt) => {
    const result = generateBuild(prompt);

    expect(result.build.tiles.length).toBeGreaterThan(0);
    expect(result.instructions.length).toBeGreaterThan(0);

    SHAPE_ORDER.forEach((shape) => {
      expect(result.validation.usedInventory[shape]).toBeLessThanOrEqual(CLASSIC_100_INVENTORY[shape]);
      expect(result.validation.remainingInventory[shape]).toBeGreaterThanOrEqual(0);
    });
  });

  it.each(OUT_OF_SCOPE_GENERIC_PROMPTS)("keeps the out-of-scope generic prompt deterministic for %s", (prompt) => {
    const result = generateBuild(prompt);

    expect(result.build.tiles.length).toBeGreaterThan(0);
    expect(result.instructions.length).toBeGreaterThan(0);

    SHAPE_ORDER.forEach((shape) => {
      expect(result.validation.usedInventory[shape]).toBeLessThanOrEqual(CLASSIC_100_INVENTORY[shape]);
      expect(result.validation.remainingInventory[shape]).toBeGreaterThanOrEqual(0);
    });
  });

  it("returns identical tile graphs for repeated prompts", () => {
    const first = generateBuild("a princess castle");
    const second = generateBuild("a princess castle");

    expect(first.build).toEqual(second.build);
    expect(first.instructions).toEqual(second.instructions);
  });
});

describe("validation", () => {
  it("calibrates tile shape dimensions and angles to the physical family", () => {
    expect(edgeLengths("small-square")).toEqual([3, 3, 3, 3]);
    expect(edgeLengths("large-square")).toEqual([6, 6, 6, 6]);
    expect(edgeLengths("xl-square")).toEqual([XL_SQUARE_EDGE, XL_SQUARE_EDGE, XL_SQUARE_EDGE, XL_SQUARE_EDGE]);
    expect(edgeLengths("equilateral-triangle")).toEqual([3, 3, 3]);
    expect(edgeLengths("right-triangle")).toEqual([3, 3, Number((3 * Math.sqrt(2)).toFixed(3))]);
    expect(edgeLengths("isosceles-triangle")).toEqual([3, 5.63, 5.63]);
    expect(polygonArea(tileLocalVertices("right-triangle"))).toBeCloseTo(9 / 2);
    expect(apexAngleDegrees("isosceles-triangle")).toBeCloseTo(31, 0);
  });

  it("places a tile by attaching a child edge to a parent edge", () => {
    const parent = makeAnchorTile("parent", "small-square", { x: -1.5, y: 1.5, z: 0 });
    const child = attachTile(parent, {
      key: "child",
      shape: "small-square",
      attachTo: "parent",
      parentEdge: 1,
      childEdge: 3,
      foldAngle: 0,
      reverse: true,
      step: 1,
      role: "attached panel"
    });
    const parentEdge = worldEdge(parent, 1);
    const childEdge = worldEdge(child, 3);

    expect(child.position.x).toBeCloseTo(1.5);
    expect(child.position.y).toBeCloseTo(1.5);
    expect(childEdge.start.x).toBeCloseTo(parentEdge.end.x);
    expect(childEdge.start.y).toBeCloseTo(parentEdge.end.y);
    expect(childEdge.end.x).toBeCloseTo(parentEdge.start.x);
    expect(childEdge.end.y).toBeCloseTo(parentEdge.start.y);
  });

  it("folds attached tiles around the shared edge", () => {
    const parent = makeAnchorTile("parent", "small-square", { x: 0, y: 1.5, z: 0 });
    const child = attachTile(parent, {
      key: "child",
      shape: "small-square",
      attachTo: "parent",
      parentEdge: 1,
      childEdge: 3,
      foldAngle: Math.PI / 2,
      reverse: true,
      step: 1,
      role: "folded side panel"
    });

    expect(child.basis.zAxis.x).toBeCloseTo(1);
    expect(child.basis.zAxis.z).toBeCloseTo(0);
  });

  it("distinguishes real side-return hinge joins from visual offsets", () => {
    const frontTile = {
      id: "front",
      shape: "small-square" as const,
      color: "#118ab2",
      position: { x: 0, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      step: 1,
      role: "front panel"
    };
    const hingedSideTile = {
      ...frontTile,
      id: "hinged-side",
      position: { x: -1.5, y: 1.5, z: -1.58 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 }
    };
    const visuallyOffsetTile = {
      ...hingedSideTile,
      id: "visually-offset",
      position: { x: -1.5, y: 1.5, z: -2.82 }
    };

    expect(findMagneticEdgeMatch(frontTile, hingedSideTile)).not.toBeNull();
    expect(findMagneticEdgeMatch(frontTile, visuallyOffsetTile)).toBeNull();
  });

  it("draws two corner-proximal magnet markers per edge", () => {
    const small: TileInstance = {
      id: "small",
      shape: "small-square",
      color: "#118ab2",
      position: { x: 0, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      step: 1,
      role: "small panel"
    };
    const large: TileInstance = {
      ...small,
      id: "large",
      shape: "large-square",
      position: { x: 0, y: 3, z: 0 }
    };
    const xl: TileInstance = {
      ...small,
      id: "xl",
      shape: "xl-square",
      position: { x: 0, y: XL_SQUARE_EDGE / 2, z: 0 }
    };

    expect(tileWorldMagnetPoints(small)).toHaveLength(8);
    expect(tileWorldMagnetPoints(large)).toHaveLength(8);
    expect(tileWorldMagnetPoints(xl)).toHaveLength(8);
    expect(tileWorldMagnetPoints(small).filter((point) => point.edgeIndex === 0).map((point) => point.t)).toEqual([0.22, 0.78]);
    expect(tileWorldMagnetPoints(large).filter((point) => point.edgeIndex === 0).map((point) => Number(point.t.toFixed(2)))).toEqual([0.11, 0.89]);
    expect(tileWorldMagnetPoints(xl).filter((point) => point.edgeIndex === 0).map((point) => Number(point.t.toFixed(2)))).toEqual([0.11, 0.89]);
  });

  it("validates an XL square as a normal square under the Builder XL preset", () => {
    const xlTile: TileInstance = {
      id: "xl-panel",
      shape: "xl-square",
      color: "#118ab2",
      position: { x: 0, y: XL_SQUARE_EDGE / 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      step: 1,
      role: "XL square panel"
    };
    const build: BuildGraph = {
      id: "xl-square-fixture",
      prompt: "XL square fixture",
      title: "XL Square Fixture",
      family: "ramp",
      inventoryPreset: "builder-xl",
      seed: 1,
      summary: "A single XL square validation fixture.",
      tiles: [xlTile],
      connections: [],
      bounds: { width: XL_SQUARE_EDGE, height: XL_SQUARE_EDGE, depth: 0.18 }
    };
    const validation = validateBuild(build);
    const largeRampBom = largeCarRampDraft.expectedInventory as Partial<Record<TileShape, number>>;

    expect(validation.status).toBe("pass");
    expect(validation.issues.filter((issue) => issue.code === "tile-overlap")).toEqual([]);
    expect(validation.usedInventory["xl-square"]).toBe(1);
    expect(validation.remainingInventory["xl-square"]).toBe(2);
    expect(CLASSIC_100_INVENTORY["xl-square"]).toBe(0);
    expect(largeCarRampDraft.inventoryPreset).toBe("classic-100");
    expect(largeRampBom).toMatchObject({
      "small-square": 6,
      "large-square": 2,
      "xl-square": 0,
      "equilateral-triangle": 0,
      "right-triangle": 0,
      "isosceles-triangle": 2
    });
    SHAPE_ORDER.forEach((shape) => {
      expect(largeRampBom[shape] ?? 0).toBeLessThanOrEqual(CLASSIC_100_INVENTORY[shape]);
    });
  });

  it("flags inventory overuse", () => {
    const result = generateBuild("a little house");
    const overfilled: BuildGraph = {
      ...result.build,
      tiles: Array.from({ length: 52 }, (_, index) => ({
        ...result.build.tiles[0],
        id: `over-${index}`,
        shape: "small-square",
        position: { x: index * 3, y: 1.5, z: 0 }
      }))
    };

    const validation = validateBuild(overfilled);

    expect(validation.issues.some((issue) => issue.code === "inventory-overrun")).toBe(true);
    expect(validation.status).toBe("error");
  });

  it("flags disconnected structures", () => {
    const result = generateBuild("a rocket ship");
    const disconnected: BuildGraph = {
      ...result.build,
      tiles: [
        ...result.build.tiles,
        {
          ...result.build.tiles[0],
          id: "lonely-tile",
          position: { x: 100, y: 1.5, z: 0 }
        }
      ]
    };

    const validation = validateBuild(disconnected);

    expect(validation.issues.some((issue) => issue.code === "disconnected-components")).toBe(true);
  });

  it("flags exact duplicate tile placement as impossible", () => {
    const result = generateBuild("a little house");
    const duplicated: BuildGraph = {
      ...result.build,
      tiles: [
        ...result.build.tiles,
        {
          ...result.build.tiles[0],
          id: "duplicate-tile"
        }
      ]
    };

    const validation = validateBuild(duplicated);

    expect(validation.issues.some((issue) => issue.code === "duplicate-placement")).toBe(true);
    expect(validation.status).toBe("error");
  });

  it("flags partial physical overlaps as errors", () => {
    const result = generateBuild("a little house");
    const overlapping: BuildGraph = {
      ...result.build,
      tiles: [
        ...result.build.tiles,
        {
          ...result.build.tiles[0],
          id: "partly-overlapping-tile",
          position: {
            ...result.build.tiles[0].position,
            x: result.build.tiles[0].position.x + 1.2
          }
        }
      ]
    };

    const validation = validateBuild(overlapping);
    const issue = validation.issues.find((item) => item.code === "tile-overlap");

    expect(issue?.severity).toBe("error");
    expect(issue?.detail).toContain("Real pieces cannot overlap");
    expect(validation.status).toBe("error");
  });

  it("flags angled prism intersections as physical overlaps", () => {
    const result = generateBuild("a little house");
    const base: TileInstance = {
      id: "base-panel",
      shape: "small-square",
      color: "#118ab2",
      position: { x: 0, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      basis: basisFromEuler(0, 0, 0),
      step: 1,
      role: "base panel"
    };
    const angled: TileInstance = {
      ...base,
      id: "angled-colliding-panel",
      color: "#ef476f",
      position: { x: 0.45, y: 1.5, z: 0 },
      basis: basisFromEuler(0, 0, Math.PI / 5),
      role: "angled colliding panel"
    };
    const build: BuildGraph = {
      ...result.build,
      tiles: [base, angled],
      connections: []
    };

    const validation = validateBuild(build);
    const issue = validation.issues.find((item) => item.code === "tile-overlap");

    expect(issue?.tileIds).toEqual(expect.arrayContaining(["base-panel", "angled-colliding-panel"]));
    expect(issue?.detail).toContain("base-panel (base panel) intersects angled-colliding-panel");
  });

  it("allows two panels that share only a magnetic edge without interpenetrating", () => {
    const parent = makeAnchorTile("parent-panel", "small-square", { x: 0, y: 1.5, z: 0 });
    const child = makeAnchorTile("edge-neighbor-panel", "small-square", { x: 3, y: 1.5, z: 0 }, parent.basis);
    const result = generateBuild("a little house");
    const build: BuildGraph = {
      ...result.build,
      tiles: [edgePlacedToTile(parent), edgePlacedToTile(child)],
      connections: []
    };

    const validation = validateBuild(build);

    expect(validation.issues.some((issue) => issue.code === "tile-overlap")).toBe(false);
  });

  it("fails fast when a recipe references a missing parent", () => {
    expect(() =>
      compileBuildRecipe({
        id: "broken-recipe",
        tiles: [
          {
            ...SMALL_CAR_RAMP_RECIPE.tiles[1],
            attachTo: "missing-parent"
          }
        ]
      })
    ).toThrow(/missing parent tile/);
  });

  it("can attach a prebuilt subassembly as one transformed group", () => {
    const recipe: BuildRecipe = {
      id: "module-attach-test",
      tiles: [
        {
          key: "body-panel",
          shape: "small-square",
          color: "#118ab2",
          position: { x: 0, y: 1.5, z: 0 },
          step: 1,
          role: "body panel",
          subassemblyId: "body"
        },
        {
          key: "loose-wing-panel",
          shape: "small-square",
          color: "#8ecae6",
          position: { x: 12, y: 1.5, z: 0 },
          step: 2,
          role: "loose wing panel",
          subassemblyId: "wing"
        },
        {
          key: "loose-wing-tip",
          shape: "equilateral-triangle",
          color: "#ef476f",
          attachTo: "loose-wing-panel",
          parentEdge: 1,
          childEdge: 0,
          foldAngle: 0,
          reverse: true,
          step: 2,
          role: "loose wing tip",
          subassemblyId: "wing"
        }
      ],
      operations: [
        {
          kind: "attach-subassembly",
          tileIds: ["loose-wing-panel", "loose-wing-tip"],
          anchorTileId: "loose-wing-panel",
          parentTileId: "body-panel",
          parentEdge: 1,
          childEdge: 3,
          foldAngle: 0,
          reverse: true
        }
      ]
    };
    const compiled = compileBuildRecipe(recipe);
    const wingPanel = compiled.tiles.find((tile) => tile.id === "loose-wing-panel");
    const build: BuildGraph = {
      id: "module-attach-test",
      prompt: "module attach test",
      title: "Module Attach Test",
      family: "aircraft",
      seed: 1,
      summary: "A small module attachment fixture.",
      tiles: compiled.tiles,
      connections: compiled.connections,
      bounds: { width: 6, height: 3, depth: 3 }
    };
    const validation = validateBuild(build);

    expect(wingPanel?.parentTileId).toBe("body-panel");
    expect(compiled.connections.map((connection) => `${connection.fromTileId}->${connection.toTileId}`)).toEqual([
      "loose-wing-panel->loose-wing-tip",
      "body-panel->loose-wing-panel"
    ]);
    expect(validation.issues.some((issue) => issue.code === "tile-overlap")).toBe(false);
  });
});

function edgeLengths(shape: TileShape): number[] {
  const vertices = tileLocalVertices(shape);
  return vertices
    .map((start, index) => {
      const end = vertices[(index + 1) % vertices.length];
      return Number(Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2).toFixed(3));
    })
    .sort((first, second) => first - second);
}

function polygonArea(vertices: Vec3[]): number {
  const area = vertices.reduce((total, start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    return total + start.x * end.y - end.x * start.y;
  }, 0);
  return Math.abs(area) / 2;
}

function apexAngleDegrees(shape: TileShape): number {
  const [left, right, apex] = tileLocalVertices(shape);
  const first = { x: left.x - apex.x, y: left.y - apex.y };
  const second = { x: right.x - apex.x, y: right.y - apex.y };
  const dot = first.x * second.x + first.y * second.y;
  const firstLength = Math.sqrt(first.x ** 2 + first.y ** 2);
  const secondLength = Math.sqrt(second.x ** 2 + second.y ** 2);
  return Math.acos(dot / (firstLength * secondLength)) * (180 / Math.PI);
}
