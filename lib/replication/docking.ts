import { add, distance, magnitude, scale, subtract } from "@/lib/engine/math";
import { MAX_STANDING_DISPLACEMENT } from "@/lib/engine/constants";
import { buildBounds } from "@/lib/engine/build";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { prismGap, prismPose } from "@/lib/magnetic-tiles/swept-prisms";
import { componentContacts } from "./components";
import { findHandInsertionPath, type HandContact } from "./grip";
import type { InsertionPath } from "./insertion";
import type { Check } from "./types";

export interface DockingResult extends Check {
  offset: Vec3;
  /** Proposed cross-solid depth, not a dynamic acceptance certificate. */
  targetPenetration: number | null;
  build: BuildGraph;
  path?: InsertionPath;
}
export type DockingPolicy = "clear-first" | "support-aligned";

/** Align only the incoming part to its actual installed neighbors. This is a
 * bounded physical pose proposal, independent of source pixels. Every candidate
 * must pass the existing solid, contact, insertion, grip and fixed-floor checks. */
export function dockToSupports(nominal: BuildGraph, actual: BuildGraph, movingIds: string[], installedIds: string[], hands: HandContact[], floorY: number, policy: DockingPolicy, deadline = Infinity, components?: string[][]): DockingResult {
  if (policy !== "clear-first" && policy !== "support-aligned") throw new Error("Unknown docking policy");
  const moving = new Set(movingIds), installed = new Set(installedIds), present = new Set([...movingIds,...installedIds]);
  const neighbors = new Set(actual.connections.flatMap(c => moving.has(c.fromTileId) && installed.has(c.toTileId) ? [c.toTileId]
    : moving.has(c.toTileId) && installed.has(c.fromTileId) ? [c.fromTileId] : []));
  const deltas = [...neighbors].map(id => subtract(actual.tiles.find(t => t.id === id)!.position, nominal.tiles.find(t => t.id === id)!.position));
  const mean = deltas.length ? scale(deltas.reduce(add, { x: 0,y: 0,z: 0 }),1/deltas.length) : { x: 0,y: 0,z: 0 };
  let detail = "No bounded docking proposal satisfies the physical checks.";
  const proposals = [mean, ...[-.03,0,.03].flatMap(x => [-.03,0,.03].flatMap(y => [-.03,0,.03].map(z => add(mean,{ x,y,z })))), { x: 0,y: 0,z: 0 }];
  // Consider every clear target before an original-tolerance target, minimizing
  // the change from the support-aligned pose within each group. Existing motion,
  // closure and release checks still decide whether a proposal is buildable.
  const candidates = proposals.map(offset => {
    const build = { ...actual, tiles: actual.tiles.map(t => moving.has(t.id) ? { ...t,position: add(t.position,offset) } : t) };
    const incoming = build.tiles.filter(t => moving.has(t.id)).map(prismPose);
    const supports = build.tiles.filter(t => installed.has(t.id)).map(prismPose);
    const gaps = incoming.flatMap(a => supports.map(b => prismGap(a,b)));
    const targetPenetration = gaps.every(Number.isFinite) ? Math.max(0,...gaps.map(gap => -gap)) : Infinity;
    return { offset,build,targetPenetration };
  });
  if (policy === "clear-first") candidates.sort((a,b) => Number(a.targetPenetration > 1e-7)-Number(b.targetPenetration > 1e-7) || distance(a.offset,mean)-distance(b.offset,mean));
  const reasons = new Set<string>();
  for (const { offset,build,targetPenetration } of candidates) {
    if (reasons.size < 5) reasons.add(detail);
    if (targetPenetration > RAW_OVERLAP_TOLERANCE) { detail = "Docking target has invalid or excessive incoming-versus-installed solid penetration."; continue; }
    if (magnitude(offset) > MAX_STANDING_DISPLACEMENT) { detail = "Required docking correction exceeds the unchanged displacement limit."; continue; }
    const placed = { ...build, tiles: build.tiles.filter(t => present.has(t.id)), connections: build.connections.filter(c => present.has(c.fromTileId) && present.has(c.toTileId)) };
    if (buildBounds(placed.tiles).min.y < floorY-RAW_OVERLAP_TOLERANCE) { detail = "Docked parts intersect the fixed table; an actual support lift is required."; continue; }
    const closure = componentContacts(placed,components);
    if (closure.status !== "pass") { detail = closure.detail; continue; }
    const path = findHandInsertionPath(build,movingIds,installedIds,hands,floorY,deadline);
    if (!path) { detail = "Docked pose has no insertion that clears both solids and fingertips."; continue; }
    return { status: "pass", detail: `Incoming target passes closure, grip and insertion checks with ${targetPenetration.toFixed(6)} in cross-solid penetration. Connected stabilization and free release remain mandatory.`, offset,targetPenetration,build,path };
  }
  return { status: "fail", detail: [...reasons,detail].filter(d => !d.startsWith("No bounded")).join(" "), offset: mean,targetPenetration: null,build: actual };
}
