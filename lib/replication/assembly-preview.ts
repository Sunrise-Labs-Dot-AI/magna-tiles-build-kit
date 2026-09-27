import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import type { AssemblyOperationResult } from "./assembly";
import { insertionPreview } from "./insertion";

/** Playback uses saved physics poses. It does not interpolate a falling panel
 * toward its goal or replace a failed final frame with the authored geometry. */
export function assemblyOperationPreview(checkpoint: BuildGraph, operation: AssemblyOperationResult, progress: number): BuildGraph {
  const actual = { ...checkpoint, tiles: operation.approachTiles ?? checkpoint.tiles };
  const t = Math.max(0, Math.min(1, progress));
  const phases = (operation.timeline?.map(p => p.phase === "support" ? operation.trials[p.index]?.motion : operation[p.phase]?.motion) ??
    [operation.pickup?.motion,operation.carry?.motion,operation.seating?.motion,operation.lowering?.motion]).filter(m => m?.length);
  if (!phases.length) return operation.path ? insertionPreview(actual, operation.path, t) : actual;
  // Historical seating-only reports still include their checked approach.
  const legacy = !operation.timeline && !operation.carry && !operation.pickup;
  if (legacy && operation.path && t < .5) return insertionPreview(actual,operation.path,t*2);
  const phaseTime = legacy ? (t-.5)*2 : t*phases.length;
  const phaseIndex = Math.min(phases.length-1,Math.floor(phaseTime)), motion = phases[phaseIndex]!;
  const frame = motion[Math.min(motion.length-1,Math.floor((phaseTime-phaseIndex)*motion.length))];
  const present = new Set(frame.tiles.map(tile => tile.id)), moving = new Set(operation.tileIds);
  return { ...checkpoint, tiles: frame.tiles,
    connections: checkpoint.connections.filter(c => present.has(c.fromTileId) && present.has(c.toTileId) &&
      moving.has(c.fromTileId) === moving.has(c.toTileId)) };
}
