/** Exact-BOM full-model hypothesis, kept separate from the published candidate.
 * Four green walls + one blue upright replace five green squares. Their hidden
 * source identities and the canopy's full sequence remain unresolved. */
import { readFile,writeFile } from "node:fs/promises";
import { mediumRamp } from "../../lib/replication/models";
import type { BuildGraph } from "../../lib/magnetic-tiles/types";
import { add,cross,normalize,scale,subtract } from "../../lib/engine/math";
import { EQUILATERAL_HEIGHT as H } from "../../lib/magnetic-tiles/catalog";
import { tileWorldVertices } from "../../lib/magnetic-tiles/magnet-geometry";
import { assemble,outside,square,v } from "../../lib/replication/geometry";
import { geometryCheck,sourceInventoryCheck } from "../../lib/replication/evaluate";
import { releaseCandidate } from "../../lib/replication/release";
import { TILE_THICKNESS } from "../../lib/engine/constants";

async function main(){
  const data=JSON.parse(await readFile("/tmp/magnatiles-compact-support-fit.json","utf8")) as {rows:{name:string;build:BuildGraph}[]};
  const prefix=data.rows.find(r=>r.name==="rear")!.build;
  const original=mediumRamp();
  const turn=original.build.tiles.find(t=>t.id==="turn-floor")!;
  const [a,b,c]=tileWorldVertices(turn),inside=scale(add(add(a,b),c),1/3);
  const upright=outside(square("turn-upright",a,subtract(c,a),v(0,3,0),"#168db3",7,"turn upright hypothesis"),inside);
  const closed=process.argv.includes("--closed-support");
  const seatRoof=closed&&process.argv.includes("--seat-roof");
  const tiles=[...prefix.tiles,...original.build.tiles.filter(t=>t.step>4&&(!closed||!t.id.startsWith("launch-flap-"))).map(t=>t.id==="turn-roof"?
    {...t,position:add(t.position,v(0,3-H,0))}:t),upright];
  if(closed){
    const walls=[-1,1].map(sign=>prefix.tiles.find(t=>t.id===`support-side-${sign}-0`)!);
    const dir=walls[0].basis!.xAxis,side=normalize(cross(dir,v(0,1,0)));
    const bottom=scale(add(tileWorldVertices(walls[0])[0],tileWorldVertices(walls[1])[0]),.5);
    const center=add(bottom,add(scale(dir,1.5),v(0,1.5,0)));
    for(const [name,height] of [["floor",0],["roof",3]] as const)
      tiles.push(outside(square(`support-${name}`,add(bottom,add(v(0,height,0),scale(side,-1.5))),scale(dir,3),scale(side,3),"#32ad66",2,"closed support hypothesis"),center));
    // The outside roof occupies [wall-top, wall-top + thickness]. To seat the
    // wedge's base on its upper face, lower the complete support by one thickness.
    if(seatRoof)for(const tile of tiles.filter(t=>t.id.startsWith("support-")))
      tile.position=add(tile.position,v(0,-TILE_THICKNESS,0));
    // Proposed correspondence follows placement order; color is not evidence of identity.
    for(const tile of tiles){
      const match=/^(lower|upper)-wall-(-?1)-(\d)$/.exec(tile.id);
      if(!match)continue;
      const n=Number(match[3]);
      tile.color=match[1]==="lower"?(n===4?"#f3bc25":n===2?"#eb802b":"#d93747"):
        n>=3?"#d93747":n===2?"#eb802b":"#32ad66";
    }
  }
  const variant=closed?`closed${seatRoof?"-seated":""}`:"open";
  const build=assemble(`compact-medium-${variant}-hypothesis`,"37-piece compact support and blue upright hypothesis",tiles,"ramp");
  const geometry=geometryCheck(build),inventory=sourceInventoryCheck({...original,build}),releases=[];
  if(geometry.status==="pass")for(const seed of [0,17,53]){
    const {settled,...trial}=await releaseCandidate(build,seed);releases.push({...trial,settled});
    console.log(seed,trial.status,trial.peakDisplacement,trial.settledSteps);
  }
  const result={scope:"Unpromoted reconstruction hypothesis. Release is separate from individual assembly, exact source-stage accounting, final source fit and passive car function.",variant,
    basis:["Compact near-rear support is plausible in declared construction views; hidden face count remains a hypothesis.",
      "One upright blue rectangular panel is observed edge-on before a triangular roof; treating it as one square is a catalog hypothesis.",
      "A 3-inch upright raises the blue roof near the vertical rise of an equilateral wall with a half-edge longitudinal roof offset. No panel is stretched.",
      closed?"A closed six-face support replaces the two legacy square flaps. The four late red triangular pieces map provisionally to upper wall triangles; hidden green roof/floor are NOT established by BOM subtraction.":
        "This support/upright-only probe retains legacy red square flaps already contradicted by construction inspection. It is not a full source-consistent topology.",
      seatRoof?"The whole green support is lowered by exactly one catalog thickness so the upper face of its roof meets the wedge base. This is a finite-thickness contact hypothesis, not source-measured placement.":"No roof-face seating correction applied."],
    build,inventory,geometry,releases};
  await writeFile(`/tmp/magnatiles-compact-medium${closed?`-${variant}`:""}.json`,JSON.stringify(result,null,2)+"\n");
  console.log(inventory,geometry);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
