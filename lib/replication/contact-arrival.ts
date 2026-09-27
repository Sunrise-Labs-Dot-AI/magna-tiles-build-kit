import { connectionId } from "@/lib/engine/build";
import { dot } from "@/lib/engine/math";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, MagneticConnection } from "@/lib/magnetic-tiles/types";
import { contactsClosed } from "./contacts";
import { separatingAxes } from "./insertion";
import type { Check } from "./types";

export interface ContactArrivalContract {
  connections: MagneticConnection[];
  /** This waypoint and the next command the same separated pose for a dwell. */
  separationWaypoint: number;
}
export interface SeparationResult extends Check { separations: { connectionId: string; gap: number }[] }

/** Engine joint IDs retain authored direction; physical pair equality does not. */
export const physicalConnectionId = (c: MagneticConnection) => `${c.fromTileId}:${c.fromEdge}` < `${c.toTileId}:${c.toEdge}` ? connectionId(c)
  : connectionId({...c,fromTileId:c.toTileId,fromEdge:c.toEdge,toTileId:c.fromTileId,toEdge:c.fromEdge});

export function separatedContacts(build: BuildGraph, connections: MagneticConnection[]): SeparationResult {
  const separations = connections.map(c => {
    const a = build.tiles.find(t => t.id === c.fromTileId)!,b = build.tiles.find(t => t.id === c.toTileId)!;
    const av=tilePrismVertices(a),bv=tilePrismVertices(b);
    const gap=Math.max(...separatingAxes(a,b).map(axis=>{
      const ap=av.map(p=>dot(p,axis)),bp=bv.map(p=>dot(p,axis));
      return Math.max(Math.min(...ap)-Math.max(...bp),Math.min(...bp)-Math.max(...ap));
    }));
    return { connectionId: connectionId(c),gap: findMagneticEdgeMatch(a,b) ? 0 : gap };
  });
  const pass=separations.every(s=>Number.isFinite(s.gap)&&s.gap>0);
  return {status:pass?"pass":"fail",detail:pass?"All named cross pairs remain physically separated in the actual stationary approach checkpoint.":"An actual approach pair is touching or already magnetically closed.",separations};
}

/** Enumerate actual closed pairs, not merely the subset a proposal asks to join. */
export function exactContactArrival(build: BuildGraph, moving: Set<string>, expected: MagneticConnection[]): Check & { physicalConnectionIds: string[] } {
  const found: string[]=[];
  for(const a of build.tiles.filter(t=>moving.has(t.id))) for(const b of build.tiles.filter(t=>!moving.has(t.id))) {
    const match=findMagneticEdgeMatch(a,b);
    if(!match) continue;
    const c: MagneticConnection={kind:"edge",fromTileId:a.id,fromEdge:match.fromEdge,toTileId:b.id,toEdge:match.toEdge};
    if(contactsClosed({...build,tiles:[a,b],connections:[c]}).status==="pass") found.push(physicalConnectionId(c));
  }
  const ids=expected.map(physicalConnectionId).sort();
  const pass=ids.length>0&&new Set(ids).size===ids.length&&JSON.stringify(found.sort())===JSON.stringify(ids);
  return {status:pass?"pass":"fail",physicalConnectionIds:found,detail:pass?"Actual arrival earns exactly the named cross contacts; joins remain absent until connected stabilization.":`Actual cross contacts differ: expected ${ids.join(", ")}; found ${found.join(", ")||"none"}.`};
}
