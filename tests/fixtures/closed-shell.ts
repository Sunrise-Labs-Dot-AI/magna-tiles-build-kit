import { assemble, outside, square, v } from "@/lib/replication/geometry";

/** Exact finite-thickness shell, independent of any reconstructed source model. */
export function closedShell(levels: number) {
  const tiles = [];
  for (let level = 0; level < levels; level++) {
    const inside = v(0, 3 * level + 1.5, 0);
    for (const side of [-1, 1]) {
      tiles.push(outside(square(`x-${level}-${side}`, v(side * 1.5, 3 * level, -1.5),
        v(0, 3, 0), v(0, 0, 3), "blue", level + 1, "shell"), inside));
      tiles.push(outside(square(`z-${level}-${side}`, v(-1.5, 3 * level, side * 1.5),
        v(3, 0, 0), v(0, 3, 0), "red", level + 1, "shell"), inside));
    }
  }
  tiles.push(outside(square("roof", v(-1.5, 3 * levels, -1.5), v(3, 0, 0),
    v(0, 0, 3), "green", levels + 1, "shell"), v(0, 3 * levels - 1.5, 0)));
  return assemble(`closed-shell-${levels}`, "Closed support fixture", tiles, "tower");
}
