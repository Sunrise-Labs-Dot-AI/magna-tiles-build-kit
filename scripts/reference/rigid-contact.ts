import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { contactCellKey, runContactCell, type ContactMatrixTrial } from "./contact-matrix";
import { assessContactProfile } from "./finer-contact-matrix";
import { assertConfiguredContactReport, configuredContactCells, configuredContactContext, type ConfiguredContactReport } from "./configured-contact";

async function main() {
  const output = process.argv.find((arg, i) => i > 1 && !arg.startsWith("--")) ?? "verification/replication/rigid-contact-fixture.json";
  const context = await configuredContactContext(), trials: ContactMatrixTrial[] = [];
  const cells = configuredContactCells(context.configuredProfile);
  assert.equal(cells.length, 72);
  if (process.argv.includes("--resume")) {
    const previous = JSON.parse(await readFile(output, "utf8")) as ConfiguredContactReport;
    for (const [key, value] of Object.entries(context))
      assert.deepEqual(previous[key as keyof ConfiguredContactReport], value, `Cannot resume changed ${key}`);
    assert(Array.isArray(previous.trials) && previous.trials.length <= cells.length &&
      previous.trials.every((row, i) => contactCellKey(row) === contactCellKey(cells[i])), "Checkpoint must be an ordered profile prefix");
    trials.push(...previous.trials);
  }
  let evidence: ConfiguredContactReport;
  const record = async () => {
    const { frequency, collisionHz } = context.configuredProfile;
    const assessment = assessContactProfile(trials, frequency, collisionHz);
    evidence = { ...context, completed: trials.length === cells.length, qualified: assessment.passed, assessment, trials };
    await writeFile(`${output}.tmp`, JSON.stringify(evidence, null, 2)+"\n");
    await rename(`${output}.tmp`, output);
  };
  // Replace stale success evidence before execution; preserve every failed row.
  await record();
  for (const cell of cells.slice(trials.length)) {
    const started = performance.now();
    const trial = await runContactCell(context.fixtureBuilds.find(build => build.id === cell.fixture)!, cell, "finer");
    trials.push(trial);
    await record();
    console.log(`${trials.length}/${cells.length} ${contactCellKey(cell)} ${trial.passed ? "PASS" : "FAIL"} wall=${((performance.now()-started)/1000).toFixed(3)} reason=${trial.firstFailure?.reason ?? "completed"}`);
  }
  // Re-read the current code context to reject edits made during a long run.
  assertConfiguredContactReport(evidence!, await configuredContactContext());
  console.log(`Configured contact profile qualifies across all ${trials.length} trials.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
