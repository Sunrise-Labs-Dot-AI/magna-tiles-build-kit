import { MAX_COLLISION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld, currentTilePose } from "@/lib/engine/rapier-world";
import { gravityVector } from "@/lib/engine/physics-model";
import { basisToQuaternion, cross, distance, dot, inverseQuaternion, magnitude, multiplyQuaternions, quaternionToBasis, subtract, transformLocal } from "@/lib/engine/math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileLocalVertices, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tileNormal, tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { assemble, rigidPanel, square, v } from "@/lib/replication/geometry";

export const triangleShapes = ["right-triangle","equilateral-triangle","isosceles-triangle"] as const;
export const referenceFrames = ["baked","identity","oblique"] as const;
type TriangleShape = typeof triangleShapes[number];
type ReferenceFrame = typeof referenceFrames[number];

/** Complete signed SAT for convex prisms, independent of the production overlap
 * allowance and axis deduplication. A negative result means separation. */
export function exactPrismDepth(a: TileInstance,b: TileInstance): number {
  const edges=(t:TileInstance)=>[tileNormal(t),...tileWorldVertices(t).map((p,i,ps)=>subtract(ps[(i+1)%ps.length],p))];
  const ea=edges(a),eb=edges(b),na=tileNormal(a),nb=tileNormal(b);
  const axes=[na,nb,...ea.map(e=>cross(e,na)),...eb.map(e=>cross(e,nb)),...ea.flatMap(x=>eb.map(y=>cross(x,y)))];
  const av=tilePrismVertices(a),bv=tilePrismVertices(b);
  return Math.min(...axes.filter(a=>Math.hypot(a.x,a.y,a.z)>0).map(a=>{
    const length=Math.hypot(a.x,a.y,a.z),n={x:a.x/length,y:a.y/length,z:a.z/length},ap=av.map(p=>dot(p,n)),bp=bv.map(p=>dot(p,n));
    return Math.min(Math.max(...ap)-Math.min(...bp),Math.max(...bp)-Math.min(...ap));
  }));
}

/** Catalog base edge against the finite edge of a square. No source coordinates,
 * labels, dimensions or fitted views enter this fixture. */
export function triangleHinge(shape:TriangleShape,yaw=0) {
  const local=tileLocalVertices(shape);
  const tiles=[square("roof",v(0,8,0),v(3,0,0),v(0,0,3),"red",1,"fixture"),
    rigidPanel("side",shape,local.map(p=>v(1.5-p.x,8-(p.y-local[0].y),-.09)),"green",1,"fixture")];
  const basis=basisFromEuler(0,yaw,0);
  return assemble("triangle-contact","Independent triangle hinge",tiles.map(t=>({
    ...t,position:transformLocal(t.position,v(0,0,0),basis),basis:{
      xAxis:transformLocal(t.basis!.xAxis,v(0,0,0),basis),
      yAxis:transformLocal(t.basis!.yAxis,v(0,0,0),basis),
      zAxis:transformLocal(t.basis!.zAxis,v(0,0,0),basis),
    },
  })),"tower");
}

export async function frameContactWorld(shape:TriangleShape,frame:ReferenceFrame,yaw=0) {
  const build=triangleHinge(shape,yaw);
  if(frame==="baked")return {build,engine:await createEngineWorld(build,{drop:false,floorY:0})};
  const refs=build.tiles.map((t,i)=>({...t,basis:frame==="identity"?basisFromEuler():basisFromEuler(.3+i*.2,-.7,1.1-i*.4)}));
  const initial=await createEngineWorld({...build,tiles:refs,connections:[]},{drop:false,floorY:0});
  try {
    for(const [id,r]of initial.bodies) {
      const target=build.tiles.find(t=>t.id===id)!;
      r.body.setRotation(multiplyQuaternions(basisToQuaternion(target.basis!),inverseQuaternion(basisToQuaternion(r.tile.basis!))),true);
    }
    return {build,engine:await createEngineWorld(build,{drop:false,floorY:0,state:initial.snapshot()})};
  } finally {initial.dispose();}
}

export interface FrameContactTrial {
  shape:TriangleShape; frame:ReferenceFrame; yaw:number; seed:number; hz:number;
  collider:"solid-polyhedron";
  contacts:number; initialVertexError:number; peakDepthExcess:number; peakMotionExcess:number;
  solverContacts:number; peakSolverDepthExcess:number;
  peakAnchorError:number; poppedJoints:string[]; passed:boolean;
}

/** All allowances are fixed before each collision step. The solver's resulting
 * movement can only fail the motion check; it can never increase its allowance. */
export async function runFrameContact(shape:TriangleShape,frame:ReferenceFrame,yaw:number,seed:number,hz=1/MAX_COLLISION_TIMESTEP_SECONDS):Promise<FrameContactTrial> {
  const {build,engine:e}=await frameContactWorld(shape,frame,yaw);
  try {
    const records=[...e.bodies.values()];
    for(const r of records){r.body.setLinvel(v(0,0,0),true);r.body.setAngvel(v(0,0,0),true);}
    e.bodies.get("roof")!.body.setBodyType(RigidBodyType.Fixed,true);
    e.bodies.get("side")!.body.setAngvel(v(seed*.0003,seed*.0001,0),true);
    e.world.integrationParameters.dt=1/hz;
    const poses=()=>records.map(r=>currentTilePose(r.tile,r.body.translation(),r.body.rotation(),0));
    const initialVertexError=Math.max(...poses().flatMap((t,i)=>tilePrismVertices(t).map((p,j)=>distance(p,tilePrismVertices(build.tiles[i])[j]))));
    let contacts=0,solverContacts=0,peakSolverDepthExcess=0,peakDepthExcess=0,peakMotionExcess=0,peakAnchorError=0;
    for(const j of e.joints) {
      const a=e.bodies.get(j.model.fromTileId)!.body,b=e.bodies.get(j.model.toTileId)!.body;
      const world=(p:Vec3,body:typeof a)=>transformLocal(p,body.translation(),quaternionToBasis(body.rotation()));
      peakAnchorError=Math.max(peakAnchorError,distance(world(j.model.fromLocalAnchor,a),world(j.model.toLocalAnchor,b)));
      if(j.model.secondAnchors)peakAnchorError=Math.max(peakAnchorError,distance(world(j.model.secondAnchors.from,a),world(j.model.secondAnchors.to,b)));
    }
    for(let n=0;n<hz/15;n++) {
      const before=poses(),depth=Math.max(0,exactPrismDepth(before[0],before[1]));
      const bounds=records.map((r,i)=>{
        if(r.body.isFixed())return 0;
        const radius=Math.max(...tilePrismVertices(before[i]).map(p=>distance(p,r.body.worldCom())));
        return Math.min(.005,(magnitude(r.body.linvel())+radius*magnitude(r.body.angvel()))/hz+magnitude(gravityVector())/(2*hz*hz)+.0005);
      });
      e.step();
      const after=poses();
      for(let i=0;i<records.length;i++) {
        const motion=Math.max(...tilePrismVertices(before[i]).map((p,j)=>distance(p,tilePrismVertices(after[i])[j])));
        peakMotionExcess=Math.max(peakMotionExcess,motion-bounds[i]);
      }
      e.world.contactPair(records[0].body.collider(0),records[1].body.collider(0),m=>{
        contacts+=m.numContacts();
        for(let i=0;i<m.numContacts();i++)peakDepthExcess=Math.max(peakDepthExcess,-m.contactDist(i)-depth-bounds[0]-bounds[1]);
        solverContacts+=m.numSolverContacts();
        for(let i=0;i<m.numSolverContacts();i++)peakSolverDepthExcess=Math.max(peakSolverDepthExcess,-m.solverContactDist(i)-depth-bounds[0]-bounds[1]);
      });
    }
    return {shape,frame,yaw,seed,hz,collider:"solid-polyhedron",contacts,solverContacts,peakSolverDepthExcess,initialVertexError,peakDepthExcess,peakMotionExcess,peakAnchorError,poppedJoints:e.poppedJoints,
      passed:contacts>0&&solverContacts>0&&initialVertexError<4e-6&&peakAnchorError<4e-6&&peakDepthExcess<=.005&&peakSolverDepthExcess<=.005&&peakMotionExcess<=1e-6&&!e.poppedJoints.length&&!e.solidFailures.length&&!e.invalidState};
  }finally{e.dispose();}
}
