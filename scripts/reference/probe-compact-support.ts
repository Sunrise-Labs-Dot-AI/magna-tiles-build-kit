/** Construction hypothesis only. This does not replace the source candidate,
 * establish a hidden panel count, or inherit the old medium assembly results. */
import { writeFile } from "node:fs/promises";
import { ISOSCELES_EQUAL_SIDE as L } from "../../lib/magnetic-tiles/catalog";
import { rampPrism } from "../../lib/replication/models";
import { assemble, outside, square, v } from "../../lib/replication/geometry";
import { geometryCheck } from "../../lib/replication/evaluate";
import { releaseCandidate } from "../../lib/replication/release";

async function main() {
const rows = [];
const closed=process.argv.includes("--closed");
const yaw60=process.argv.includes("--yaw60");
for (const [name, start] of [["front",0],["center",(L-3)/2],["rear",L-3]] as const) {
  const interior = v(start+1.5,-1.5,0);
  const support = [-1,1].map(sign => outside(square(`support-side-${sign}`,v(start,-3,sign*1.5),
    v(3,0,0),v(0,3,0),"#32ad66",1,"support hypothesis"),interior));
  for (const [id,x] of [["front",start],["back",start+3]] as const)
    support.push(outside(square(`support-${id}`,v(x,-3,-1.5),v(0,0,3),v(0,3,0),"#32ad66",1,"support hypothesis"),interior));
  if(closed)for(const [id,y] of [["floor",-3],["roof",0]] as const)
    support.push(outside(square(`support-${id}`,v(start,y,-1.5),v(3,0,0),v(0,0,3),"#32ad66",1,"closed support hypothesis"),interior));
  const wedge = rampPrism("upper",v(0,0,0),v(1,0,0),2).filter(t=>!t.id.endsWith("-back"));
  const tiles=[...support,...wedge];
  if(yaw60){
    const rotate=(p:{x:number;y:number;z:number})=>v(p.x*.5-p.z*Math.sqrt(3)/2,p.y,p.x*Math.sqrt(3)/2+p.z*.5);
    for(const tile of tiles){
      tile.position=rotate(tile.position);
      tile.basis={xAxis:rotate(tile.basis!.xAxis),yAxis:rotate(tile.basis!.yAxis),zAxis:rotate(tile.basis!.zAxis)};
    }
  }
  const build = assemble(`compact-support-${name}`,`${closed?"Six-face":"Four-wall"} support at ${name} of wedge (hypothesis)`,tiles,"ramp");
  const geometry = geometryCheck(build), releases = [];
  if (geometry.status === "pass") for (const seed of [0,17,53]) {
    const {settled,...trial} = await releaseCandidate(build,seed);
    releases.push({...trial,settledPositions:settled.tiles.map(t=>({id:t.id,position:t.position,basis:t.basis}))});
    console.log(name,seed,trial.status,trial.peakDisplacement,trial.settledSteps);
  }
  rows.push({name,start,build,geometry,releases});
  console.log(name,geometry);
}
await writeFile(`/tmp/magnatiles-compact-support-release${closed?"-closed":""}${yaw60?"-yaw60":""}.json`,JSON.stringify({
  scope:`Bounded ${closed?"six-face closed":"four-wall open-bottom"} support hypotheses. No source-count, full-model, assembly or final-source credit.`,
  sourceInspection:"runs/diagnostics/2026-09-27-support-blue-inspection.json",
  yawDegrees:yaw60?60:0,
  choiceBasis:"Front, centered and rear placement beneath the unchanged catalog wedge; no tolerance, tile dimensions or force edits.",
  rows,
},null,2)+"\n");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
