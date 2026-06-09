import { describe, expect, it } from "vitest";
import { readBuildDraft } from "@/lib/builder/storage";
import { tilesIntersectAsPrisms } from "@/lib/magnetic-tiles/prism-geometry";
import type { TileInstance } from "@/lib/magnetic-tiles/types";
import { ENGINE_VALID_LIBRARY_BUILD_IDS } from "@/verification/engine-valid-builds";

const HAIRLINE_TOLERANCE = 0.03;

describe("engine-valid raw geometry anchor", () => {
  it.each(ENGINE_VALID_LIBRARY_BUILD_IDS)("%s has no independent raw tile overlaps", async (id) => {
    const draft = await readBuildDraft(id);

    expect(rawOverlaps(draft.tiles)).toEqual([]);
  });

  it("detects impossible duplicate tile interpenetration", async () => {
    const draft = await readBuildDraft(ENGINE_VALID_LIBRARY_BUILD_IDS[0]);
    const duplicateTiles = [
      draft.tiles[0],
      {
        ...draft.tiles[0],
        id: "duplicate-tile"
      }
    ];

    expect(rawOverlaps(duplicateTiles)).toEqual([
      {
        firstTileId: draft.tiles[0].id,
        secondTileId: "duplicate-tile",
        penetration: expect.any(Number)
      }
    ]);
  });
});

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
