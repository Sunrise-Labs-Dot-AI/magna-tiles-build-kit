import { BUILD_LIBRARY } from "../lib/magnetic-tiles/library";
import { generateBuild } from "../lib/magnetic-tiles/generate";
import { tilesIntersectAsPrisms } from "../lib/magnetic-tiles/prism-geometry";
import type { TileInstance } from "../lib/magnetic-tiles/types";

const HAIRLINE_TOLERANCE = 0.03;

interface RawOverlap {
  firstTileId: string;
  secondTileId: string;
  penetration: number;
}

for (const item of BUILD_LIBRARY) {
  const result = generateBuild(item.prompt);
  const overlaps = rawOverlaps(result.build.tiles);
  console.log(
    [
      item.id,
      `validation=${result.validation.status}`,
      `issues=${result.validation.issues.length}`,
      `rawOverlaps=${overlaps.length}`,
      `maxPenetration=${Math.max(0, ...overlaps.map((overlap) => overlap.penetration)).toFixed(3)}`
    ].join(" ")
  );

  overlaps.forEach((overlap) => {
    console.log(
      `  ${overlap.firstTileId} <-> ${overlap.secondTileId} penetration=${overlap.penetration.toFixed(3)}`
    );
  });
}

function rawOverlaps(tiles: TileInstance[]): RawOverlap[] {
  const overlaps: RawOverlap[] = [];

  for (let firstIndex = 0; firstIndex < tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tiles.length; secondIndex += 1) {
      const first = tiles[firstIndex];
      const second = tiles[secondIndex];
      const intersection = tilesIntersectAsPrisms(first, second);
      if (!intersection.overlaps || intersection.penetration <= HAIRLINE_TOLERANCE) continue;

      overlaps.push({
        firstTileId: first.id,
        secondTileId: second.id,
        penetration: intersection.penetration
      });
    }
  }

  return overlaps;
}
