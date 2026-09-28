/** Execute the unchanged independent transfer fixture for CPU profiling.
 * Profiling is a cost diagnostic, never a waiver of assembly/source gates. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evaluateAssembly } from "../../lib/replication/assembly";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { supportedComponentTransferFixture } from "../../tests/fixtures/component-transfer";

async function main() {
  const context = {
    validationCodeHash: await validationCodeHash(),
    inputHashes: await artifactHashes([
      "scripts/reference/profile-assembly-checks.ts",
      "tests/fixtures/component-transfer.ts",
    ]),
  };
  const replica = supportedComponentTransferFixture();
  const before = structuredClone(replica), started = performance.now();
  const result = await evaluateAssembly(replica);
  const seconds = (performance.now() - started) / 1000;
  assert.deepEqual(replica, before, "Profiling mutated the fixture");
  assert.equal(await validationCodeHash(), context.validationCodeHash, "Runtime changed during profiling");
  assert.deepEqual(await artifactHashes(Object.keys(context.inputHashes)), context.inputHashes, "Profile input changed");
  await writeFile("/tmp/magnatiles-assembly-profile-before.json", JSON.stringify({
    scope: "CPU cost diagnostic of the complete unchanged independent transfer fixture. No source acceptance.",
    context, replica, result, wallSeconds: seconds,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ wallSeconds: seconds, stages: result.map(row => ({ stageId: row.stageId, status: row.status })) }));
  assert(result.length === replica.stages.length && result.every(row => row.status === "pass"), "Profiling fixture failed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
