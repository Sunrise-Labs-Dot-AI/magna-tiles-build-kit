import { writeFile } from "node:fs/promises";
import { ACCEPTANCE_BRIEFS, REJECTION_BRIEFS } from "@/lib/harness/benchmark";
import { parseIntent } from "@/lib/harness/contract";
import { solveContract } from "@/lib/harness/solve";
import { HARNESS_MODEL } from "@/lib/harness/evaluate";

async function main() {
  const entries = [];
  for (const prompt of [...ACCEPTANCE_BRIEFS, ...REJECTION_BRIEFS]) {
    const started = Date.now(),
      expected = ACCEPTANCE_BRIEFS.includes(
        prompt as (typeof ACCEPTANCE_BRIEFS)[number],
      );
    const result = await solveContract(
      parseIntent(
        prompt,
        "classic-100",
        !prompt.includes("at most 30 pieces"),
      )!,
      { maxAttempts: 24, maxMilliseconds: 240000 },
    );
    const entry = {
      prompt,
      unlimitedPieces: result.contract.unlimitedPieces,
      expected: expected ? "solved" : "rejected",
      status: result.status,
      passed: expected
        ? result.status === "solved"
        : result.status !== "solved",
      attempts: result.attempts.length,
      pieces: result.build?.tiles.length ?? 0,
      milliseconds: Date.now() - started,
      fingerprint: result.evaluation?.fingerprint,
      failures: result.evaluation?.evidence.filter((e) => !e.passed) ?? [],
      program: result.attempts.find((a) => a.evaluation.passed)?.program,
      evaluation: result.evaluation,
      instructions: result.instructions,
      contract: result.contract,
      build: result.build,
    };
    entries.push(entry);
    console.log(
      JSON.stringify({
        ...entry,
        evaluation: undefined,
        instructions: undefined,
        contract: undefined,
        build: undefined,
      }),
    );
    await writeFile(
      "verification/harness-benchmark.json",
      JSON.stringify(
        {
          model: HARNESS_MODEL,
          inventory:
            "per-case (unlimited unless an explicit finite-budget case)",
          entries,
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(
    `${entries.filter((e) => e.passed).length}/${entries.length} acceptance outcomes correct.`,
  );
  if (entries.some((e) => !e.passed)) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
