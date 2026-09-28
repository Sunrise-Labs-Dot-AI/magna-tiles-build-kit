/** Isolate the closed-support release failure by adding bounded source-candidate
 * loads. These are release diagnostics, never constructed-stage certificates. */
import { readFile,writeFile } from "node:fs/promises";
import type { BuildGraph } from "../../lib/magnetic-tiles/types";
import { assemble } from "../../lib/replication/geometry";
import { geometryCheck } from "../../lib/replication/evaluate";
import { releaseCandidate } from "../../lib/replication/release";

async function main(){
  const {build}=JSON.parse(await readFile("/tmp/magnatiles-compact-medium-closed.json","utf8")) as {build:BuildGraph};
  const rows=[];
  for(const step of [4,7]){
    const prefix=assemble(`closed-support-load-${step}`,`Closed support load through proposed step ${step}`,build.tiles.filter(t=>t.step<=step),"ramp");
    const geometry=geometryCheck(prefix),releases=[];
    if(geometry.status==="pass")for(const seed of [0,17,53]){
      const {settled,...trial}=await releaseCandidate(prefix,seed);void settled;
      releases.push(trial);console.log(step,prefix.tiles.length,seed,trial.status,trial.peakGroundPenetration,trial.settledSteps);
    }
    rows.push({step,build:prefix,geometry,releases});
  }
  await writeFile("/tmp/magnatiles-closed-support-load.json",JSON.stringify({scope:"Unpromoted load-isolation diagnostic using candidate subsets, not an independent contact-calibration fixture or source-stage proof.",rows},null,2)+"\n");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
