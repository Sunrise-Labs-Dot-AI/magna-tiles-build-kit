import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import jetAircraftDraft from "@/build-drafts/jet-aircraft.json";
import largeCarRampDraft from "@/build-drafts/large-car-ramp.json";
import mediumCarRampDraft from "@/build-drafts/medium-car-ramp.json";
import smallCarRampDraft from "@/build-drafts/small-car-ramp.json";
import { draftToBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { gateBuild } from "@/lib/engine";
import { referenceAcceptanceCases } from "@/lib/reference-encoder/reference-acceptance";

const BUG_REPORT_DIR = join(process.cwd(), "bug-reports");

const REFERENCE_DRAFTS = {
  "jet-aircraft": jetAircraftDraft,
  "small-car-ramp": smallCarRampDraft,
  "medium-car-ramp": mediumCarRampDraft,
  "large-car-ramp": largeCarRampDraft
} as const;

describe("reference acceptance", () => {
  it("uses gateBuild, not silhouette/subassembly proxies, for shipped reference validity", async () => {
    const cases = referenceAcceptanceCases();
    const verdicts = await Promise.all(
      cases.map(async (testCase) => ({
        id: testCase.id,
        verdict: await gateBuild(draftToBuildGraph(REFERENCE_DRAFTS[testCase.id as keyof typeof REFERENCE_DRAFTS] as AuthoredBuildDraft))
      }))
    );

    expect(verdicts.find((item) => item.id === "small-car-ramp")?.verdict.passed).toBe(true);
    expect(verdicts.find((item) => item.id === "medium-car-ramp")?.verdict.passed).toBe(true);
    expect(verdicts.find((item) => item.id === "large-car-ramp")?.verdict.passed).toBe(true);
    expect(verdicts.find((item) => item.id === "jet-aircraft")?.verdict.passed).toBe(true);
    expect(verdicts.filter((item) => item.verdict.passed).map((item) => item.id).sort()).toEqual([
      "jet-aircraft",
      "large-car-ramp",
      "medium-car-ramp",
      "small-car-ramp"
    ]);
    expect(verdicts.filter((item) => !item.verdict.passed).map((item) => item.id).sort()).toEqual([]);
  });
});

describe("filed bug report regressions", () => {
  const bugReports = readdirSync(BUG_REPORT_DIR)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const path = join(BUG_REPORT_DIR, file);
      const contents = readFileSync(path, "utf8");
      return {
        file,
        contents,
        prompt: readFrontmatterString(contents, "prompt"),
        title: contents.match(/^# (.+)$/m)?.[1] ?? file
      };
    });

  it("has a regression fixture for every filed markdown report", () => {
    expect(bugReports).toHaveLength(9);
    expect(bugReports.every((report) => report.prompt)).toBe(true);
  });

  it.each(bugReports)("$file: $title is covered by engine-gate expected-fail status", ({ prompt }) => {
    const matchingCase = referenceAcceptanceCases().find((testCase) => testCase.prompt === prompt);

    expect(matchingCase).toBeDefined();
  });
});

function readFrontmatterString(contents: string, key: string): string {
  const match = contents.match(new RegExp(`^${key}:\\s*"([^"]+)"`, "m"));
  return match?.[1] ?? "";
}
