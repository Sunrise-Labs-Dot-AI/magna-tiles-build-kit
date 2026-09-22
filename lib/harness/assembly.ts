import { buildBounds } from "@/lib/engine/build";
import { cachedSimulation } from "./cache";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

/** Start with the ground-contact floor, then release only at tested stable prefixes.
 * This plans explicit held subassemblies, not unattended stability of each individual join.
 */
export async function planStablePrefixes(
  input: BuildGraph,
  deadline = Infinity,
): Promise<BuildGraph> {
  const build = structuredClone(input),
    bounds = buildBounds(build.tiles);
  const phase = (tile: BuildGraph["tiles"][number]) => {
    const b = buildBounds([tile]);
    return b.max.y < bounds.min.y + 0.3 ? 0 : tile.step;
  };
  const originalPhases = new Map(
    build.tiles.map((tile) => [tile.id, phase(tile)]),
  );
  const phases = [...new Set(originalPhases.values())].sort((a, b) => a - b);
  const released = new Set<string>();
  let step = 1;
  for (const current of phases) {
    const tiles = build.tiles.filter(
        (t) => originalPhases.get(t.id)! <= current,
      ),
      ids = new Set(tiles.map((t) => t.id));
    const result = await cachedSimulation(
      {
        ...build,
        tiles,
        connections: build.connections.filter(
          (c) => ids.has(c.fromTileId) && ids.has(c.toTileId),
        ),
      },
      deadline,
    );
    if (!result.stands && current !== phases.at(-1)) continue;
    for (const tile of tiles)
      if (!released.has(tile.id)) {
        tile.step = step;
        released.add(tile.id);
      }
    step++;
  }
  return build;
}
