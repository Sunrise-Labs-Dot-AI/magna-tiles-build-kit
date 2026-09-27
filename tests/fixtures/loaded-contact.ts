import { assemble, v } from "../../lib/replication/geometry";
import { TILE_THICKNESS } from "../../lib/magnetic-tiles/catalog";
import { closedShell } from "./closed-shell";
import { flatContactFixture, loadedContactFixture } from "./rigid-contact";

/** Independent catalog load family. One base carries four walls per level.
 * The existing five-panel fixture is preserved byte-for-byte. No source fit. */
export function loadedShellContactFixture(levels: number) {
  if (![1, 2, 3, 4, 6].includes(levels)) throw new Error("Undeclared contact load");
  if (levels === 1) return loadedContactFixture();
  const flip = (p: { x: number; y: number; z: number }) => v(p.x, -p.y, -p.z);
  return assemble(`loaded-shell-${levels}`, `Independent ${levels}-level base load`,
    closedShell(levels).tiles.map(tile => ({
      ...tile, step: 1,
      position: v(tile.position.x, 3 * levels + TILE_THICKNESS - tile.position.y, -tile.position.z),
      basis: {
        xAxis: flip(tile.basis!.xAxis), yAxis: flip(tile.basis!.yAxis), zAxis: flip(tile.basis!.zAxis),
      },
    })), "tower");
}

export const contactMatrixFixtures = () => [flatContactFixture(), ...[1, 2, 3, 4, 6].map(loadedShellContactFixture)];
