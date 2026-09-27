import { writeFile } from "node:fs/promises";
import { assemblyUFixture, seatedRoofFixture } from "../../tests/fixtures/assembly";
import { bridgePanelFixture } from "../../tests/fixtures/bridge-panel";
import { continuedPrefixFixture } from "../../tests/fixtures/continued-prefix";
import { evaluateAssembly } from "../../lib/replication/assembly";
import { validationCodeHash } from "../../lib/replication/provenance";

async function main() {
  const replica = assemblyUFixture(), result = await evaluateAssembly(replica);
  const roof = seatedRoofFixture(), seating = await evaluateAssembly(roof);
  const bridge = bridgePanelFixture(), bridging = await evaluateAssembly(bridge);
  const continued = continuedPrefixFixture(), continuation = await evaluateAssembly(continued);
  const evidence = { generatedAt: new Date().toISOString(), validationCodeHash: await validationCodeHash(),
    scope: "Generic three-wall, gravity-seated roof, one-panel bridge and continued-prefix fixtures, independent of source replicas. The seated roof has actual bearing area on its narrower U support. The bridge joins two individually built supports and preserves a separate table panel. Ordinary continuation retains earned predecessor joins and adds only the incoming panel's contacts, excluding an unearned nominal old join. Three perturbation seeds, two-finger edge proxy and explicit one-panel supports. No physical human or magnetic-force certification.", replica, result, gravitySeating: { replica: roof, result: seating }, bridgeInsertion: { replica: bridge, result: bridging }, continuedPrefix: { replica: continued, result: continuation } };
  await writeFile("verification/replication/assembly-fixture.json", JSON.stringify(evidence, null, 2) + "\n");
  const all=[...result,...seating,...bridging,...continuation];
  if (all.some(r => r.status !== "pass")) throw new Error("Generic assembly fixture failed");
  console.log(`Verified ${all.reduce((n,r)=>n+r.operations.length,0)} insertion/support operations, including gravity placements and three bridges.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
