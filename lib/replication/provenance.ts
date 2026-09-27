import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";

const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export function assertArtifactDigest(
  path: string,
  bytes: string | Buffer,
  expected: string,
): void {
  if (sha(bytes) !== expected)
    throw new Error(
      `Generated artifact changed: ${path}. Regenerate and review the complete evidence bundle.`,
    );
}

export async function artifactHashes(
  paths: string[],
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      [...paths].sort().map(async (path) => [path, sha(await readFile(path))]),
    ),
  );
}

export async function verifyArtifactManifest(paths: string[]): Promise<void> {
  const manifest = JSON.parse(
    await readFile("verification/replication/artifact-manifest.json", "utf8"),
  ) as Record<string, string>;
  if (
    JSON.stringify(Object.keys(manifest).sort()) !==
    JSON.stringify([...paths].sort())
  )
    throw new Error(
      "Artifact manifest coverage changed; regenerate the evidence bundle.",
    );
  for (const path of paths)
    assertArtifactDigest(path, await readFile(path), manifest[path]);
}

/** Bind generated evidence to the validator, physical model and dependency lock. */
export async function validationCodeHash(): Promise<string> {
  const files = ["package-lock.json", "scripts/reference/verify.ts", "scripts/reference/assembly-fixtures.ts", "tests/fixtures/assembly.ts", "tests/fixtures/closed-shell.ts", "tests/fixtures/rigid-contact.ts", "scripts/reference/rigid-contact.ts", "verification/replication/evidence-ledger.json", "verification/replication/candidate-freezes.json"];
  for (const directory of [
    "lib/replication",
    "lib/harness",
    "lib/engine",
    "lib/magnetic-tiles",
    "lib/planner",
  ]) {
    for (const entry of await readdir(directory, { recursive: true })) {
      if (entry.endsWith(".ts")) files.push(`${directory}/${entry}`);
    }
  }
  const vendor = "vendor/rapier-contact";
  await Promise.all((await readdir(vendor,{ recursive: true })).map(async entry => {
    const path = `${vendor}/${entry}`;
    if ((await stat(path)).isFile()) files.push(path);
  }));
  const hashes = await Promise.all(
    files.sort().map(async (path) => [path, sha(await readFile(path))]),
  );
  return sha(JSON.stringify(hashes));
}

/** Observation changes require an explicit, reviewable lock update. */
export async function verifyObservationLock(): Promise<void> {
  const lock = JSON.parse(
    await readFile("verification/replication/observation-lock.json", "utf8"),
  ) as Record<string, string>;
  for (const name of ["sources.json", "observations.json", "evidence-ledger.json", "candidate-freezes.json"]) {
    if (
      sha(await readFile(`verification/replication/${name}`)) !== lock[name]
    ) {
      throw new Error(
        `Observation lock mismatch: ${name}. Review the measurement change before replacing the lock.`,
      );
    }
  }
}
