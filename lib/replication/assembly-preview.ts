import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import type { AssemblyOperationResult } from "./assembly";
import { insertionPreview } from "./insertion";

/** Playback uses saved physics poses. It does not interpolate a falling panel
 * toward its goal or replace a failed final frame with the authored geometry. */
export function assemblyOperationPreview(checkpoint: BuildGraph, operation: AssemblyOperationResult, progress: number): BuildGraph {
  const actual = { ...checkpoint, tiles: operation.approachTiles ?? checkpoint.tiles };
  if (!operation.path) return actual;
  const t = Math.max(0, Math.min(1, progress)), motion = operation.seating?.motion;
  if (!motion?.length) return insertionPreview(actual, operation.path, t);
  if (t < .5) return insertionPreview(actual, operation.path, t * 2);
  const frame = motion[Math.min(motion.length - 1, Math.floor((t - .5) * 2 * motion.length))];
  const present = new Set(frame.tiles.map(tile => tile.id)), moving = new Set(operation.tileIds);
  return { ...checkpoint, tiles: frame.tiles,
    connections: checkpoint.connections.filter(c => present.has(c.fromTileId) && present.has(c.toTileId) &&
      moving.has(c.fromTileId) === moving.has(c.toTileId)) };
}
