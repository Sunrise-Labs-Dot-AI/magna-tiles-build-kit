import { createHash } from "node:crypto";
import { PHYSICS_MODEL_VERSION } from "@/lib/engine/constants";
import { simulate, type SimulationResult } from "@/lib/engine/simulate";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

/** Process-local, bounded, content-addressed evidence. Never cache caller pass flags.
 * Assembly labels do not change physics; all tile geometry and connections do.
 */
export function physicsKey(build: BuildGraph): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        physicsModel: PHYSICS_MODEL_VERSION,
        family: build.family,
        tiles: build.tiles.map((tile) => ({ ...tile, step: undefined })),
        connections: build.connections,
      }),
    )
    .digest("hex");
}
const simulations = new Map<string, SimulationResult>();
export async function cachedSimulation(
  build: BuildGraph,
  deadline = Infinity,
): Promise<SimulationResult> {
  const key = physicsKey(build),
    cached = simulations.get(key);
  if (cached) return structuredClone(cached);
  const result = await simulate(build, { deadline });
  if (simulations.size >= 64)
    simulations.delete(simulations.keys().next().value!);
  simulations.set(key, structuredClone(result));
  return result;
}
