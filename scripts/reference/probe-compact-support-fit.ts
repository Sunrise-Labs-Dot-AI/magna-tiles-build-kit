/** Fitting-only exploration. The copied observation changes two corner identities
 * under independent visual review; source pixels/uncertainties stay locked. */
import { writeFile } from "node:fs/promises";
import { ISOSCELES_EQUAL_SIDE as L } from "../../lib/magnetic-tiles/catalog";
import { mediumRamp } from "../../lib/replication/models";
import { add, cross, normalize, scale } from "../../lib/engine/math";
import { tileWorldVertices } from "../../lib/magnetic-tiles/magnet-geometry";
import { assemble, outside, square, v } from "../../lib/replication/geometry";
import { geometryCheck } from "../../lib/replication/evaluate";
import { compareObservation, projectPoint } from "../../lib/replication/projection";
import type { Observation } from "../../lib/replication/types";
import observations from "../../verification/replication/observations.json";

async function main() {
  const original = mediumRamp();
  const observation = structuredClone(observations.observations.find(o=>o.id==="medium-stage-63")) as Observation;
  const before = structuredClone(observation);
  observation.landmarks.find(l=>l.id==="medium-stage-63-camera-5")!.vertex=0;
  observation.landmarks.find(l=>l.id==="medium-stage-63-camera-6")!.tileId="support-side-1-0";
  const dir=original.build.tiles.find(t=>t.id==="support-side-1-0")!.basis!.xAxis;
  const side=normalize(cross(dir,v(0,1,0)));
  const origins=[-1,1].map(sign=>tileWorldVertices(original.build.tiles.find(t=>t.id===`upper-side-${sign}`)!)[2]);
  const origin=scale(add(origins[0],origins[1]),.5);
  const p=(x:number,y:number,z:number)=>add(origin,add(add(scale(dir,x),v(0,y,0)),scale(side,z)));
  const rows=[];
  for(const [name,start] of [["front",0],["center",(L-3)/2],["rear",L-3]] as const) {
    const interior=p(start+1.5,-1.5,0);
    const support=[-1,1].map(sign=>outside(square(`support-side-${sign}-0`,p(start,-3,sign*1.5),scale(dir,3),v(0,3,0),"#32ad66",2,"support hypothesis"),interior));
    for(const [id,x] of [["front",start],["back",start+3]] as const)
      support.push(outside(square(`support-${id}`,p(x,-3,-1.5),scale(side,3),v(0,3,0),"#32ad66",2,"support hypothesis"),interior));
    const tiles=[...original.build.tiles.filter(t=>t.step<=4&&!t.id.startsWith("support-")),...support];
    const build=assemble(`compact-medium-${name}`,`Compact support ${name} fitting hypothesis`,tiles,"ramp");
    const projection=compareObservation(build,observation);
    rows.push({name,start,build,geometry:geometryCheck(build),projection});
    if(projection.camera){
      const camera=projection.camera;
      const polygons=build.tiles.map(t=>`<polygon points="${tileWorldVertices(t).map(p=>projectPoint(p,camera).join(",")).join(" ")}" fill="${t.color}" fill-opacity=".25" stroke="${t.color}" stroke-width="2"/>`).join("");
      await writeFile(`/tmp/magnatiles-compact-${name}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${polygons}</svg>`);
    }
    console.log(name,start,projection.rmsPx,projection.maxPx,projection.cameraRegion,rows.at(-1)!.geometry);
  }
  await writeFile("/tmp/magnatiles-compact-support-fit.json",JSON.stringify({scope:"Historical construction/fitting only; no full piece-set, source acceptance or physical credit.",
    identityReview:"runs/reviews/compact-support-corner-review.txt",before,observation,rows},null,2)+"\n");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
