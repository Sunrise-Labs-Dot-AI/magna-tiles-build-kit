/** Run after probe-compact-support-fit.ts. Fresh preparation and all three seeds;
 * no old assembly state is copied into the changed support geometry. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { countInventory } from "../../lib/magnetic-tiles/validation";
import type { BuildGraph } from "../../lib/magnetic-tiles/types";
import { mediumRamp } from "../../lib/replication/models";
import { evaluateAssembly } from "../../lib/replication/assembly";
import { edgeGrips } from "../../lib/replication/grip";
import { transformLocal } from "../../lib/engine/math";

async function main() {
  const input=await readFile("/tmp/magnatiles-compact-support-fit.json","utf8");
  const data=JSON.parse(input) as { rows:{name:string;build:BuildGraph}[] };
  const build=data.rows.find(r=>r.name==="rear")!.build;
  const replica=mediumRamp();
  replica.id="compact-medium-prefix-probe";
  replica.title="Thirteen-panel compact support construction hypothesis";
  replica.build=build;replica.inventory=countInventory(build.tiles);delete replica.route;
  replica.uncertainties=[];
  const supportIds=build.tiles.filter(t=>t.id.startsWith("support-")).map(t=>t.id);
  replica.stages=replica.stages.slice(0,6).map(stage=>({...stage,
    title:`Diagnostic compact candidate: ${stage.id}`,
    instruction:"Proposed physical preparation. This probe does not establish the source's hidden parts or exact motion.",
    tileIds:stage.id==="medium-support"?supportIds:stage.tileIds.some(id=>id.startsWith("support-"))?
      [...stage.tileIds.filter(id=>!id.startsWith("support-")),...supportIds]:stage.tileIds,
  }));
  const order=["support-back","support-side--1-0","support-side-1-0","support-front"];
  const grip=(id:string)=>{
    const tile=build.tiles.find(t=>t.id===id)!;
    return edgeGrips(tile).sort((a,b)=>transformLocal(b.localPoint,tile.position,tile.basis!).y-transformLocal(a.localPoint,tile.position,tile.basis!).y)[0];
  };
  replica.construction![2].operations=order.map((id,i)=>({tileIds:[id],
    hands:i===0||i===3?[grip(id)]:[grip(id),grip("support-back")],releaseAfter:i>=2}));
  const variant=process.argv.includes("--front-grip")?"front-grip":process.argv.includes("--side-grip")?"side-grip":"rear-grip";
  if(variant==="front-grip") replica.construction![3].operations[0].hands=[edgeGrips(build.tiles.find(t=>t.id==="upper-deck-1")!)[3]];
  if(variant==="side-grip") replica.construction![3].operations[0].hands=[edgeGrips(build.tiles.find(t=>t.id==="upper-side--1")!)[0]];
  replica.construction!.at(-1)!.operations[0].bridgeInsertion!.connections=build.connections.filter(c=>c.fromTileId==="turn-floor"||c.toTileId==="turn-floor");
  const started=Date.now();
  const result=await evaluateAssembly(replica);
  await writeFile(`/tmp/magnatiles-compact-support-assembly${variant!=="rear-grip"?`-${variant}`:""}.json`,JSON.stringify({
    scope:"Changed thirteen-panel prefix only. No complete 37-panel model, source-count, source-motion or independent-source credit.",
    variant,inputSha256:createHash("sha256").update(input).digest("hex"),elapsedMs:Date.now()-started,replica,result,
  },null,2)+"\n");
  console.log(result.map(s=>({id:s.stageId,status:s.status,detail:s.detail,operations:s.operations.length,
    checkpoints:s.checkpoints.length,terminalConnections:s.terminalConnections}))); 
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
