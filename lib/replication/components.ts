import { findRawOverlaps } from "@/lib/engine/overlap";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import { closedMagneticConnection, contactsClosed } from "./contacts";
import type { Check } from "./types";

/** Only declared independent modules may remain disconnected in one workspace.
 * Every body belongs to exactly one group; each group must retain all its joins. */
export function componentContacts(build: BuildGraph, groups?: string[][]): Check {
  if (!groups) return contactsClosed(build);
  const ids = groups.flat(), present = new Set(build.tiles.map(t => t.id));
  if (ids.length !== present.size || new Set(ids).size !== ids.length || ids.some(id => !present.has(id)) ||
      groups.some(g => !g.length) || build.connections.some(c => !groups.some(g => g.includes(c.fromTileId) && g.includes(c.toTileId))))
    return { status: "fail",detail: "Independent component contract omits, duplicates or crosses a declared group." };
  if (findRawOverlaps(build.tiles).length) return { status: "fail",detail: "Independent workspace components intersect." };
  const groupByTile = new Map(groups.flatMap((group,index) => group.map(id => [id,index] as const)));
  for (let i=0;i<build.tiles.length;i++) for (let j=i+1;j<build.tiles.length;j++) {
    const a=build.tiles[i],b=build.tiles[j];
    if (groupByTile.get(a.id) === groupByTile.get(b.id)) continue;
    if (closedMagneticConnection(build,a,b)) return { status: "fail",detail: "Independent workspace components have unearned magnetic contact." };
  }
  for (const group of groups) {
    const part = { ...build,tiles: build.tiles.filter(t => group.includes(t.id)),connections: build.connections.filter(c => group.includes(c.fromTileId)) };
    const check = contactsClosed(part);
    if (check.status !== "pass") return check;
  }
  return { status: "pass",detail: "Every declared component retains valid internal contacts; all workspace solids are separate." };
}

/** Resolve only already-present bodies. This group defines a motion baseline,
 * never additional grips or kinematic support for its ungripped neighbors. */
export function movingComponent(build: BuildGraph, gripTileId: string, groups?: string[][]): Check & { tileIds: string[] } {
  const check = componentContacts(build,groups);
  if (check.status !== "pass") return { ...check,tileIds: [] };
  const group = groups?.find(g => g.includes(gripTileId)) ?? (!groups ? build.tiles.map(t => t.id) : []);
  if (!group.includes(gripTileId)) return { status: "fail",detail: "The pickup grip has no present declared component.",tileIds: [] };
  return { status: "pass",detail: "Resolved the gripped panel's complete present component; other components remain dynamic obstacles.",tileIds: [...group] };
}

export const splitComponents = (groups: string[][], moving: Set<string>) => groups.flatMap(g => [g.filter(id => moving.has(id)),g.filter(id => !moving.has(id))]).filter(g => g.length);
export const disconnectedReason = (reason: string) => reason.startsWith("disconnected-tile:") || reason === "no-valid-magnetic-joints";
