import { writeFile } from "node:fs/promises";
import { assemblyUFixture, seatedRoofFixture } from "../../tests/fixtures/assembly";
import { evaluateAssembly } from "../../lib/replication/assembly";
import { validationCodeHash } from "../../lib/replication/provenance";

async function main() {
  const replica = assemblyUFixture(), result = await evaluateAssembly(replica);
  const roof = seatedRoofFixture(), seating = await evaluateAssembly(roof);
  const evidence = { generatedAt: new Date().toISOString(), validationCodeHash: await validationCodeHash(),
    scope: "Generic three-wall and gravity-seated roof fixtures, independent of source replicas. The seated roof has actual bearing area on its narrower U support. Three perturbation seeds, two-finger edge proxy and explicit one-panel supports. No physical human or magnetic-force certification.", replica, result, gravitySeating: { replica: roof, result: seating } };
  await writeFile("verification/replication/assembly-fixture.json", JSON.stringify(evidence, null, 2) + "\n");
  if ([...result, ...seating].some(r => r.status !== "pass")) throw new Error("Generic assembly fixture failed");
  console.log(`Verified ${result[0].operations.length + seating[0].operations.length} insertion/support operations, including three gravity placements.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
