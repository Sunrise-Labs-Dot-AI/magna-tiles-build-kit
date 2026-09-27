import { readFile } from "node:fs/promises";
import { replicas } from "../../lib/replication/models";
import { fingerprint } from "../../lib/replication/evaluate";
import {
  validationCodeHash,
  verifyObservationLock,
  verifyArtifactManifest,
} from "../../lib/replication/provenance";
import type {
  Observation,
  Replica,
  ReplicaReport,
} from "../../lib/replication/types";
import data from "../../verification/replication/observations.json";

async function main() {
  await verifyObservationLock();
  const context = await validationCodeHash();
  const artifacts = ["verification/replication/results.json", "verification/replication/assembly-fixture.json"];
  const fixture = JSON.parse(await readFile("verification/replication/assembly-fixture.json", "utf8")) as { validationCodeHash: string };
  if (fixture.validationCodeHash !== context) throw new Error("Stale assembly fixture evidence. Regenerate the source report.");
  for (const replica of replicas()) {
    const saved = JSON.parse(
      await readFile(`public/reference-replicas/${replica.id}.json`, "utf8"),
    ) as { replica: Replica; report: ReplicaReport };
    const observations = (data.observations as Observation[]).filter(
      (o) => o.replicaId === replica.id,
    );
    artifacts.push(
      `public/reference-replicas/${replica.id}.json`,
      ...saved.report.projections
        .filter((p) => p.camera)
        .map((p) => `public/reference-replicas/${p.id}.svg`),
    );
    if (
      JSON.stringify(saved.replica) !== JSON.stringify(replica) ||
      saved.report.fingerprint !== fingerprint(replica, observations) ||
      saved.report.validationCodeHash !== context
    )
      throw new Error(
        `Stale evidence for ${replica.id}. Run npm run reference:report against the local source media before building.`,
      );
  }
  await verifyArtifactManifest(artifacts);
  console.log(
    "Four artifact/model/validator fingerprints match. This does not certify replication or recheck unavailable local media.",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
