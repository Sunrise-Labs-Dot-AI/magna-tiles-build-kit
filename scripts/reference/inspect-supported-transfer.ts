/** Static diagnosis of a recorded attempt. No new motion or acceptance credit. */
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {stageBuild} from "../../lib/replication/geometry";
import {transferTarget} from "../../lib/replication/prepared-transfer";
import {tileQuaternion} from "../../lib/replication/rotation-clearance";
import {distance,quaternionAngle} from "../../lib/engine/math";
import type {Replica} from "../../lib/replication/types";
import type {AssemblyResult} from "../../lib/replication/assembly";
async function main(){
  const raw=await readFile("/tmp/magnatiles-compact-supported-transfer.json","utf8");
  const data=JSON.parse(raw) as {replica:Replica;result:AssemblyResult[]};
  const stage=data.replica.stages.find(s=>s.id==="medium-upper-transfer")!,nominal=stageBuild(data.replica,stage);
  const result=data.result.find(s=>s.stageId===stage.id)!;
  const rows=result.rejectedAttempts[0].operations.map(operation=>{
    const actual={...nominal,tiles:operation.trials[0].motion.at(-1)!.tiles};
    const deviations=(ids:string[],heldId:string)=>{
      const target=transferTarget(nominal,actual,ids,heldId);
      return target.tiles.filter(t=>ids.includes(t.id)).map(tile=>{
        const reference=nominal.tiles.find(t=>t.id===tile.id)!,world=actual.tiles.find(t=>t.id===tile.id)!;
        return {tileId:tile.id,centerDifference:distance(tile.position,reference.position),
          orientationDifferenceDegrees:quaternionAngle(tileQuaternion(tile),tileQuaternion(reference))*180/Math.PI,
          worldOrientationDifferenceDegrees:quaternionAngle(tileQuaternion(world),tileQuaternion(reference))*180/Math.PI};
      });
    };
    return {seed:operation.seed,docking:operation.docking!.status,
      movingRelativeToHeldDeck:deviations(operation.tileIds,"upper-deck-2"),
      receivingRelativeToHeldBack:deviations(actual.tiles.filter(t=>t.id.startsWith("support-")).map(t=>t.id),"support-back")};
  });
  await writeFile("/tmp/magnatiles-compact-transfer-deformation.json",JSON.stringify({
    scope:"Static diagnosis only. Align each held panel to its nominal pose and retain actual internal deformations; no new physical motion or acceptance. The observed difference is not a demonstrated causal fix.",
    rawSha256:createHash("sha256").update(raw).digest("hex"),rows,
  },null,2)+"\n");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
