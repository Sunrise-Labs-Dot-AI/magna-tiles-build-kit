import { judgeBuild, type VisualJudgeResult } from "../lib/verification/visual-judge";

async function main() {
  const id = process.argv[2];
  if (!id) {
    throw new Error("Usage: tsx scripts/judge-build.ts <build-id>");
  }

  const result = await judgeBuild(id, { renderIfMissing: true });
  printResult(id, result);
}

function printResult(id: string, result: VisualJudgeResult) {
  console.log(`${id}: ${result.verdict.toUpperCase()} (${result.score}/100)`);
  console.log(result.summary);
  if (result.differences.length > 0) {
    console.log("\nDifferences:");
    result.differences.forEach((difference, index) => {
      console.log(`${index + 1}. ${difference.part}`);
      console.log(`   observed: ${difference.observed}`);
      console.log(`   expected: ${difference.expected}`);
      console.log(`   fix: ${difference.suggestedFix}`);
    });
  }
  console.log("\nJSON:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
