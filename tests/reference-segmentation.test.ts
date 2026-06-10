import { describe, expect, it } from "vitest";
import { planAdaptiveFps } from "@/lib/reference-encoder/ingest";
import { stepsFromMeasuredTimeline } from "@/lib/reference-encoder/measured-draft";
import {
  decodeMaskPng,
  decodePngToGrayFrame,
  encodeGrayFrameToPng,
  encodeMaskToPng
} from "@/lib/reference-encoder/png-io";
import {
  DEFAULT_SEGMENTATION_OPTIONS,
  computeSilhouette,
  detectMeasuredSteps,
  diffFrames,
  maskDeltaRatio,
  maskForegroundRatio,
  majorityFilter,
  segmentSpans,
  type GrayFrame
} from "@/lib/reference-encoder/segmentation";
import type {
  MeasuredTimelinePayload,
  MeasuredTimelineStepPayload
} from "@/lib/reference-encoder/types";

const WIDTH = 32;
const HEIGHT = 18;
const BACKGROUND_VALUE = 40;
const TILE_VALUE = 200;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BLOCK_ONE: Rect = { x: 4, y: 6, w: 8, h: 6 };
const BLOCK_TWO: Rect = { x: 18, y: 4, w: 6, h: 8 };

function makeFrame(seconds: number, paint?: (x: number, y: number) => number): GrayFrame {
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      pixels[y * WIDTH + x] = paint ? paint(x, y) : BACKGROUND_VALUE;
    }
  }
  return { seconds, width: WIDTH, height: HEIGHT, pixels };
}

function inRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function buildFrame(seconds: number, blocks: Rect[]): GrayFrame {
  return makeFrame(seconds, (x, y) =>
    blocks.some((block) => inRect(x, y, block)) ? TILE_VALUE : BACKGROUND_VALUE
  );
}

/** A deterministic "hands moving" frame: a bright band whose position depends on tick. */
function motionFrame(seconds: number, tick: number, blocks: Rect[] = []): GrayFrame {
  const bandStart = (tick * 5) % (WIDTH - 8);
  return makeFrame(seconds, (x, y) => {
    if (x >= bandStart && x < bandStart + 8) return 230;
    return blocks.some((block) => inRect(x, y, block)) ? TILE_VALUE : BACKGROUND_VALUE;
  });
}

function sequence(...parts: GrayFrame[][]): GrayFrame[] {
  return parts.flat().map((frame, index) => ({ ...frame, seconds: index }));
}

function repeat(count: number, make: (i: number) => GrayFrame): GrayFrame[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

describe("frame differencing", () => {
  it("reports zero difference for identical frames", () => {
    const a = buildFrame(0, [BLOCK_ONE]);
    const b = buildFrame(1, [BLOCK_ONE]);
    expect(diffFrames(a, b, 14)).toEqual({ meanAbsDiff: 0, changedFraction: 0 });
  });

  it("reports the changed fraction when a block appears", () => {
    const a = makeFrame(0);
    const b = buildFrame(1, [BLOCK_ONE]);
    const { changedFraction } = diffFrames(a, b, 14);
    expect(changedFraction).toBeCloseTo((BLOCK_ONE.w * BLOCK_ONE.h) / (WIDTH * HEIGHT), 5);
  });
});

describe("motion/stable segmentation", () => {
  it("treats an all-static sequence as a single stable span", () => {
    const frames = sequence(repeat(6, () => makeFrame(0)));
    const spans = segmentSpans(frames);
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe("stable");
    expect(spans[0].startIndex).toBe(0);
    expect(spans[0].endIndex).toBe(5);
  });

  it("splits background → motion → placement → motion → placement into five spans", () => {
    const frames = sequence(
      repeat(6, () => makeFrame(0)),
      repeat(4, (i) => motionFrame(0, i)),
      repeat(8, () => buildFrame(0, [BLOCK_ONE])),
      repeat(4, (i) => motionFrame(0, i, [BLOCK_ONE])),
      repeat(8, () => buildFrame(0, [BLOCK_ONE, BLOCK_TWO]))
    );

    const spans = segmentSpans(frames);
    expect(spans.map((span) => span.kind)).toEqual([
      "stable",
      "motion",
      "stable",
      "motion",
      "stable"
    ]);
    expect(spans[0].endIndex).toBe(5);
    // Motion spans absorb the first settled frame (the boundary into stability
    // is itself a big diff), so stable spans start one frame late — that is
    // expected and the representative frame still lands inside the settled span.
    expect(spans[2].startIndex).toBeGreaterThanOrEqual(10);
    expect(spans[2].startIndex).toBeLessThanOrEqual(11);
  });

  it("absorbs a one-frame stable blip inside a motion burst", () => {
    const frames = sequence(
      repeat(5, () => makeFrame(0)),
      repeat(3, (i) => motionFrame(0, i)),
      [buildFrame(0, [BLOCK_ONE])],
      repeat(3, (i) => motionFrame(0, i + 7, [BLOCK_ONE])),
      repeat(6, () => buildFrame(0, [BLOCK_ONE]))
    );

    const spans = segmentSpans(frames);
    expect(spans.map((span) => span.kind)).toEqual(["stable", "motion", "stable"]);
  });
});

describe("silhouette masks", () => {
  it("recovers the placed block via background subtraction (minus filtered corners)", () => {
    const background = makeFrame(0);
    const placed = buildFrame(1, [BLOCK_ONE]);
    const mask = computeSilhouette(placed, background, 28);

    // Interior pixels of the block are foreground.
    expect(mask[(BLOCK_ONE.y + 2) * WIDTH + BLOCK_ONE.x + 3]).toBe(1);
    // Background stays background.
    expect(mask[0]).toBe(0);
    expect(mask[(HEIGHT - 1) * WIDTH + (WIDTH - 1)]).toBe(0);
    // Majority filter trims exactly the four 4-neighbour corners of the rectangle.
    const blockArea = BLOCK_ONE.w * BLOCK_ONE.h;
    expect(maskForegroundRatio(mask)).toBeCloseTo((blockArea - 4) / (WIDTH * HEIGHT), 5);
  });

  it("drops isolated single-pixel noise via the majority filter", () => {
    const noisy = new Uint8Array(WIDTH * HEIGHT);
    noisy[5 * WIDTH + 5] = 1;
    noisy[9 * WIDTH + 20] = 1;
    const filtered = majorityFilter(noisy, WIDTH, HEIGHT);
    expect(maskForegroundRatio(filtered)).toBe(0);
  });

  it("measures growth between consecutive step masks", () => {
    const background = makeFrame(0);
    const stepOne = computeSilhouette(buildFrame(1, [BLOCK_ONE]), background, 28);
    const stepTwo = computeSilhouette(buildFrame(2, [BLOCK_ONE, BLOCK_TWO]), background, 28);
    const delta = maskDeltaRatio(stepTwo, stepOne);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeCloseTo((BLOCK_TWO.w * BLOCK_TWO.h - 4) / (WIDTH * HEIGHT), 5);
  });
});

describe("measured step detection", () => {
  it("turns stable spans into candidate steps with silhouette evidence and confidence", () => {
    const frames = sequence(
      repeat(6, () => makeFrame(0)),
      repeat(4, (i) => motionFrame(0, i)),
      repeat(8, () => buildFrame(0, [BLOCK_ONE])),
      repeat(4, (i) => motionFrame(0, i, [BLOCK_ONE])),
      repeat(8, () => buildFrame(0, [BLOCK_ONE, BLOCK_TWO]))
    );

    const { steps, backgroundIndex } = detectMeasuredSteps(frames);
    expect(steps).toHaveLength(3);
    expect(backgroundIndex).toBe(2);

    const [baseline, first, second] = steps;
    expect(baseline.baseline).toBe(true);
    expect(baseline.needsHumanReview).toBe(false);
    expect(maskForegroundRatio(baseline.mask)).toBe(0);

    expect(first.baseline).toBe(false);
    expect(first.foregroundRatio).toBeCloseTo(
      (BLOCK_ONE.w * BLOCK_ONE.h - 4) / (WIDTH * HEIGHT),
      5
    );
    expect(first.precedingMotionPeak).toBeGreaterThan(
      DEFAULT_SEGMENTATION_OPTIONS.enterMotionChangedFraction
    );
    expect(first.confidence).toBeGreaterThanOrEqual(
      DEFAULT_SEGMENTATION_OPTIONS.reviewConfidenceThreshold
    );
    expect(first.needsHumanReview).toBe(false);
    // Representative frame sits inside the settled span.
    expect(first.representativeIndex).toBeGreaterThanOrEqual(first.startIndex);
    expect(first.representativeIndex).toBeLessThanOrEqual(first.endIndex);

    expect(second.foregroundRatio).toBeGreaterThan(first.foregroundRatio);
    expect(second.silhouetteDeltaRatio).toBeGreaterThan(0);
    expect(second.needsHumanReview).toBe(false);
  });

  it("flags a weak step (short stability, tiny motion, no silhouette change) for human review", () => {
    const blip: Rect = { x: 12, y: 0, w: 2, h: 18 };
    const frames = sequence(
      repeat(6, () => makeFrame(0)),
      [buildFrame(0, [blip])],
      repeat(3, () => makeFrame(0))
    );

    const { steps } = detectMeasuredSteps(frames);
    const candidates = steps.filter((step) => !step.baseline);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].silhouetteDeltaRatio).toBe(0);
    expect(candidates[0].confidence).toBeLessThan(
      DEFAULT_SEGMENTATION_OPTIONS.reviewConfidenceThreshold
    );
    expect(candidates[0].needsHumanReview).toBe(true);
  });

  it("is deterministic: identical input yields identical output", () => {
    const make = () =>
      sequence(
        repeat(5, () => makeFrame(0)),
        repeat(3, (i) => motionFrame(0, i)),
        repeat(6, () => buildFrame(0, [BLOCK_ONE]))
      );
    const a = detectMeasuredSteps(make());
    const b = detectMeasuredSteps(make());
    expect(JSON.stringify(a, (key, value) => (value instanceof Uint8Array ? [...value] : value)))
      .toBe(
        JSON.stringify(b, (key, value) => (value instanceof Uint8Array ? [...value] : value))
      );
  });
});

describe("PNG round trips (pngjs, no native deps)", () => {
  it("round-trips a grayscale frame", () => {
    const frame = buildFrame(3, [BLOCK_ONE]);
    const decoded = decodePngToGrayFrame(encodeGrayFrameToPng(frame), 3);
    expect(decoded.width).toBe(WIDTH);
    expect(decoded.height).toBe(HEIGHT);
    expect([...decoded.pixels]).toEqual([...frame.pixels]);
  });

  it("round-trips a silhouette mask", () => {
    const background = makeFrame(0);
    const mask = computeSilhouette(buildFrame(1, [BLOCK_ONE]), background, 28);
    const { mask: decoded, width, height } = decodeMaskPng(encodeMaskToPng(mask, WIDTH, HEIGHT));
    expect(width).toBe(WIDTH);
    expect(height).toBe(HEIGHT);
    expect([...decoded]).toEqual([...mask]);
  });
});

describe("adaptive sampling rate", () => {
  it("targets the analysis budget and clamps to sane bounds", () => {
    expect(planAdaptiveFps(436)).toBe(1.5);
    expect(planAdaptiveFps(10)).toBe(4);
    expect(planAdaptiveFps(36000)).toBe(0.25);
    expect(planAdaptiveFps(0)).toBe(1);
    expect(planAdaptiveFps(Number.NaN)).toBe(1);
  });
});

describe("deterministic measured draft", () => {
  function payloadStep(
    index: number,
    overrides: Partial<MeasuredTimelineStepPayload> = {}
  ): MeasuredTimelineStepPayload {
    return {
      index,
      startSeconds: index * 10,
      endSeconds: index * 10 + 5,
      representativeSeconds: index * 10 + 2,
      stabilitySeconds: 5,
      precedingMotionPeak: 0.2,
      intraSpanMeanChangedFraction: 0,
      foregroundRatio: 0.05,
      silhouetteDeltaRatio: 0.02,
      confidence: 0.8,
      confidenceParts: { stability: 1, motion: 1, quiet: 1, delta: 1 },
      needsHumanReview: false,
      baseline: index === 0,
      representativeFrameDataUrl: "data:image/jpeg;base64,",
      silhouetteDataUrl: "data:image/png;base64,",
      ...overrides
    };
  }

  it("skips the baseline and maps steps to attach actions with evidence", () => {
    const timeline: MeasuredTimelinePayload = {
      videoId: "WDtC_9se3ds",
      sourceUrl: "https://www.youtube.com/watch?v=WDtC_9se3ds",
      durationSeconds: 436,
      analysisFps: 1.5,
      analysisFrameCount: 654,
      analysisWidth: 96,
      analysisHeight: 54,
      motionSpanCount: 2,
      stableSpanCount: 3,
      reviewConfidenceThreshold: 0.55,
      steps: [
        payloadStep(0),
        payloadStep(1),
        payloadStep(2, { needsHumanReview: true, confidence: 0.3 })
      ],
      generatedAt: "2026-06-09T00:00:00.000Z"
    };

    const steps = stepsFromMeasuredTimeline(timeline);
    expect(steps).toHaveLength(2);
    expect(steps[0].action).toBe("place");
    expect(steps[1].action).toBe("connect");
    expect(steps[0].timestamp).toBe("0:12");
    expect(steps[1].measured?.needsHumanReview).toBe(true);
    expect(steps[1].measured?.humanAccepted).toBeUndefined();
    expect(steps[0].evidence?.timestamps).toEqual(["0:10", "0:12", "0:15"]);
  });
});
