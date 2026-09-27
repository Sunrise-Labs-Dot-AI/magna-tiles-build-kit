import { add, magnitude, scale, subtract } from "@/lib/engine/math";
import { MAX_STANDING_DISPLACEMENT } from "@/lib/engine/constants";
import { buildBounds } from "@/lib/engine/build";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { contactsClosed } from "./contacts";
import { checkHandAccess, type HandContact } from "./grip";
import { findInsertionPath, type InsertionPath } from "./insertion";
import type { Check } from "./types";

export interface DockingResult extends Check { offset: Vec3; build: BuildGraph; path?: InsertionPath }

/** Align only the incoming part to its actual installed neighbors. This is a
 * bounded physical pose proposal, independent of source pixels. Every candidate
 * must pass the existing solid, contact, insertion, grip and fixed-floor checks. */
export function dockToSupports(nominal: BuildGraph, actual: BuildGraph, movingIds: string[], installedIds: string[], hands: HandContact[], floorY: number, deadline = Infinity): DockingResult {
  const moving = new Set(movingIds), installed = new Set(installedIds), present = new Set([...movingIds,...installedIds]);
  const neighbors = new Set(actual.connections.flatMap(c => moving.has(c.fromTileId) && installed.has(c.toTileId) ? [c.toTileId]
    : moving.has(c.toTileId) && installed.has(c.fromTileId) ? [c.fromTileId] : []));
  const deltas = [...neighbors].map(id => subtract(actual.tiles.find(t => t.id === id)!.position, nominal.tiles.find(t => t.id === id)!.position));
  const mean = deltas.length ? scale(deltas.reduce(add, { x: 0,y: 0,z: 0 }),1/deltas.length) : { x: 0,y: 0,z: 0 };
  let detail = "No bounded docking proposal satisfies the physical checks.";
  const proposals = [mean, ...[-.03,0,.03].flatMap(x => [-.03,0,.03].flatMap(y => [-.03,0,.03].map(z => add(mean,{ x,y,z })))), { x: 0,y: 0,z: 0 }];
  const reasons = new Set<string>();
  for (const offset of proposals) {
    if (reasons.size < 5) reasons.add(detail);
    if (magnitude(offset) > MAX_STANDING_DISPLACEMENT) { detail = "Required docking correction exceeds the unchanged displacement limit."; continue; }
    const build = { ...actual, tiles: actual.tiles.map(t => moving.has(t.id) ? { ...t, position: add(t.position,offset) } : t) };
    const placed = { ...build, tiles: build.tiles.filter(t => present.has(t.id)), connections: build.connections.filter(c => present.has(c.fromTileId) && present.has(c.toTileId)) };
    if (buildBounds(placed.tiles).min.y < floorY-RAW_OVERLAP_TOLERANCE) { detail = "Docked parts intersect the fixed table; an actual support lift is required."; continue; }
    const closure = contactsClosed(placed);
    if (closure.status !== "pass") { detail = closure.detail; continue; }
    const path = findInsertionPath(build,movingIds,installedIds,deadline,floorY);
    if (!path) { detail = "Docked pose has no clear insertion."; continue; }
    const grip = checkHandAccess(build,path,hands,floorY);
    if (grip.status !== "pass") { detail = grip.detail; continue; }
    return { status: "pass", detail: "Incoming parts aligned to actual support displacement; unchanged closure, solids, grip and insertion checks pass.", offset, build, path };
  }
  return { status: "fail", detail: [...reasons,detail].filter(d => !d.startsWith("No bounded")).join(" "), offset: mean, build: actual };
}
