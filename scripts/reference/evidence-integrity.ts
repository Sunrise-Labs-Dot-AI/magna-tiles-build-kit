import { readFile, writeFile } from "node:fs/promises";
import { smallRamp } from "../../lib/replication/models";
import { evaluateReplica, verifyLocalSource } from "../../lib/replication/evaluate";
import data from "../../verification/replication/observations.json";
import type { Observation } from "../../lib/replication/types";

async function main() {
  const replica = smallRamp(), path = "public/reference-frames/replication/henry/small-reserved-36.25.png";
  const original = await readFile(path), baseline = await verifyLocalSource(replica);
  if (baseline.status !== "pass") throw new Error(baseline.detail);
  let corrupt;
  try {
    // Only the disposable extracted PNG, never the original video, is modified.
    await writeFile(path, Buffer.concat([original, Buffer.from("corrupt-frame-test")]));
    corrupt = await verifyLocalSource(replica);
    if (corrupt.status !== "fail") throw new Error("Altered reserved PNG was accepted");
  } finally { await writeFile(path, original); }
  const constructionPath = "public/reference-frames/replication/henry/small-construction-seat-28.75.png";
  const constructionBytes = await readFile(constructionPath);
  let corruptConstruction;
  try {
    await writeFile(constructionPath, Buffer.concat([constructionBytes, Buffer.from("corrupt-construction-test")]));
    corruptConstruction = await verifyLocalSource(replica);
    if (corruptConstruction.status !== "fail" || !corruptConstruction.detail.includes("small-construction-seat-28.75")) throw new Error("Altered construction evidence was accepted");
  } finally { await writeFile(constructionPath, constructionBytes); }
  const report = await evaluateReplica(replica, data.observations as Observation[]);
  if (report.holdoutCoverage.status !== "fail" || report.checks.fidelity.status !== "fail") throw new Error("Historical/duplicate view history was credited");
  replica.build.tiles[0].position.x += 0.001;
  const changed = await evaluateReplica(replica, data.observations as Observation[]);
  if (changed.holdoutCoverage.status !== "fail" || !changed.holdoutCoverage.detail.includes("changed after freeze")) throw new Error("Post-freeze candidate edit was credited");
  await writeFile("verification/replication/evidence-integrity.json", JSON.stringify({ generatedAt: new Date().toISOString(),
    baseline, alteredReservedFrame: corrupt, alteredConstructionFrame: corruptConstruction, restoredSource: report.checks.source,
    historicalOrDuplicateViews: report.holdoutCoverage, changedCandidate: changed.holdoutCoverage,
    scope: "Executed through the actual source and replica evaluators with local source media; disposable PNG restored byte-for-byte." }, null, 2) + "\n");
  console.log("Verified reserved/construction PNG corruption, restoration, historical-view rejection and post-freeze candidate rejection.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
