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
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";
import { readBuildDraft } from "@/lib/builder/storage";
import { ENGINE_VALID_LIBRARY_BUILD_IDS } from "@/verification/engine-valid-builds";

describe("gateBuild engine source of truth", () => {
  it("keeps all legacy card, draft and verification statuses consistent with live gates", async () => {
    for (const card of BUILD_LIBRARY) {
      const draft = await readBuildDraft(card.id), verdict = await gateBuild(draftToBuildGraph(draft));
      const expected = verdict.passed ? "engine-valid" : "engine-fail-pending-reauthoring";
      expect(card.status, card.id).toBe(expected);
      expect(draft.status, card.id).toBe(expected);
      expect((ENGINE_VALID_LIBRARY_BUILD_IDS as readonly string[]).includes(card.id), card.id).toBe(verdict.passed);
    }
  }, 30_000);
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

  it("rejects the historical jet after removing artificial contact expansion", async () => {
    const verdict = await gateBuild(draftToBuildGraph(jetAircraftDraft as AuthoredBuildDraft));

    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("build does not stand");
  });

  it.each(VERIFICATION_PROMPTS)("$id prompt output is expected-fail until re-authored", async ({ prompt }) => {
    const verdict = await gateBuild(generateBuild(prompt).build);

    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });
});
