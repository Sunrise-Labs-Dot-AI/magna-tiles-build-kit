/** Concrete source-accounting proposal, isolated from canonical reports. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { smallRamp } from "../../lib/replication/models";
import { verifyLocalSource } from "../../lib/replication/evaluate";
import { artifactHashes,validationCodeHash } from "../../lib/replication/provenance";
import { checkSourcePieces,sourcePieceSummary,type SourcePieceRecord } from "./observed-piece-sets.prototype";
import ledger from "../../verification/replication/source-pieces.json";
import sources from "../../verification/replication/sources.json";
import frames from "../../verification/replication/frame-manifest.json";

const output="/tmp/magnatiles-observed-piece-sets-proposal.json";
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
async function main(){
  const paths=["scripts/reference/probe-observed-piece-sets.ts","scripts/reference/observed-piece-sets.prototype.ts",
    "runs/diagnostics/2026-09-27-small-source-set-proposal.json","verification/replication/source-pieces.json",
    "verification/replication/sources.json","verification/replication/frame-manifest.json","verification/replication/observation-lock.json"];
  const context={validationCodeHash:await validationCodeHash(),inputHashes:await artifactHashes(paths)};
  assert.equal(context.validationCodeHash,"3a2ed4ddf041cbf7615825b5e75dd6b3132f520d65c19ff662896a1285b5381d");
  const before=smallRamp(),candidate=structuredClone(before);
  candidate.stages.find(s=>s.id==="small-launch")!.frameId="small-construction-seat-32.5";
  assert.deepEqual(candidate.build,before.build);assert.deepEqual(candidate.construction,before.construction);
  const proposal=JSON.parse(await readFile("runs/diagnostics/2026-09-27-small-source-set-proposal.json","utf8")) as {records:SourcePieceRecord[]};
  const records=proposal.records.map(record=>{
    assert.equal(record.proposed.length,2);assert.equal(new Set(record.proposed.map(p=>p.shape)).size,1);
    const {proposed,...rest}=record;
    return {...rest,coverage:"complete" as const,proposed:[],observedSets:[{
      sourceSetId:`${record.stageId}-observed-side-pair`,shape:proposed[0].shape,count:2,tileIds:proposed.map(p=>p.tileId),
    }],basis:record.basis+" The two identical side panels form a complete observed set; their individual serial identities are unresolved.",
    review:record.review+" Represented as an interchangeable set under the independently reviewed 2026-09-28 plan; no exact member mapping asserted."};
  });
  const proposedLedger={schema:2,records:[...ledger.records.map(r=>({...r,observedSets:[]})),...records]};
  const source=await verifyLocalSource(candidate);
  assert.equal(source.status,"pass");
  const results=checkSourcePieces(candidate,proposedLedger,sources.sources.find(s=>s.id==="henry"),frames.frames,source);
  assert.deepEqual(results.map(r=>[r.stageId,r.status]),[["small-wedge","pass"],["small-launch","pass"],["small-final","unverified"]]);
  const sourceSummary=sourcePieceSummary(results);assert.equal(sourceSummary.status,"unverified");
  const finalContext={validationCodeHash:await validationCodeHash(),inputHashes:await artifactHashes(paths)};assert.deepEqual(finalContext,context);
  await writeFile(output,JSON.stringify({scope:"OFF-PATH PROPOSAL ONLY. No canonical source record, model, observation lock or acceptance changed. Installed counts do not establish poses, joins, independent image fidelity, assembly or function.",context,source,
    changes:{stageFrame:{stageId:"small-launch",before:before.stages.find(s=>s.id==="small-launch")!.frameId,after:candidate.stages.find(s=>s.id==="small-launch")!.frameId},
      buildSha256Before:sha(JSON.stringify(before.build)),buildSha256After:sha(JSON.stringify(candidate.build)),constructionIdentical:true},
    proposedLedger,results,sourceSummary,finalContext},null,2)+"\n");
  console.log(JSON.stringify({output,source,stages:results.map(r=>({stage:r.stageId,status:r.status,exact:r.observedTileIds.length,sets:r.observedSets})),aggregate:sourceSummary.status}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
