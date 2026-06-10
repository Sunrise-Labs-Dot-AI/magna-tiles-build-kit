import { describe, expect, it } from "vitest";
import smallCarRampDraft from "@/build-drafts/small-car-ramp.json";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import {
  gateReconstruction,
  reconstructionReadiness
} from "@/lib/reference-encoder/reconstruction";
import type {
  MeasuredStepEvidence,
  ReferenceBuildEncoding,
  ReferenceEncodingStep
} from "@/lib/reference-encoder/types";

const source = {
  url: "https://www.youtube.com/watch?v=WDtC_9se3ds",
  videoId: "WDtC_9se3ds",
  embedUrl: "https://www.youtube.com/embed/WDtC_9se3ds",
  title: "Magna-Tiles Idea: Jet Aircraft",
  authorName: "JD's Curious Company",
  authorUrl: "https://www.youtube.com/@JDsCuriousCompany",
  thumbnailUrl: "https://i.ytimg.com/vi/WDtC_9se3ds/hqdefault.jpg",
  providerName: "YouTube"
};

function measured(overrides: Partial<MeasuredStepEvidence> = {}): MeasuredStepEvidence {
  return {
    startSeconds: 30,
    endSeconds: 38,
    representativeSeconds: 34,
    stabilitySeconds: 8,
    precedingMotionPeak: 0.2,
    intraSpanMeanChangedFraction: 0.001,
    foregroundRatio: 0.04,
    silhouetteDeltaRatio: 0.02,
    confidence: 0.85,
    confidenceParts: { stability: 1, motion: 1, quiet: 1, delta: 1 },
    needsHumanReview: false,
    baseline: false,
    ...overrides
  };
}

function step(
  id: string,
  overrides: Partial<ReferenceEncodingStep> = {}
): ReferenceEncodingStep {
  return {
    id,
    timestamp: "0:34",
    action: "connect",
    title: `Step ${id}`,
    notes: "measured placement",
    measured: measured(),
    ...overrides
  };
}

function encoding(steps: ReferenceEncodingStep[]): ReferenceBuildEncoding {
  return {
    source,
    status: "draft",
    buildLabel: "Jet Aircraft",
    observedTechniques: ["make a subassembly"],
    steps
  };
}

describe("reconstruction readiness (deterministic, honest failure)", () => {
  it("blocks an empty timeline", () => {
    const readiness = reconstructionReadiness(encoding([]));
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("no steps");
  });

  it("blocks while measured steps are still flagged for human review", () => {
    const readiness = reconstructionReadiness(
      encoding([
        step("s1"),
        step("s2", { measured: measured({ needsHumanReview: true, confidence: 0.3 }) })
      ])
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("needs human review");
    expect(readiness.blockers.join(" ")).toContain("s2");
  });

  it("unblocks once a human explicitly accepts the flagged step", () => {
    const readiness = reconstructionReadiness(
      encoding([
        step("s1"),
        step("s2", {
          measured: measured({ needsHumanReview: true, confidence: 0.3, humanAccepted: true })
        })
      ])
    );
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it("blocks when no step maps to an attach action", () => {
    const readiness = reconstructionReadiness(
      encoding([step("s1", { action: "balance-check" }), step("s2", { action: "adjust" })])
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("attach action");
  });

  it("blocks steps that lost their video timestamp", () => {
    const readiness = reconstructionReadiness(encoding([step("s1", { timestamp: "  " })]));
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("timestamp");
  });
});

describe("gateReconstruction (gate is law)", () => {
  it("calls a review-complete reconstruction buildable only after gateBuild passes", async () => {
    const result = await gateReconstruction(
      smallCarRampDraft as AuthoredBuildDraft,
      encoding([step("s1"), step("s2")])
    );

    expect(result.readiness.ready).toBe(true);
    expect(result.gate?.passed).toBe(true);
    expect(result.buildable).toBe(true);
    expect(result.reasons.join(" ")).toContain("build stands");
  });

  it("refuses buildable while a flagged step is unreviewed, even if the engine gate passes", async () => {
    const result = await gateReconstruction(
      smallCarRampDraft as AuthoredBuildDraft,
      encoding([
        step("s1"),
        step("s2", { measured: measured({ needsHumanReview: true, confidence: 0.2 }) })
      ])
    );

    expect(result.gate?.passed).toBe(true);
    expect(result.buildable).toBe(false);
    expect(result.reasons.join(" ")).toContain("needs human review");
  });
});
