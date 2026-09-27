/** Archive a completed diagnostic run without changing or selecting runtime settings. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { FINER_CONTACT_MATRIX, contactCellKey, passesContactTrial, type ContactMatrixTrial } from "./contact-matrix";
import { assessFinerContactMatrix } from "./finer-contact-matrix";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const input = process.argv[2] ?? "/tmp/magnatiles-finer-contact-matrix.json";
  const prefix = process.argv[3] ?? "runs/diagnostics/2026-09-27-finer-contact";
  const bytes = await readFile(input), data = JSON.parse(bytes.toString());
  const trials = data.trials as ContactMatrixTrial[];
  const assessment = assessFinerContactMatrix(trials);
  assert.equal(data.completed, true, "Only a completed matrix can be archived as complete evidence");
  assert.deepEqual(assessment.coverageErrors, []);
  assert.deepEqual(data.assessment, assessment, "Stored assessment must match measured evidence");
  assert.deepEqual(data.criteria, FINER_CONTACT_MATRIX);
  // Compare the exact serialized representation: JSON omits undefined optional
  // fields and writes -0 as 0. No other numeric or geometric difference is allowed.
  assert.deepEqual(data.fixtureBuilds, JSON.parse(JSON.stringify(contactMatrixFixtures())));
  assert.equal(data.inputHash, sha(JSON.stringify(data.fixtureBuilds)));
  assert.equal(data.validationCodeHash, await validationCodeHash());
  const scriptPaths = ["scripts/reference/contact-matrix.ts", "scripts/reference/finer-contact-matrix.ts",
    "scripts/reference/probe-finer-contact-matrix.ts", "tests/fixtures/loaded-contact.ts", "runs/2026-09-27-finer-contact-plan.md"];
  assert.deepEqual(data.scriptHashes, await artifactHashes(scriptPaths));
  assert(trials.every(trial => trial.passed === passesContactTrial(trial)), "Serialized pass flags must match measurements");

  const baselineBytes = gunzipSync(await readFile("runs/diagnostics/2026-09-27-loaded-contact-matrix.json.gz"));
  const baseline = JSON.parse(baselineBytes.toString());
  const overlaps = trials.filter(trial => trial.hz === 1920);
  assert.equal(overlaps.length, 72);
  const baselineComparison = overlaps.map(trial => {
    const previous = baseline.trials.find((row: ContactMatrixTrial) => contactCellKey(row) === contactCellKey(trial));
    assert(previous, `Missing historical overlap ${contactCellKey(trial)}`);
    return { cell: contactCellKey(trial), identical: JSON.stringify(previous) === JSON.stringify(trial) };
  });
  const gzip = gzipSync(bytes);
  assert(gunzipSync(gzip).equals(bytes));
  const profiles = assessment.profiles.map(profile => {
    const rows = trials.filter(trial => trial.frequency === profile.frequency &&
      (trial.hz === profile.collisionHz || trial.hz === profile.refinementHz));
    const complete = profile.groups.filter(group => group.complete);
    const late = rows.flatMap(row => row.latePenetration === null ? [] : [row.latePenetration]);
    return { ...profile, peakPenetrationMax: Math.max(...rows.map(row => row.peakPenetration)),
      completedLatePenetrationMax: late.length ? Math.max(...late) : null,
      peakSpreadMaxAmongCompleteGroups: complete.length ? Math.max(...complete.map(group => group.peakSpread!)) : null,
      lateSpreadMaxAmongCompleteGroups: complete.length ? Math.max(...complete.map(group => group.lateSpread!)) : null };
  });
  const manifest = {
    scope: "Complete independent numerical experiment only. Selection does not change runtime or establish source, construction or material validity.",
    validationCodeHash: data.validationCodeHash, scriptHashes: data.scriptHashes,
    archiveScriptSha256: sha(await readFile("scripts/reference/archive-finer-contact-matrix.ts")),
    inputHash: data.inputHash, rawSha256: sha(bytes), gzipSha256: sha(gzip), rawBytes: bytes.length, gzipBytes: gzip.length,
    trialCount: trials.length, ordinaryPassCount: trials.filter(passesContactTrial).length,
    selectedProfile: assessment.selectedProfile, profiles,
    baseline: { rawSha256: sha(baselineBytes), compared: baselineComparison.length,
      identical: baselineComparison.filter(row => row.identical).length, rows: baselineComparison },
  };
  await writeFile(`${prefix}-matrix.json.gz`, gzip);
  await writeFile(`${prefix}-manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ trialCount: manifest.trialCount, ordinaryPassCount: manifest.ordinaryPassCount,
    selectedProfile: manifest.selectedProfile, profiles: profiles.map(profile => ({
      frequency: profile.frequency, collisionHz: profile.collisionHz, refinementHz: profile.refinementHz,
      passed: profile.passed, ordinaryPasses: profile.ordinaryPasses, totalTrials: profile.totalTrials,
      peakPenetrationMax: profile.peakPenetrationMax, completedLatePenetrationMax: profile.completedLatePenetrationMax,
      peakSpreadMaxAmongCompleteGroups: profile.peakSpreadMaxAmongCompleteGroups,
      lateSpreadMaxAmongCompleteGroups: profile.lateSpreadMaxAmongCompleteGroups,
    })),
    baselineIdentical: manifest.baseline.identical, baselineCompared: manifest.baseline.compared }, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
