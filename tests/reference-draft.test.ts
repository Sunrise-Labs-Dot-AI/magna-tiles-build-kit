import { describe, expect, it } from "vitest";
import { generateHeuristicDraft } from "@/lib/reference-encoder/draft";
import {
  MAX_FRAME_CANDIDATES,
  MAX_FRAME_SAMPLES,
  estimateTextLikelihood,
  planFrameTimestamps,
  selectDefaultFrameIndexes
} from "@/lib/reference-encoder/frame-sampler";
import {
  DEFAULT_DRAFT_MODEL_CONFIG,
  parseDraftModelConfig
} from "@/lib/reference-encoder/model-options";
import { CAR_RAMPS_REFERENCE_COLLECTION } from "@/lib/reference-encoder/examples/car-ramps-reference";
import { JET_AIRCRAFT_REFERENCE_ENCODING } from "@/lib/reference-encoder/examples/jet-aircraft-reference";
import { runReferenceAcceptance } from "@/lib/reference-encoder/reference-acceptance";
import { prepareBugReport } from "@/lib/bug-reports";
import type { ReferenceVideoSource } from "@/lib/reference-encoder/types";

const jetSource: ReferenceVideoSource = {
  url: "https://www.youtube.com/watch?v=WDtC_9se3ds",
  videoId: "WDtC_9se3ds",
  embedUrl: "https://www.youtube.com/embed/WDtC_9se3ds",
  title: "Magna-Tiles Idea: Jet Aircraft",
  authorName: "JD's Curious Company",
  authorUrl: "https://www.youtube.com/@JDsCuriousCompany",
  thumbnailUrl: "https://i.ytimg.com/vi/WDtC_9se3ds/hqdefault.jpg",
  providerName: "YouTube"
};

describe("reference draft encoder", () => {
  it("creates an aircraft-specific first pass from YouTube metadata", () => {
    const draft = generateHeuristicDraft(
      jetSource,
      "Pay attention to wings, folding, balance, and magnet alignment."
    );

    expect(draft.buildLabel).toBe("Jet Aircraft");
    expect(draft.observedTechniques).toContain("build flat, then fold");
    expect(draft.observedTechniques).toContain("adjust angle for magnet alignment");
    expect(draft.steps.length).toBeGreaterThanOrEqual(6);
    expect(draft.steps.some((step) => step.action === "fold")).toBe(true);
    expect(draft.steps.some((step) => step.action === "balance-check")).toBe(true);
    expect(draft.steps.every((step) => step.timestamp !== undefined)).toBe(true);
    expect(draft.steps.some((step) => step.tileCounts["small-square"] > 0)).toBe(true);
    expect(draft.steps.every((step) => step.pieceEstimateConfidence)).toBe(true);
  });

  it("creates a generic draft for unknown build types", () => {
    const draft = generateHeuristicDraft({
      ...jetSource,
      title: "Magnetic Tile Idea: Mystery Sculpture"
    });

    expect(draft.buildLabel).toBe("Magnetic Tile Idea: Mystery Sculpture");
    expect(draft.steps.length).toBeGreaterThanOrEqual(4);
    expect(draft.steps[0].action).toBe("build-subassembly");
    expect(draft.steps[0].tileCounts["small-square"]).toBe(0);
  });

  it("parses supported model and reasoning controls", () => {
    expect(
      parseDraftModelConfig({
        model: "gpt-5.5",
        reasoningEffort: "xhigh"
      })
    ).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "xhigh"
    });
  });

  it("falls back for unsupported model controls", () => {
    expect(
      parseDraftModelConfig({
        model: "not-a-model",
        reasoningEffort: "extreme"
      })
    ).toEqual(DEFAULT_DRAFT_MODEL_CONFIG);
  });

  it("plans bounded frame samples across a video duration", () => {
    expect(planFrameTimestamps(60, 4)).toEqual([2, 20, 37, 55]);
    expect(planFrameTimestamps(60, 40)).toHaveLength(MAX_FRAME_SAMPLES);
    expect(planFrameTimestamps(120, 80, MAX_FRAME_CANDIDATES)).toHaveLength(
      MAX_FRAME_CANDIDATES
    );
  });

  it("plans frame samples after intro cutoff and preserves pinned landmarks", () => {
    const timestamps = planFrameTimestamps(60, 4, MAX_FRAME_SAMPLES, 11, [11]);

    expect(timestamps[0]).toBe(11);
    expect(timestamps).toContain(11);
    expect(timestamps.every((seconds) => seconds >= 11)).toBe(true);
  });

  it("downselects high-scoring frames without clustering every pick", () => {
    const selected = selectDefaultFrameIndexes(
      [
        { seconds: 0, priorityScore: 80 },
        { seconds: 1, priorityScore: 95 },
        { seconds: 20, priorityScore: 75 },
        { seconds: 40, priorityScore: 70 },
        { seconds: 41, priorityScore: 99 }
      ],
      3
    );

    expect(selected.size).toBe(3);
    expect(selected.has(1)).toBe(true);
    expect(selected.has(4)).toBe(true);
  });

  it("scores text-like frames higher than blank frames", () => {
    const width = 64;
    const height = 36;
    const blank = Array.from({ length: width * height }, () => 230);
    const textLike = [...blank];

    for (const y of [8, 9, 14, 15, 21, 22]) {
      for (let x = 8; x < 54; x += 6) {
        textLike[y * width + x] = 20;
        textLike[y * width + x + 1] = 20;
        textLike[y * width + x + 2] = 20;
      }
    }

    expect(estimateTextLikelihood(textLike, width, height, 210, 52)).toBeGreaterThan(0.45);
    expect(estimateTextLikelihood(blank, width, height, 230, 0)).toBeLessThan(0.1);
  });

  it("captures the reviewed jet aircraft encoding lessons", () => {
    expect(JET_AIRCRAFT_REFERENCE_ENCODING.billOfMaterials).toMatchObject({
      "small-square": 16,
      "isosceles-triangle": 5,
      "equilateral-triangle": 9,
      "right-triangle": 10
    });
    expect(
      JET_AIRCRAFT_REFERENCE_ENCODING.steps.some((step) =>
        step.evidence?.overlayText?.includes("horizontal tail piece first")
      )
    ).toBe(true);
    expect(
      JET_AIRCRAFT_REFERENCE_ENCODING.steps.some((step) =>
        step.physicalNotes?.some((note) => note.includes("manipulation-only"))
      )
    ).toBe(true);
  });

  it("captures multi-build car ramp segmentation and unsupported materials", () => {
    expect(CAR_RAMPS_REFERENCE_COLLECTION.segments.map((segment) => segment.id)).toEqual([
      "small-car-ramp",
      "medium-car-ramp",
      "large-car-ramp"
    ]);
    expect(CAR_RAMPS_REFERENCE_COLLECTION.segments[0].billOfMaterials).toMatchObject({
      "small-square": 5,
      "right-triangle": 2,
      "isosceles-triangle": 2
    });
    expect(CAR_RAMPS_REFERENCE_COLLECTION.segments[1].billOfMaterials).toMatchObject({
      "equilateral-triangle": 18,
      "small-square": 15,
      "isosceles-triangle": 4
    });
    expect(CAR_RAMPS_REFERENCE_COLLECTION.segments[2].additionalMaterials).toEqual([
      expect.objectContaining({ label: "XL square", count: 3 })
    ]);
  });

  it("prepares local bug reports with build context", () => {
    const report = prepareBugReport(
      {
        prompt: "a ramp",
        currentStep: 3,
        severity: "bug",
        area: "rendering",
        summary: "Ramp overlaps itself",
        details: "The ramp panels intersect in the viewer.",
        result: null
      },
      new Date("2026-05-14T12:00:00.000Z")
    );

    expect(report.filename).toBe("2026-05-14T12-00-00.000Z-ramp-overlaps-itself.md");
    expect(report.markdown).toContain("Prompt: a ramp");
    expect(report.markdown).toContain("The ramp panels intersect in the viewer.");
  });

  it("accepts reviewed references once they match BOM and physical validation", () => {
    const run = runReferenceAcceptance(new Date("2026-05-14T13:00:00.000Z"));

    expect(run.cases.map((testCase) => testCase.id)).toEqual([
      "jet-aircraft",
      "small-car-ramp",
      "medium-car-ramp",
      "large-car-ramp"
    ]);
    expect(run.gaps.map((gap) => gap.summary)).toEqual([]);
    expect(run.reports).toHaveLength(run.gaps.length);
  });
});
