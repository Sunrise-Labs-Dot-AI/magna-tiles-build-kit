import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { CONTACT_NATURAL_FREQUENCY_HZ, MAX_COLLISION_TIMESTEP_SECONDS } from "../../lib/engine/constants";
import { validationCodeHash, artifactHashes } from "../../lib/replication/provenance";
import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { FINER_CONTACT_MATRIX, assertContactFixture, contactCellKey, contactMatrixCells, runContactCell, type ContactMatrixTrial } from "./contact-matrix";
import { assessFinerContactMatrix } from "./finer-contact-matrix";

async function main() {
  const output = process.argv[2] ?? "/tmp/magnatiles-finer-contact-matrix.json";
  const fixtureBuilds = contactMatrixFixtures();
  fixtureBuilds.forEach(assertContactFixture);
  const context = {
    scope: "Independent finer-step numerical profile selection only. No material, source or construction acceptance. Runtime unchanged during the experiment.",
    validationCodeHash: await validationCodeHash(),
    configuredProfile: { frequency: CONTACT_NATURAL_FREQUENCY_HZ, collisionHz: 1 / MAX_COLLISION_TIMESTEP_SECONDS },
    inputHash: createHash("sha256").update(JSON.stringify(fixtureBuilds)).digest("hex"),
    scriptHashes: await artifactHashes(["scripts/reference/contact-matrix.ts", "scripts/reference/finer-contact-matrix.ts", "scripts/reference/probe-finer-contact-matrix.ts", "tests/fixtures/loaded-contact.ts", "runs/2026-09-27-finer-contact-plan.md"]),
    criteria: FINER_CONTACT_MATRIX, fixtureBuilds,
  };
  const cells = contactMatrixCells("finer"), trials: ContactMatrixTrial[] = [];
  if (process.argv.includes("--resume")) {
    const previous = JSON.parse(await readFile(output, "utf8"));
    for (const [key, value] of Object.entries(context))
      if (JSON.stringify(previous[key]) !== JSON.stringify(value)) throw new Error(`Cannot resume changed ${key}`);
    if (!Array.isArray(previous.trials) || previous.trials.length > cells.length || previous.trials.some((t: ContactMatrixTrial, i: number) => contactCellKey(t) !== contactCellKey(cells[i])))
      throw new Error("Checkpoint is not an ordered finer matrix prefix");
    trials.push(...previous.trials);
  }
  for (const cell of cells.slice(trials.length)) {
    const started = performance.now();
    const trial = await runContactCell(fixtureBuilds.find(b => b.id === cell.fixture)!, cell, "finer");
    const wallSeconds = (performance.now() - started) / 1000;
    trials.push(trial);
    await writeFile(`${output}.tmp`, JSON.stringify({ ...context, completed: trials.length === cells.length,
      assessment: assessFinerContactMatrix(trials), trials }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
    console.log(`${trials.length}/${cells.length} ${contactCellKey(cell)} ${trial.passed ? "PASS" : "FAIL"} peak=${trial.peakPenetration.toFixed(6)} late=${trial.latePenetration} simulated=${trial.simulatedSeconds.toFixed(6)} wall=${wallSeconds.toFixed(3)} reason=${trial.firstFailure?.reason ?? "completed"}`);
  }
  console.log(JSON.stringify(assessFinerContactMatrix(trials)));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
