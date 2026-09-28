import type { TileInstance } from "@/lib/magnetic-tiles/types";
import { pointMotionBound } from "./rotation-clearance";

export interface MotionFrame { seconds: number; tiles: TileInstance[] }

/** Presentation keyframes only. Every physics substep is still validated. Keep
 * actual first/terminal poses, omit visually stationary repeats, and bound the
 * downloaded replay size without inventing intermediate geometry. */
export function compactMotion(frames: MotionFrame[]): MotionFrame[] {
  if (frames.length < 3) return frames;
  const changes = [frames[0]];
  for (const frame of frames.slice(1,-1)) {
    const prior = changes.at(-1)!;
    if (frame.tiles.some((tile,i) => !prior.tiles[i] || tile.id !== prior.tiles[i].id || pointMotionBound(prior.tiles[i],tile) > .025)) changes.push(frame);
  }
  changes.push(frames.at(-1)!);
  if (changes.length <= 32) return changes;
  return Array.from({ length: 32 },(_,i) => changes[Math.round(i*(changes.length-1)/31)]);
}
