import {
  box,
  composeMacros,
  type TileMacro,
} from "@/lib/magnetic-tiles/macros";
import { buildBounds } from "@/lib/engine/build";
import { hashPrompt } from "@/lib/magnetic-tiles/prompt";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import type { ConstructionProgram, IntentContract } from "./types";

/** Construct catalog tiles, never scale or distort a tile to satisfy a target. */
export function compileProgram(
  program: ConstructionProgram,
  contract: IntentContract,
): BuildGraph {
  const { kind, width, height, depth, steps, reinforcement } = program;
  const reinforced = reinforcement !== "shell";
  const makeBox = (
    id: string,
    w: number,
    h: number,
    d: number,
    x = 0,
  ): TileMacro => {
    const macro = box({
      id,
      width: w,
      height: h,
      depth: d,
      origin: { x, y: 0, z: 0 },
      openFaces:
        kind === "container"
          ? ["top"]
          : kind === "tunnel"
            ? reinforced
              ? ["front", "back"]
              : ["front", "back", "bottom"]
            : [],
      stepStart: 1,
    });
    if (reinforced && kind !== "container" && kind !== "tunnel") {
      const floor = macro.tiles.filter((t) => t.id.includes("-bottom-"));
      // Floors must meet magnetic edges, never the middle of a 6-inch wall panel.
      const interval =
        reinforcement === "rigid-panels" && !contract.requireFloors ? 2 : 1;
      for (let level = interval; level < h; level += interval)
        macro.tiles.push(
          ...floor.map((t) => ({
            ...structuredClone(t),
            id: `${t.id}-diaphragm-${level}`,
            position: { ...t.position, y: t.position.y + 3 * level },
            parentTileId: undefined,
            root: false,
            role: "internal horizontal diaphragm",
          })),
        );
    }
    return macro;
  };
  let macro: TileMacro;
  if (kind === "staircase")
    macro = composeMacros(
      ...Array.from({ length: steps }, (_, i) =>
        makeBox(`riser-${i + 1}`, width, i + 1, depth, i * (3 * width + 0.36)),
      ),
    );
  else macro = makeBox("body", width, height, depth);
  if (kind === "tunnel" && reinforcement === "portal-base") {
    // A closed lower bay braces continuous 6-inch side panels. The upper bay
    // remains a through passage; no fake fixed hinge or invisible support is added.
    const full = box({
      id: "body",
      width,
      height: height + 1,
      depth,
      openFaces: ["front", "back"],
    });
    const base = box({
      id: "brace",
      width,
      height: 1,
      depth,
      openFaces: ["left", "right", "bottom", "top"],
    });
    const floor = full.tiles
      .filter((t) => t.id.includes("-bottom-"))
      .map((t) => ({
        ...structuredClone(t),
        id: `${t.id}-raised-floor`,
        position: { ...t.position, y: t.position.y + 3 },
      }));
    const bulkheads = Array.from(
      { length: Math.floor((depth - 1) / 2) },
      (_, i) =>
        base.tiles
          .filter((t) => t.id.includes("-front-"))
          .map((t) => ({
            ...structuredClone(t),
            id: `${t.id}-bulkhead-${i}`,
            position: { ...t.position, z: 6 * (i + 1) },
          })),
    ).flat();
    // No lower floor: transverse base walls stand on the table, with the raised
    // deck on their top edges. This avoids intersecting perpendicular tile prisms.
    macro = {
      tiles: [
        ...full.tiles.filter((t) => !t.id.includes("-bottom-")),
        ...base.tiles,
        ...floor,
        ...bulkheads,
      ],
      connections: [],
    };
  }
  if (reinforcement === "rigid-panels" || reinforcement === "portal-base")
    macro = {
      tiles: mergeRigidPanels(macro.tiles, contract.requireFloors),
      connections: [],
    };
  // Derive every connection from geometry again, after all compiler edits.
  macro = composeMacros({
    tiles: macro.tiles.map((t) => ({
      ...t,
      parentTileId: undefined,
      parentEdge: undefined,
      childEdge: undefined,
      root: false,
    })),
    connections: [],
  });
  // Stable assembly groups: complete a ring plus its floor/diaphragm, then build upward.
  for (const tile of macro.tiles) {
    const b = buildBounds([tile]);
    tile.step = Math.max(1, Math.ceil((b.max.y - 0.2) / 3));
    if (kind === "tunnel")
      tile.step = Math.max(1, Math.ceil((b.max.z - 0.2) / 3));
  }
  // A rigid panel crossing a stage boundary must be assembled with the cells it spans.
  // This is a geometry-derived dependency, not a fallback that calls the whole build one step.
  const parents = Array.from({ length: 32 }, (_, i) => i);
  const root = (n: number): number => (parents[n] === n ? n : root(parents[n]));
  for (const tile of macro.tiles)
    if (tile.shape === "large-square") {
      const b = buildBounds([tile]),
        axis = kind === "tunnel" ? "z" : "y";
      const first = Math.max(1, Math.floor((b.min[axis] + 0.2) / 3) + 1),
        last = Math.max(1, Math.ceil((b.max[axis] - 0.2) / 3));
      for (let s = first + 1; s <= last; s++) parents[root(s)] = root(first);
    }
  const groups = [...new Set(macro.tiles.map((t) => root(t.step)))].sort(
    (a, b) => a - b,
  );
  macro.tiles.forEach((t) => {
    t.step = groups.indexOf(root(t.step)) + 1;
  });
  const bounds = buildBounds(macro.tiles);
  return {
    id: `harness-${hashPrompt(JSON.stringify(program))}`,
    title: `${kind[0].toUpperCase() + kind.slice(1)} · ${kind === "staircase" ? `${steps} steps` : `${width} × ${height + (reinforcement === "portal-base" ? 1 : 0)} × ${depth} cells`}`,
    prompt: contract.prompt,
    seed: hashPrompt(contract.prompt),
    family: kind === "tower" ? "tower" : kind === "tunnel" ? "bridge" : "house",
    inventoryPreset: contract.inventoryPreset,
    summary:
      "Constructed from catalog geometry and evaluated against an explicit intent contract.",
    ...macro,
    bounds: {
      width: bounds.max.x - bounds.min.x,
      height: bounds.max.y - bounds.min.y,
      depth: bounds.max.z - bounds.min.z,
    },
  };
}

/** Replace a coplanar 2×2 square patch with one real 6-inch square. */
function mergeRigidPanels(
  input: TileInstance[],
  preserveWallSeams = false,
): TileInstance[] {
  let tiles = [...input];
  for (const first of input) {
    if (
      !tiles.includes(first) ||
      first.shape !== "small-square" ||
      !first.basis
    )
      continue;
    if (preserveWallSeams && Math.abs(first.basis.zAxis.y) < 0.9) continue;
    const { xAxis, yAxis } = first.basis;
    const patch = [first];
    for (const [dx, dy] of [
      [3, 0],
      [0, 3],
      [3, 3],
    ]) {
      const p = {
        x: first.position.x + dx * xAxis.x + dy * yAxis.x,
        y: first.position.y + dx * xAxis.y + dy * yAxis.y,
        z: first.position.z + dx * xAxis.z + dy * yAxis.z,
      };
      const found = tiles.find(
        (t) =>
          t !== first &&
          t.shape === "small-square" &&
          JSON.stringify(t.basis) === JSON.stringify(first.basis) &&
          Math.hypot(
            t.position.x - p.x,
            t.position.y - p.y,
            t.position.z - p.z,
          ) < 0.001,
      );
      if (found) patch.push(found);
    }
    if (patch.length !== 4) continue;
    const merged: TileInstance = {
      ...first,
      id: `${first.id}-rigid`,
      shape: "large-square",
      position: {
        x: first.position.x + 1.5 * (xAxis.x + yAxis.x),
        y: first.position.y + 1.5 * (xAxis.y + yAxis.y),
        z: first.position.z + 1.5 * (xAxis.z + yAxis.z),
      },
      role: "rigid catalog panel",
    };
    tiles = tiles.filter((t) => !patch.includes(t));
    tiles.push(merged);
  }
  return tiles;
}
