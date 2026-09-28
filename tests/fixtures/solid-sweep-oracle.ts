// Frozen pre-optimization implementation from commit 05e3775.
// Deliberately independent arithmetic/control flow for equivalence tests.
import { add, basisToQuaternion, cross, distance, dot, normalize, normalizeQuaternion, quaternionAngle, quaternionToBasis, scale, slerp, subtract, type Quat } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileNormal, tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";

export interface SolidFailure {
  kind: "overlap" | "table" | "uncertified-sweep";
  tileIds: string[];
  /** Unrounded measured depth; absent when the sweep cannot be certified. */
  penetration?: number;
  detail: string;
}

export interface PrismPose {
  tile: TileInstance;
  vertices: Vec3[];
  rotation: Quat;
  radius: number;
  edges: Vec3[];
  normals: Vec3[];
  min: Vec3;
  max: Vec3;
}

export function tileQuaternion(t: TileInstance): Quat {
  const basis=t.basis??basisFromEuler(t.rotation.x,t.rotation.y,t.rotation.z);
  // Some legacy tiles reverse the normal without changing the polygon axes.
  // A symmetric prism has the same solid with either normal. Use a proper
  // rotation, never feed a reflection matrix to quaternion interpolation.
  return normalizeQuaternion(basisToQuaternion({...basis,zAxis:normalize(cross(basis.xAxis,basis.yAxis))}));
}
export function interpolateTile(a: TileInstance, b: TileInstance, t: number): TileInstance {
  return { ...a, position: add(scale(a.position, 1-t), scale(b.position, t)), basis: quaternionToBasis(slerp(tileQuaternion(a), tileQuaternion(b), t)) };
}
export function prismPose(tile: TileInstance): PrismPose {
  const vertices = tilePrismVertices(tile), n = vertices.length/2, normal = tileNormal(tile);
  const edges = [normal, ...vertices.slice(0,n).map((p,i) => normalize(subtract(vertices[(i+1)%n],p)))];
  return { tile, vertices, rotation: tileQuaternion(tile), edges, normals: [normal,...edges.slice(1).map(e => normalize(cross(e,normal)))],
    radius: Math.max(...vertices.map(p => distance(p,tile.position))),
    min: { x: Math.min(...vertices.map(p=>p.x)), y: Math.min(...vertices.map(p=>p.y)), z: Math.min(...vertices.map(p=>p.z)) },
    max: { x: Math.max(...vertices.map(p=>p.x)), y: Math.max(...vertices.map(p=>p.y)), z: Math.max(...vertices.map(p=>p.z)) } };
}
function axes(a: PrismPose,b: PrismPose): Vec3[] {
  // Include prism thickness edges. No angular deduplication may discard a
  // separating direction when panels are almost parallel.
  return [...a.normals,...b.normals,...a.edges.flatMap(e=>b.edges.map(f=>cross(e,f)))].flatMap(v=>{
    const length=Math.hypot(v.x,v.y,v.z);
    // The general math helper deliberately zeroes tiny vectors. A tiny cross
    // product here is still a valid separating axis and must be normalized.
    return length>0?[scale(v,1/length)]:[];
  });
}
export function separatingAxes(a: TileInstance,b: TileInstance): Vec3[] { return axes(prismPose(a),prismPose(b)); }
function axisGap(a: PrismPose,b: PrismPose,axis: Vec3): number {
  let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(const p of a.vertices){const v=dot(p,axis);amin=Math.min(amin,v);amax=Math.max(amax,v);}
  for(const p of b.vertices){const v=dot(p,axis);bmin=Math.min(bmin,v);bmax=Math.max(bmax,v);}
  return Math.max(amin-bmax,bmin-amax);
}
function boxGap(a: PrismPose,b: PrismPose): number {
  return Math.max(...(["x","y","z"] as const).flatMap(k=>[a.min[k]-b.max[k],b.min[k]-a.max[k]]));
}
/** Signed separating distance. Negative is minimum translation needed to
 * separate the solid prisms, including one prism enclosed by the other. */
export function prismGap(a: PrismPose,b: PrismPose): number { return Math.max(...axes(a,b).map(axis=>axisGap(a,b,axis))); }
function motion(a: PrismPose,b: PrismPose): number {
  return distance(a.tile.position,b.tile.position)+a.radius*quaternionAngle(a.rotation,b.rotation);
}
export function pointMotionBound(a: TileInstance,b: TileInstance): number { return motion(prismPose(a),prismPose(b)); }

export interface SolidSweepResult {
  failure?: SolidFailure;
  /** Largest measured exact depth at evaluated poses, not an upper bound on
   * continuous penetration. Every unmeasured interval is certified separately. */
  peakSolidOverlap: number;
  peakSolidPair?: [string,string];
  peakGroundPenetration: number;
}

/** Certifies the closed interval of linearly translated, slerped rigid poses.
 * A separating gap must cover a conservative bound on every vertex's motion.
 * Endpoints alone never certify an ambiguous interval. */
export function checkSolidSweep(before: PrismPose[],after: PrismPose[],floor: number,tolerance: number,checkBudget=()=>{}): SolidSweepResult {
  const result: SolidSweepResult={peakSolidOverlap:0,peakGroundPenetration:0};
  const unresolved=(ids:string[]):SolidFailure=>({kind:"uncertified-sweep",tileIds:ids,detail:`Swept solid clearance cannot be certified for ${ids.join(" / ")}.`});
  if(!Number.isFinite(floor)||before.length!==after.length||before.some((a,i)=>a.tile.id!==after[i].tile.id||a.tile.shape!==after[i].tile.shape))
    return {...result,failure:unresolved(before.map(p=>p.tile.id))};
  const observePair=(a:PrismPose,b:PrismPose):number=>{
    const box=boxGap(a,b),gap=box>0?box:prismGap(a,b);
    if(-gap>result.peakSolidOverlap){result.peakSolidOverlap=-gap;result.peakSolidPair=[a.tile.id,b.tile.id];}
    if(gap < -tolerance-1e-9)result.failure={kind:"overlap",tileIds:[a.tile.id,b.tile.id],penetration:-gap,detail:`${a.tile.id} intersects ${b.tile.id} by ${-gap} in during motion.`};
    return gap;
  };
  const observeFloor=(a:PrismPose)=>{
    result.peakGroundPenetration=Math.max(result.peakGroundPenetration,floor-a.min.y);
    if(a.min.y<floor-tolerance-1e-9)result.failure={kind:"table",tileIds:[a.tile.id],penetration:floor-a.min.y,detail:`${a.tile.id} intersects the fixed table by ${floor-a.min.y} in during motion.`};
  };
  const middle=(a:PrismPose,b:PrismPose)=>prismPose(interpolateTile(a.tile,b.tile,.5));
  const pair=(a:PrismPose,b:PrismPose,c:PrismPose,d:PrismPose,depth:number):void=>{
    checkBudget();
    const bound=motion(a,c)+motion(b,d);
    if(boxGap(a,b)-bound>=-tolerance||boxGap(c,d)-bound>=-tolerance)return;
    const startGap=observePair(a,b),endGap=observePair(c,d);
    if(result.failure||Math.max(startGap,endGap)-bound>=-tolerance-1e-9)return;
    if(depth===12){result.failure=unresolved([a.tile.id,b.tile.id]);return;}
    const m=middle(a,c),n=middle(b,d);
    observePair(m,n);if(result.failure)return;
    pair(a,b,m,n,depth+1);if(!result.failure)pair(m,n,c,d,depth+1);
  };
  const ground=(a:PrismPose,b:PrismPose,depth:number):void=>{
    checkBudget();observeFloor(a);observeFloor(b);if(result.failure)return;
    if(Math.max(a.min.y,b.min.y)-motion(a,b)>=floor-tolerance-1e-9)return;
    if(depth===12){result.failure=unresolved([a.tile.id]);return;}
    const m=middle(a,b);ground(a,m,depth+1);if(!result.failure)ground(m,b,depth+1);
  };
  for(let i=0;i<after.length&&!result.failure;i++){
    ground(before[i],after[i],0);
    for(let j=0;j<i&&!result.failure;j++){
      // Measure endpoint overlap even when the cheaper box certificate proves
      // the full interval is within the allowance.
      observePair(before[i],before[j]);observePair(after[i],after[j]);
      if(!result.failure)pair(before[i],before[j],after[i],after[j],0);
    }
  }
  return result;
}
