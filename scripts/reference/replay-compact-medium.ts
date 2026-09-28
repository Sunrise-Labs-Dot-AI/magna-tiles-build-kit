/** Repeat archived candidate geometry after a numerical-engine change.
 * This produces diagnostic evidence, never source or assembly acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { BuildGraph } from "../../lib/magnetic-tiles/types";
import { geometryCheck } from "../../lib/replication/evaluate";
import { validationCodeHash } from "../../lib/replication/provenance";
import { releaseCandidate } from "../../lib/replication/release";

const input = "runs/diagnostics/2026-09-27-compact-medium-hypotheses.json";
const inputSha256 = "b2591b2b5d6a84ed9efd9c4d9be2e67d682fe90bda96503bdd9bd2032e1ca2b5";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const bytes = await readFile(input);
  assert.equal(sha(bytes), inputSha256, "Archived geometry changed");
  const archived = JSON.parse(bytes.toString()) as {
    fullCandidates: { variant: string; build: BuildGraph }[];
    closedSupportLoads: { rows: { step: number; build: BuildGraph }[] };
  };
  assert.equal(archived.fullCandidates.length, 3);
  assert.equal(archived.closedSupportLoads.rows.length, 2);
  const context = await validationCodeHash();
  const scriptSha256 = sha(await readFile(new URL(import.meta.url)));
  const output = process.argv[2] ?? "/tmp/magnatiles-compact-medium-runtime-replay.json";
  const candidates = [
    ...archived.fullCandidates.map(row => ({ id: row.variant, build: row.build })),
    ...archived.closedSupportLoads.rows.map(row => ({ id: `closed-support-through-step-${row.step}`, build: row.build })),
  ];
  const rows: { id: string; build: BuildGraph; geometry: ReturnType<typeof geometryCheck>;
    releases: Awaited<ReturnType<typeof releaseCandidate>>[] }[] = [];
  const record = async (completed: boolean) => {
    await writeFile(`${output}.tmp`, JSON.stringify({
      scope: "Unchanged archived hypotheses and load prefixes. No source, assembly, vehicle or physical-calibration credit.",
      input, inputSha256, scriptSha256, validationCodeHash: context, completed, rows,
    }, null, 2) + "\n");
    await rename(`${output}.tmp`, output);
  };
  await record(false);
  for (const candidate of candidates) {
    const geometry = geometryCheck(candidate.build);
    const row = { ...candidate, geometry, releases: [] as Awaited<ReturnType<typeof releaseCandidate>>[] };
    rows.push(row);
    if (geometry.status === "pass") for (const seed of [0, 17, 53]) {
      const started = performance.now();
      const result = await releaseCandidate(candidate.build, seed);
      row.releases.push(result);
      await record(false);
      console.log(`${candidate.id} seed=${seed} ${result.status} table=${result.peakGroundPenetration} rest=${result.settledSteps} wall=${((performance.now() - started) / 1000).toFixed(3)}s`);
    }
  }
  assert.equal(await validationCodeHash(), context, "Validator changed during replay");
  assert.equal(sha(await readFile(input)), inputSha256, "Archive changed during replay");
  assert.equal(sha(await readFile(new URL(import.meta.url))), scriptSha256, "Replay script changed during execution");
  await record(true);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
