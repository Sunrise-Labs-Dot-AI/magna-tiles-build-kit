import type { Inventory, InventoryPreset, TileShape, TileSpec } from "./types";

export const SMALL_EDGE = 3;
export const LARGE_EDGE = SMALL_EDGE * 2;
export const MM_PER_INCH = 25.4;
export const RIGHT_TRIANGLE_LEG = SMALL_EDGE;
export const RIGHT_TRIANGLE_HYPOTENUSE = SMALL_EDGE * Math.sqrt(2);
export const ISOSCELES_BASE = SMALL_EDGE;
// measured-but-noisy (±~5mm); isosceles re-shoot recommended
export const ISOSCELES_EQUAL_SIDE = 143 / MM_PER_INCH;
export const ISOSCELES_HEIGHT = Math.sqrt(ISOSCELES_EQUAL_SIDE ** 2 - (ISOSCELES_BASE / 2) ** 2);
export const EQUILATERAL_HEIGHT = Math.sqrt(SMALL_EDGE ** 2 - (SMALL_EDGE / 2) ** 2);
export const TILE_THICKNESS = 0.18;
// per measured photos XL == large 6in; if a physically-larger Builder XL exists, update this one constant
export const XL_SQUARE_EDGE = LARGE_EDGE;

export const TILE_SPECS: Record<TileShape, TileSpec> = {
  "small-square": {
    shape: "small-square",
    label: "Small square",
    shortLabel: "Square",
    edgeLength: SMALL_EDGE,
    width: SMALL_EDGE,
    height: SMALL_EDGE,
    maxEdges: 4
  },
  "large-square": {
    shape: "large-square",
    label: "Large square",
    shortLabel: "Large",
    edgeLength: LARGE_EDGE,
    width: LARGE_EDGE,
    height: LARGE_EDGE,
    maxEdges: 4
  },
  "xl-square": {
    shape: "xl-square",
    label: "XL square",
    shortLabel: "XL square",
    edgeLength: XL_SQUARE_EDGE,
    width: XL_SQUARE_EDGE,
    height: XL_SQUARE_EDGE,
    maxEdges: 4
  },
  "equilateral-triangle": {
    shape: "equilateral-triangle",
    label: "Equilateral triangle",
    shortLabel: "Eq. tri",
    edgeLength: SMALL_EDGE,
    width: SMALL_EDGE,
    height: EQUILATERAL_HEIGHT,
    maxEdges: 3
  },
  "right-triangle": {
    shape: "right-triangle",
    label: "Right triangle",
    shortLabel: "Right tri",
    edgeLength: RIGHT_TRIANGLE_HYPOTENUSE,
    width: RIGHT_TRIANGLE_LEG,
    height: RIGHT_TRIANGLE_LEG,
    maxEdges: 3
  },
  "isosceles-triangle": {
    shape: "isosceles-triangle",
    label: "Isosceles triangle",
    shortLabel: "Iso. tri",
    edgeLength: ISOSCELES_BASE,
    width: ISOSCELES_BASE,
    height: ISOSCELES_HEIGHT,
    maxEdges: 3
  }
};

export const CLASSIC_100_INVENTORY: Inventory = {
  "small-square": 50,
  "large-square": 4,
  "xl-square": 0,
  "equilateral-triangle": 20,
  "right-triangle": 11,
  "isosceles-triangle": 15
};

export const BUILDER_XL_INVENTORY: Inventory = {
  ...CLASSIC_100_INVENTORY,
  "xl-square": 3
};

export const INVENTORY_PRESETS: Record<InventoryPreset, Inventory> = {
  "classic-100": CLASSIC_100_INVENTORY,
  "builder-xl": BUILDER_XL_INVENTORY
};

export const SHAPE_ORDER: TileShape[] = [
  "small-square",
  "large-square",
  "xl-square",
  "equilateral-triangle",
  "right-triangle",
  "isosceles-triangle"
];

export function emptyInventory(): Inventory {
  return {
    "small-square": 0,
    "large-square": 0,
    "xl-square": 0,
    "equilateral-triangle": 0,
    "right-triangle": 0,
    "isosceles-triangle": 0
  };
}

export function inventoryTotal(inventory: Inventory): number {
  return SHAPE_ORDER.reduce((total, shape) => total + inventory[shape], 0);
}

export function inventoryForPreset(preset: InventoryPreset): Inventory {
  return INVENTORY_PRESETS[preset];
}
