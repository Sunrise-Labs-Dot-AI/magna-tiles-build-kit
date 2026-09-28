import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import { tileLocalVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import { add,basisToQuaternion,inverseQuaternion,multiplyQuaternions,scale,subtract } from "@/lib/engine/math";
import { assemble,outside,rigidPanel,square,v } from "@/lib/replication/geometry";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

/** Closed regular triangular prism: two catalog equilateral ends and three
 * catalog square sides. All nine seams form loops, with no source coordinates. */
export function triangularShell(): BuildGraph {
  const local=tileLocalVertices("equilateral-triangle"),inside=v(0,2,0);
  const points=local.map(p=>add(p,v(0,2,0)));
  const tiles=[-1,1].map(sign=>outside(rigidPanel(`end-${sign}`,"equilateral-triangle",points.map(p=>({...p,z:sign*1.5})),"green",1,"fixture"),inside));
  for(let i=0;i<3;i++)tiles.push(outside(square(`side-${i}`,{...points[i],z:-1.5},subtract(points[(i+1)%3],points[i]),v(0,0,3),"red",1,"fixture"),inside));
  const floor=Math.min(...tiles.flatMap(t=>tilePrismVertices(t).map(p=>p.y)));
  return assemble("triangular-shell","Independent triangular shell",tiles.map(t=>({...t,position:add(t.position,v(0,-floor,0))})),"tower");
}

/** Equivalent actual solids, using independent immutable reference frames.
 * The assembled graph is only attached after the true poses are established. */
export async function closedLoopWorld(build:BuildGraph,mixedFrames:boolean,create= createEngineWorld){
  if(!mixedFrames)return create(build,{drop:false,floorY:0});
  const references=build.tiles.map((t,i)=>({...t,basis:basisFromEuler(.31+i*.17,-.73+i*.11,1.13-i*.07),position:add(t.position,v(i*12,20,0))}));
  const staging=await create({...build,tiles:references,connections:[]},{drop:false,floorY:0});
  try{
    for(const [i,t]of build.tiles.entries()){
      const r=staging.bodies.get(t.id)!;
      r.body.setTranslation(t.position,true);
      r.body.setRotation(multiplyQuaternions(basisToQuaternion(t.basis!),inverseQuaternion(basisToQuaternion(references[i].basis))),true);
      r.body.setLinvel(scale(t.position,0),true);r.body.setAngvel(v(0,0,0),true);
    }
    return create(build,{drop:false,floorY:0,state:staging.snapshot()});
  }finally{staging.dispose();}
}
