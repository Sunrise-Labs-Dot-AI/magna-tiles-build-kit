import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { judgeBuild } from "../lib/verification/visual-judge";

const ROOT = process.cwd();

async function main() {
  const ids = await signedOffBuildIds();
  if (ids.length === 0) {
    console.log("No builds with recorded human signoff found.");
    return;
  }

  let failed = false;
  for (const id of ids) {
    const result = await judgeBuild(id, { renderIfMissing: true });
    console.log(`${id}: ${result.verdict.toUpperCase()} (${result.score}/100) - ${result.summary}`);
    if (result.verdict !== "match") failed = true;
  }

  if (failed) process.exit(1);
}

async function signedOffBuildIds() {
  const signoffPath = join(ROOT, "verification", "SIGNOFF.md");
  const signedOff = existsSync(signoffPath) ? await readFile(signoffPath, "utf8") : "";
  const referenceRoot = join(ROOT, "public", "reference-frames");
  if (!existsSync(referenceRoot)) return [];

  const candidates = await readdir(referenceRoot, { withFileTypes: true });
  return candidates
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => hasRecordedApproval(signedOff, id));
}

function hasRecordedApproval(signoff: string, id: string) {
  const normalizedId = id.toLowerCase();
  return signoff
    .split("\n")
    .some((line) => line.toLowerCase().includes(normalizedId) && /\b(approved|sign(ed)? off|match)\b/i.test(line));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
