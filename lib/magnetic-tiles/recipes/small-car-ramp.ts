import { SMALL_EDGE } from "../catalog";
import type { BuildRecipe, RecipeAttachedTile, RecipeTile } from "../recipe-compiler";

export const SMALL_CAR_RAMP_RECIPE: BuildRecipe = {
  id: "small-car-ramp-v2",
  tiles: [
    {
      key: "left-wedge-side",
      shape: "right-triangle",
      color: "#06d6a0",
      position: { x: 0, y: SMALL_EDGE / 2, z: -SMALL_EDGE / 2 },
      step: 1,
      role: "left wedge side",
      subassemblyId: "wedge"
    },
    {
      key: "sloped-driving-panel",
      shape: "small-square",
      color: "#118ab2",
      attachTo: "left-wedge-side",
      parentEdge: 1,
      childEdge: 0,
      foldAngle: Math.PI / 2,
      step: 2,
      role: "sloped driving surface",
      subassemblyId: "driving-surface"
    },
    {
      key: "top-landing-panel",
      shape: "small-square",
      color: "#ffb703",
      attachTo: "left-wedge-side",
      parentEdge: 0,
      childEdge: 0,
      foldAngle: -Math.PI / 2,
      step: 2,
      role: "top landing panel",
      subassemblyId: "landing"
    },
    {
      key: "lower-runout-panel",
      shape: "small-square",
      color: "#8ecae6",
      attachTo: "left-wedge-side",
      parentEdge: 1,
      childEdge: 0,
      foldAngle: Math.PI / 2,
      reverse: true,
      step: 2,
      role: "lower runout panel",
      subassemblyId: "runout"
    },
    {
      key: "right-wedge-side",
      shape: "right-triangle",
      color: "#ef476f",
      attachTo: "left-wedge-side",
      parentEdge: 2,
      childEdge: 0,
      foldAngle: Math.PI / 2,
      step: 1,
      role: "right wedge side",
      subassemblyId: "wedge"
    },
    {
      key: "rear-support-panel",
      shape: "small-square",
      color: "#118ab2",
      attachTo: "sloped-driving-panel",
      parentEdge: 2,
      childEdge: 0,
      foldAngle: 0,
      reverse: true,
      step: 3,
      role: "rear support panel",
      subassemblyId: "support"
    },
    {
      key: "front-support-panel",
      shape: "small-square",
      color: "#06d6a0",
      attachTo: "sloped-driving-panel",
      parentEdge: 3,
      childEdge: 0,
      foldAngle: Math.PI / 2,
      step: 3,
      role: "front support panel",
      subassemblyId: "support"
    },
    {
      key: "left-side-guard",
      shape: "isosceles-triangle",
      color: "#7b2cbf",
      attachTo: "top-landing-panel",
      parentEdge: 1,
      childEdge: 0,
      foldAngle: 0,
      reverse: true,
      step: 4,
      role: "left side guard",
      subassemblyId: "guards"
    },
    {
      key: "right-side-guard",
      shape: "isosceles-triangle",
      color: "#f7b733",
      attachTo: "top-landing-panel",
      parentEdge: 3,
      childEdge: 0,
      foldAngle: 0,
      reverse: true,
      step: 4,
      role: "right side guard",
      subassemblyId: "guards"
    }
  ]
};

export const MEDIUM_CAR_RAMP_RECIPE: BuildRecipe = {
  id: "medium-car-ramp-v2",
  tiles: mediumRampTiles()
};

export const LARGE_CAR_RAMP_RECIPE: BuildRecipe = {
  id: "large-car-ramp-v2",
  tiles: [
    ...squareGrid("large-wall-square", 7, 6, "#118ab2", "large rear wall square", "large-rear-wall"),
    ...attachSeries("large-square", "large-square", 3, [
      ["large-wall-square-1-1", 0, 0, Math.PI / 4, false, "center", SMALL_EDGE / 2],
      ["large-wall-square-4-1", 0, 0, Math.PI / 4, false, "center", SMALL_EDGE / 2],
      ["large-wall-square-6-1", 0, 0, Math.PI / 4, false, "center", SMALL_EDGE / 2]
    ], "#8ecae6", "XL ramp plane", "large-ramp-plane", 7),
    ...attachSeries("large-equilateral", "equilateral-triangle", 6, [
      ["large-wall-square-1-6", 2, 0, 0, true],
      ["large-wall-square-2-6", 2, 0, 0, true],
      ["large-wall-square-3-6", 2, 0, 0, true],
      ["large-wall-square-5-6", 2, 0, 0, true],
      ["large-wall-square-6-6", 2, 0, 0, true],
      ["large-wall-square-7-6", 2, 0, 0, true]
    ], "#ffb703", "large ramp triangular side marker", "large-side-triangles", 8)
  ]
};

function mediumRampTiles(): RecipeTile[] {
  return [
    ...squareGrid("support-square", 5, 3, "#118ab2", "rear support square", "rear-support"),
    ...attachSeries("medium-driving-triangle", "equilateral-triangle", 5, [
      ["support-square-1-1", 0, 0, Math.PI / 4, false],
      ["support-square-2-1", 0, 0, Math.PI / 4, false],
      ["support-square-3-1", 0, 0, Math.PI / 4, false],
      ["support-square-4-1", 0, 0, Math.PI / 4, false],
      ["support-square-5-1", 0, 0, Math.PI / 4, false]
    ], "#ffb703", "medium sloped driving surface", "driving-surface", 4),
    ...attachSeries("equilateral-triangle", "equilateral-triangle", 13, [
      ["support-square-1-3", 2, 0, 0, true],
      ["support-square-2-3", 2, 0, 0, true],
      ["support-square-3-3", 2, 0, 0, true],
      ["support-square-4-3", 2, 0, 0, true],
      ["support-square-5-3", 2, 0, 0, true],
      ["support-square-1-1", 3, 0, 0, true],
      ["support-square-1-2", 3, 0, 0, true],
      ["support-square-1-3", 3, 0, 0, true],
      ["support-square-5-1", 1, 0, 0, true],
      ["support-square-5-2", 1, 0, 0, true],
      ["support-square-5-3", 1, 0, 0, true],
      ["equilateral-triangle-8", 1, 0, 0, true],
      ["equilateral-triangle-11", 2, 0, 0, true]
    ], "#ffb703", "medium ramp triangular brace", "braces", 5),
    ...attachSeries("isosceles-triangle", "isosceles-triangle", 4, [
      ["equilateral-triangle-12", 2, 1, Math.PI / 2, true],
      ["isosceles-triangle-1", 1, 2, 0, true],
      ["equilateral-triangle-13", 2, 2, 0, true],
      ["equilateral-triangle-13", 1, 2, Math.PI / 2, false]
    ], "#7b2cbf", "medium ramp side guard", "guards", 4)
  ];
}

function squareGrid(
  keyPrefix: string,
  columns: number,
  rows: number,
  color: string,
  role: string,
  subassemblyId: string
): RecipeTile[] {
  const tiles: RecipeTile[] = [];

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const key = `${keyPrefix}-${column}-${row}`;
      if (column === 1 && row === 1) {
        tiles.push({
          key,
          shape: "small-square",
          color,
          position: { x: 0, y: SMALL_EDGE / 2, z: 0 },
          step: row,
          role,
          subassemblyId
        });
      } else if (column > 1) {
        tiles.push({
          key,
          shape: "small-square",
          color,
          attachTo: `${keyPrefix}-${column - 1}-${row}`,
          parentEdge: 1,
          childEdge: 3,
          foldAngle: 0,
          reverse: true,
          step: row,
          role,
          subassemblyId
        });
      } else {
        tiles.push({
          key,
          shape: "small-square",
          color,
          attachTo: `${keyPrefix}-${column}-${row - 1}`,
          parentEdge: 2,
          childEdge: 0,
          foldAngle: 0,
          reverse: true,
          step: row,
          role,
          subassemblyId
        });
      }
    }
  }

  return tiles;
}

function attachSeries(
  keyPrefix: string,
  shape: RecipeAttachedTile["shape"],
  count: number,
  attachments: Array<[string, number, number, number, boolean, ("start" | "center")?, number?]>,
  color: string,
  role: string,
  subassemblyId: string,
  stepStart: number
): RecipeAttachedTile[] {
  return Array.from({ length: count }, (_, index) => {
    const [attachTo, parentEdge, childEdge, foldAngle, reverse, edgeAlign, edgeOffset] = attachments[index];
    return {
      key: `${keyPrefix}-${index + 1}`,
      shape,
      color,
      attachTo,
      parentEdge,
      childEdge,
      foldAngle,
      edgeAlign,
      edgeOffset,
      reverse,
      step: stepStart + Math.floor(index / 6),
      role,
      subassemblyId
    };
  });
}
