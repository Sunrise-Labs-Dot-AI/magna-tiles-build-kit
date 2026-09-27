import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { CONTACT_NATURAL_FREQUENCY_HZ } from "../../lib/engine/constants";
import { validationCodeHash, artifactHashes } from "../../lib/replication/provenance";
import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { CONTACT_MATRIX, assessContactMatrix, assertContactFixture, contactCellKey, contactMatrixCells, runContactCell, type ContactMatrixTrial } from "./contact-matrix";

async function main() {
  const output = process.argv[2] ?? "/tmp/magnatiles-loaded-contact-matrix.json";
  const fixtureBuilds = contactMatrixFixtures();
  fixtureBuilds.forEach(assertContactFixture);
  const context = {
    scope: "Independent catalog contact numerics only; not material calibration, source fidelity or constructed-stage acceptance. 480 Hz is diagnostic only.",
    validationCodeHash: await validationCodeHash(), configuredFrequency: CONTACT_NATURAL_FREQUENCY_HZ,
    inputHash: createHash("sha256").update(JSON.stringify(fixtureBuilds)).digest("hex"),
    scriptHashes: await artifactHashes(["scripts/reference/contact-matrix.ts", "scripts/reference/probe-contact-matrix.ts", "tests/fixtures/loaded-contact.ts", "runs/2026-09-27-loaded-contact-plan.md"]),
    criteria: CONTACT_MATRIX, fixtureBuilds,
  };
  const trials: ContactMatrixTrial[] = [];
  const cells = contactMatrixCells();
  // An explicit resume uses the exact same inputs/code. A truncated checkpoint
  // can never be selected; assessment requires all 216 unique cells.
  if (process.argv.includes("--resume")) {
    const previous = JSON.parse(await readFile(output, "utf8"));
    for (const [key, value] of Object.entries(context))
      if (JSON.stringify(previous[key]) !== JSON.stringify(value)) throw new Error(`Cannot resume changed ${key}`);
    if (!Array.isArray(previous.trials) || previous.trials.length > cells.length || previous.trials.some((t: ContactMatrixTrial, i: number) => contactCellKey(t) !== contactCellKey(cells[i])))
      throw new Error("Checkpoint is not an ordered matrix prefix");
    trials.push(...previous.trials);
  }
  for (const cell of cells.slice(trials.length)) {
    const trial = await runContactCell(fixtureBuilds.find(b => b.id === cell.fixture)!, cell);
    trials.push(trial);
    const evidence = { ...context, completed: trials.length === cells.length, assessment: assessContactMatrix(trials), trials };
    await writeFile(`${output}.tmp`, JSON.stringify(evidence, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
    console.log(`${trials.length}/${cells.length} ${contactCellKey(cell)} ${trial.passed ? "PASS" : "FAIL"} peak=${trial.peakPenetration.toFixed(6)} late=${trial.latePenetration} time=${trial.simulatedSeconds.toFixed(6)} reason=${trial.firstFailure?.reason ?? "completed"}`);
  }
  console.log(JSON.stringify(assessContactMatrix(trials)));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
