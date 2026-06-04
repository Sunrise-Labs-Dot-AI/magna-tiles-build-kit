import { describe, expect, it } from "vitest";
import jetAircraftDraft from "@/build-drafts/jet-aircraft.json";
import largeCarRampDraft from "@/build-drafts/large-car-ramp.json";
import mediumCarRampDraft from "@/build-drafts/medium-car-ramp.json";
import smallCarRampDraft from "@/build-drafts/small-car-ramp.json";
import { draftToBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { gateBuild } from "@/lib/engine";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { VERIFICATION_PROMPTS } from "@/verification/prompt-set";

describe("gateBuild engine source of truth", () => {
  it("accepts the authored small ramp as today's engine-valid anchor", async () => {
    const verdict = await gateBuild(draftToBuildGraph(smallCarRampDraft as AuthoredBuildDraft));

    expect(verdict.passed).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("build stands");
    expect(verdict.reasons.join(" ")).toContain("roll test");
  });

  it("accepts the re-authored medium ramp as a continuous rollable wedge", async () => {
    const verdict = await gateBuild(draftToBuildGraph(mediumCarRampDraft as AuthoredBuildDraft));

    expect(verdict.passed).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("build stands");
    expect(verdict.reasons.join(" ")).toContain("roll test");
  });

  it("accepts the re-authored large ramp as a wider continuous rollable wedge", async () => {
    const verdict = await gateBuild(draftToBuildGraph(largeCarRampDraft as AuthoredBuildDraft));

    expect(verdict.passed).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("build stands");
    expect(verdict.reasons.join(" ")).toContain("roll test");
  });

  it("accepts the re-authored jet aircraft as a standing recognizable-object build", async () => {
    const verdict = await gateBuild(draftToBuildGraph(jetAircraftDraft as AuthoredBuildDraft));

    expect(verdict.passed).toBe(true);
    expect(verdict.reasons.join(" ")).toContain("build stands");
    expect(verdict.reasons.join(" ")).toContain("recognizable-object resemblance requires human signoff");
  });

  it.each(VERIFICATION_PROMPTS)("$id prompt output is expected-fail until re-authored", async ({ prompt }) => {
    const verdict = await gateBuild(generateBuild(prompt).build);

    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });
});
