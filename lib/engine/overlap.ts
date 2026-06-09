import { tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import type { TileInstance } from "@/lib/magnetic-tiles/types";

/**
 * Physical tiles cannot occupy the same space. This is the single source of truth for raw tile
 * interpenetration across the engine, the gate, the strict assembler, and the authoring guard.
 *
 * The tolerance is a hairline: it admits face-to-face contact (touching panels, magnet seating)
 * and floating-point noise, NOT real overlap. It is never widened to make a build pass.
 */
export const RAW_OVERLAP_TOLERANCE = 0.03;

export interface RawOverlap {
  firstTileId: string;
  secondTileId: string;
  penetration: number;
}

export function findRawOverlaps(
  tiles: TileInstance[],
  tolerance = RAW_OVERLAP_TOLERANCE
): RawOverlap[] {
  const overlaps: RawOverlap[] = [];
  for (let firstIndex = 0; firstIndex < tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tiles.length; secondIndex += 1) {
      const first = tiles[firstIndex];
      const second = tiles[secondIndex];
      const intersection = tilesIntersectAsPrisms(first, second);
      if (!intersection.overlaps || intersection.penetration <= tolerance) continue;
      overlaps.push({
        firstTileId: first.id,
        secondTileId: second.id,
        penetration: Number(intersection.penetration.toFixed(3))
      });
    }
  }
  return overlaps;
}

/** Raw overlaps that involve a specific tile id (used by the construction-time authoring guard). */
export function overlapsInvolvingTile(
  tileId: string,
  tiles: TileInstance[],
  tolerance = RAW_OVERLAP_TOLERANCE
): RawOverlap[] {
  return findRawOverlaps(tiles, tolerance).filter(
    (overlap) => overlap.firstTileId === tileId || overlap.secondTileId === tileId
  );
}

export class RawOverlapError extends Error {
  readonly overlaps: RawOverlap[];
  constructor(overlaps: RawOverlap[]) {
    const detail = overlaps
      .slice(0, 8)
      .map((overlap) => `${overlap.firstTileId}<->${overlap.secondTileId}:${overlap.penetration}`)
      .join(", ");
    super(
      `build rejected: ${overlaps.length} overlapping tile pair(s) exceed the ${RAW_OVERLAP_TOLERANCE} hairline (${detail})`
    );
    this.name = "RawOverlapError";
    this.overlaps = overlaps;
  }
}

/** Throw if any pair of tiles interpenetrates beyond the hairline. */
export function assertNoRawOverlaps(tiles: TileInstance[], tolerance = RAW_OVERLAP_TOLERANCE): void {
  const overlaps = findRawOverlaps(tiles, tolerance);
  if (overlaps.length > 0) throw new RawOverlapError(overlaps);
}
