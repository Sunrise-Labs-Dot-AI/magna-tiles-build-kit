import { writeFile } from "node:fs/promises";
import { assemblyUFixture } from "../../tests/fixtures/assembly";
import { evaluateAssembly } from "../../lib/replication/assembly";
import { validationCodeHash } from "../../lib/replication/provenance";

async function main() {
  const replica = assemblyUFixture(), result = await evaluateAssembly(replica);
  const evidence = { generatedAt: new Date().toISOString(), validationCodeHash: await validationCodeHash(),
    scope: "Generic three-wall assembly fixture, independent of source replicas. Three perturbation seeds, two-finger edge proxy and explicit one-panel supports. No physical human or magnetic-force certification.", replica, result };
  await writeFile("verification/replication/assembly-fixture.json", JSON.stringify(evidence, null, 2) + "\n");
  if (result.some(r => r.status !== "pass")) throw new Error("Generic assembly fixture failed");
  console.log(`Verified ${result[0].operations.length} insertion/support operations across three seeds.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
