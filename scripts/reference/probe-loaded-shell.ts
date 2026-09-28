/** Independent vertical base-load diagnostic. No source geometry, settings changes
 * or construction/replica acceptance. All catalog shapes and limits unchanged. */
import {writeFile} from 'node:fs/promises';
import {closedShell} from '../../tests/fixtures/closed-shell';
import {assemble,v} from '../../lib/replication/geometry';
import {geometryCheck} from '../../lib/replication/evaluate';
import {releaseCandidate} from '../../lib/replication/release';
import {validationCodeHash} from '../../lib/replication/provenance';
async function main(){
 const rows=[];const flip=(p:{x:number,y:number,z:number})=>v(p.x,-p.y,-p.z);
 for(const levels of [1,2,3,4,6]){
  const build=assemble(`loaded-shell-${levels}`,`Independent ${levels}-level base load`,closedShell(levels).tiles.map(t=>({...t,step:1,position:v(t.position.x,3*levels+.18-t.position.y,-t.position.z),basis:{xAxis:flip(t.basis!.xAxis),yAxis:flip(t.basis!.yAxis),zAxis:flip(t.basis!.zAxis)}})),"tower");
  const geometry=geometryCheck(build),releases=[];
  if(geometry.status==='pass')for(const seed of [0,17,53]){const {settled,...trial}=await releaseCandidate(build,seed);void settled;releases.push(trial);console.log(levels,seed,trial.status,trial.peakGroundPenetration,trial.peakDisplacement,trial.settledSteps);}
  rows.push({levels,build,geometry,releases});
 }
 await writeFile('/tmp/magnatiles-loaded-shell-diagnostic.json',JSON.stringify({scope:'Independent catalog load diagnostic only. No numerical settings changed, no source geometry, no physical material calibration.',validationCodeHash:await validationCodeHash(),rows},null,2)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1});
