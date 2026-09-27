import { validateMagneticBuild } from "@/lib/engine/build";
import { dot, subtract, magnitude, scale } from "@/lib/engine/math";
import { TILE_THICKNESS } from "@/lib/engine/constants";
import { findRawOverlaps } from "@/lib/engine/overlap";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import type { Check } from "./types";

export function contactsClosed(build: BuildGraph): Check {
  const validation = validateMagneticBuild(build);
  if (validation.rejectedReasons.length || findRawOverlaps(build.tiles).length)
    return { status: "fail", detail: `Contact closure rejected: ${validation.rejectedReasons.join("; ") || "intersecting solid parts"}.` };
  // The legacy magnetic search allows distant near-matches. A closure certificate
  // additionally requires actual finite-thickness edge proximity and alignment.
  for (const c of validation.validConnections) {
    const a = c.fromEdge, b = c.toEdge, delta = subtract(b.midpoint, a.midpoint);
    const gap = magnitude(subtract(delta, scale(a.direction, dot(delta, a.direction))));
    const aa = [a.start, a.end].map(p => dot(p, a.direction)), bb = [b.start, b.end].map(p => dot(p, a.direction));
    const overlap = Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb));
    if (gap > TILE_THICKNESS + 0.03 || Math.abs(dot(a.direction, b.direction)) < Math.cos(Math.PI / 36) || overlap < Math.min(a.length, b.length) - 0.21)
      return { status: "fail", detail: `Edges do not close at ${c.id}: transverse gap ${gap.toFixed(3)} in, overlap ${overlap.toFixed(3)} in.` };
  }
  return { status: "pass", detail: "Solid edge gaps, overlap and orientation close." };
}

