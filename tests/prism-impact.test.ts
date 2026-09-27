import { describe,expect,it } from "vitest";
import { ColliderDesc,RigidBodyDesc,RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { assemble,square,v } from "@/lib/replication/geometry";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import type { TileShape } from "@/lib/magnetic-tiles/types";

const panel=(id:string,shape:TileShape,z:number)=>({...square(id,v(-1.5,6.5,z),v(3,0,0),v(0,3,0),"red",1,"fixture"),shape});

describe("solid prism physical contacts",()=>{
  it.each([1,-1])("resolves face impacts from direction %i with square and triangle bodies",async direction=>{
    for(const shapes of [["right-triangle","small-square"],["small-square","right-triangle"],["right-triangle","equilateral-triangle"]] as const)for(const speed of [1,20]){
      const build=assemble("impact","Impact",[panel("fixed",shapes[0],0),panel("moving",shapes[1],direction*.25)],"tower");
      const e=await createEngineWorld(build,{drop:false,floorY:0});
      try{
        e.world.gravity=v(0,0,0);e.world.integrationParameters.dt=1/960;
        const fixed=e.bodies.get("fixed")!.body,moving=e.bodies.get("moving")!.body;
        fixed.setBodyType(RigidBodyType.Fixed,true);moving.setLinvel(v(0,0,-direction*speed),true);moving.setAngvel(v(0,0,0),true);
        let contacts=0;
        for(let n=0;n<120;n++){
          e.step();
          e.world.contactPair(fixed.collider(0),moving.collider(0),m=>{contacts+=m.numSolverContacts();});
        }
        expect(e.solidFailures,JSON.stringify({shapes,speed,direction,failures:e.solidFailures})).toEqual([]);
        expect(contacts).toBeGreaterThan(0);
        expect(direction*moving.translation().z).toBeGreaterThan(.12);
        expect(e.peakSolidOverlap).toBeLessThanOrEqual(.03);
      }finally{e.dispose();}
    }
  });
  it.each([0,-20])("supports a triangle drop with starting vertical speed %i",async speed=>{
    const basis=basisFromEuler(Math.PI/2,0,0),base={...panel("base","right-triangle",0),position:v(0,5,0),basis};
    const moving={...base,id:"moving",position:v(0,5.8,0)};
    const e=await createEngineWorld(assemble("drop","Drop",[base,moving],"tower"),{drop:false,floorY:0});
    try{
      e.bodies.get("base")!.body.setBodyType(RigidBodyType.Fixed,true);
      const body=e.bodies.get("moving")!.body;body.setLinvel(v(0,speed,0),true);body.setAngvel(v(0,0,0),true);
      e.world.integrationParameters.dt=1/960;
      for(let n=0;n<480;n++)e.step();
      expect(e.solidFailures).toEqual([]);expect(body.translation().y).toBeGreaterThan(5.15);
      expect(e.peakSolidOverlap).toBeLessThanOrEqual(.03);
    }finally{e.dispose();}
  });
  it("lets a passive ball traverse a triangle's narrow edge like a matching cuboid",async()=>{
    // Both rails expose the same three-inch by 0.18-inch top rectangle. Match
    // the primitive's frictional trajectory instead of assuming constant speed.
    const traverse=async(shape:"right-triangle"|"small-square")=>{
    const tile={...panel("rail",shape,0),basis:basisFromEuler(0,0,Math.PI),position:v(0,5,0)};
    const e=await createEngineWorld(assemble("diagonal","Diagonal",[tile],"tower"),{drop:false,floorY:0});
    try{
      const rail=e.bodies.get("rail")!.body;rail.setBodyType(RigidBodyType.Fixed,true);
      const ball=e.world.createRigidBody(RigidBodyDesc.dynamic().setTranslation(-1,6.54,0).setLinvel(2,0,0).setCcdEnabled(true));
      e.world.createCollider(ColliderDesc.ball(.04).setMass(.001).setFriction(0).setRestitution(0),ball);
      e.world.integrationParameters.dt=1/960;
      let contacts=0,minY=Infinity;
      const positions:{x:number;y:number;z:number}[]=[];
      for(let n=0;n<960;n++){
        e.step();minY=Math.min(minY,ball.translation().y);
        if(n%8===0)positions.push({...ball.translation()});
        e.world.contactPair(rail.collider(0),ball.collider(0),m=>{contacts+=m.numSolverContacts();});
      }
      expect(contacts).toBeGreaterThan(500);expect(ball.translation().x).toBeGreaterThan(.2);
      expect(minY).toBeGreaterThan(6.50);expect(e.solidFailures).toEqual([]);
      return positions;
    }finally{e.dispose();}
    };
    const triangle=await traverse("right-triangle"),cuboid=await traverse("small-square");
    triangle.forEach((p,i)=>expect(Math.hypot(p.x-cuboid[i].x,p.y-cuboid[i].y,p.z-cuboid[i].z)).toBeLessThan(.0005));
  });
});
