import { SMALL_EDGE } from "../catalog";
import type { BuildRecipe, RecipeAttachedTile, RecipeTile } from "../recipe-compiler";

export const JET_AIRCRAFT_RECIPE: BuildRecipe = {
  id: "jet-aircraft-v2",
  tiles: [
    ...squareGrid("jet-body-square", 2, 5, "#118ab2", "jet fuselage body square", "body"),
    ...attachSeries("jet-wing-square", "small-square", [
      ["jet-body-square-1-3", 3, 1, 0, true],
      ["jet-body-square-2-3", 1, 3, 0, true],
      ["jet-body-square-1-4", 3, 1, 0, true],
      ["jet-body-square-2-4", 1, 3, 0, true],
      ["jet-body-square-1-5", 2, 0, 0, true],
      ["jet-body-square-1-5", 3, 0, 0, true]
    ], "#118ab2", "jet wing and tail square", ["wings", "wings", "wings", "wings", "tail", "tail"], 3),
    ...attachSeries("jet-equilateral-triangle", "equilateral-triangle", [
      ["jet-body-square-1-1", 0, 0, Math.PI / 2, false],
      ["jet-body-square-2-1", 0, 0, Math.PI / 2, false],
      ["jet-body-square-1-1", 3, 0, 0, true],
      ["jet-wing-square-1", 3, 0, 0, true],
      ["jet-wing-square-2", 1, 0, 0, true],
      ["jet-body-square-1-4", 3, 0, Math.PI / 2, true],
      ["jet-body-square-2-4", 1, 0, Math.PI / 2, true],
      ["jet-wing-square-5", 2, 0, 0, true],
      ["jet-wing-square-6", 2, 0, 0, true]
    ], "#8ecae6", "jet pointed nose and wing triangle", ["nose", "nose", "nose", "wings", "wings", "wings", "wings", "wings", "wings"], 5),
    ...attachSeries("jet-right-triangle", "right-triangle", [
      ["jet-body-square-1-2", 3, 0, 0, true],
      ["jet-body-square-2-2", 1, 0, 0, true],
      ["jet-equilateral-triangle-4", 0, 2, Math.PI / 2, false],
      ["jet-wing-square-2", 1, 0, -Math.PI / 2, false],
      ["jet-wing-square-3", 3, 0, 0, true],
      ["jet-wing-square-4", 1, 0, 0, true],
      ["jet-right-triangle-5", 2, 2, Math.PI / 2, true],
      ["jet-wing-square-4", 1, 0, -Math.PI / 2, false],
      ["jet-equilateral-triangle-8", 2, 0, -Math.PI / 2, true],
      ["jet-equilateral-triangle-9", 2, 0, Math.PI / 2, true]
    ], "#ef476f", "jet folded wing brace", "wings", 5),
    ...attachSeries("jet-isosceles-triangle", "isosceles-triangle", [
      ["jet-wing-square-5", 3, 0, 0, true],
      ["jet-right-triangle-9", 0, 2, Math.PI / 2, true],
      ["jet-body-square-1-5", 2, 0, Math.PI / 2, false],
      ["jet-body-square-2-5", 2, 0, -Math.PI / 2, false],
      ["jet-body-square-2-5", 2, 0, 0, true]
    ], "#7b2cbf", "jet vertical tail fin", ["tail", "tail", "tail", "tail", "top-fin"], 5)
  ]
};

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
  attachments: Array<[string, number, number, number, boolean]>,
  color: string,
  role: string,
  subassemblyId: string | string[],
  stepStart: number
): RecipeAttachedTile[] {
  return attachments.map(([attachTo, parentEdge, childEdge, foldAngle, reverse], index) => ({
    key: `${keyPrefix}-${index + 1}`,
    shape,
    color,
    attachTo,
    parentEdge,
    childEdge,
    foldAngle,
    reverse,
    step: stepStart + Math.floor(index / 4),
    role,
    subassemblyId: Array.isArray(subassemblyId) ? subassemblyId[index] : subassemblyId
  }));
}
