/**
 * Measured step detection for reference build videos.
 *
 * Pure, deterministic TypeScript: frame-differencing segmentation that splits a
 * sampled frame sequence into MOTION spans (hands building) and STABLE spans
 * (a placement settled), then turns each stable span into a candidate step with
 * a foreground silhouette mask computed by background subtraction against the
 * first stable frame.
 *
 * Per research/diagnosis.md this module is the measured signal v1 never had.
 * No LLM is involved anywhere in this file; every number is computed from
 * pixels and is unit-testable on synthetic frames.
 */

export interface GrayFrame {
  /** Presentation time of the frame within the video, in seconds. */
  seconds: number;
  width: number;
  height: number;
  /** Row-major grayscale pixels, one byte per pixel (0..255). */
  pixels: Uint8Array;
}

export interface FramePairDiff {
  /** Diff between frames[index - 1] and frames[index]. */
  index: number;
  /** Mean absolute pixel difference normalized to 0..1. */
  meanAbsDiff: number;
  /** Fraction of pixels whose absolute difference exceeds pixelDeltaThreshold. */
  changedFraction: number;
}

export interface SegmentationOptions {
  /** Per-pixel delta (0..255) above which a pixel counts as "changed". */
  pixelDeltaThreshold: number;
  /** Hysteresis: a boundary enters MOTION at/above this changed fraction. */
  enterMotionChangedFraction: number;
  /** Hysteresis: a MOTION run exits back to STABLE below this changed fraction. */
  exitMotionChangedFraction: number;
  /** Stable spans shorter than this are absorbed into surrounding motion. */
  minStableSeconds: number;
  /** Motion spans shorter than this are treated as sampling noise. */
  minMotionSeconds: number;
  /** Per-pixel delta (0..255) vs the background frame for silhouette masks. */
  silhouettePixelThreshold: number;
  /** Steps below this confidence are flagged "needs human review". */
  reviewConfidenceThreshold: number;
}

export const DEFAULT_SEGMENTATION_OPTIONS: SegmentationOptions = {
  pixelDeltaThreshold: 14,
  enterMotionChangedFraction: 0.05,
  exitMotionChangedFraction: 0.025,
  minStableSeconds: 1.25,
  minMotionSeconds: 0.6,
  silhouettePixelThreshold: 28,
  reviewConfidenceThreshold: 0.55
};

export interface MotionSpan {
  kind: "motion" | "stable";
  /** Inclusive first frame index of the span. */
  startIndex: number;
  /** Inclusive last frame index of the span. */
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  /** Mean changed fraction over the boundaries inside the span (0 for single-frame spans). */
  meanChangedFraction: number;
  /** Peak changed fraction over the boundaries inside the span. */
  peakChangedFraction: number;
}

export interface StepConfidenceParts {
  /** How long the placement stayed settled (longer = more trustworthy). */
  stability: number;
  /** How much motion preceded the settle (placement evidence). */
  motion: number;
  /** How quiet the stable span itself is (camera/hands gone). */
  quiet: number;
  /** How much the silhouette changed vs the previous step (the build grew). */
  delta: number;
}

export interface MeasuredStepDetection {
  index: number;
  startIndex: number;
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  representativeIndex: number;
  representativeSeconds: number;
  stabilitySeconds: number;
  /** Peak changed fraction of the motion span immediately before this step. */
  precedingMotionPeak: number;
  /** Duration of the motion span immediately before this step. */
  precedingMotionSeconds: number;
  /** Mean changed fraction inside the stable span (residual jitter). */
  intraSpanMeanChangedFraction: number;
  /** Binary silhouette (1 = foreground) vs the first stable frame. */
  mask: Uint8Array;
  /** Fraction of mask pixels that are foreground. */
  foregroundRatio: number;
  /** Fraction of mask pixels that differ from the previous step's mask. */
  silhouetteDeltaRatio: number;
  confidence: number;
  confidenceParts: StepConfidenceParts;
  needsHumanReview: boolean;
  /** True for the first stable span: the background reference, not a build step. */
  baseline: boolean;
}

export interface MeasuredDetectionResult {
  spans: MotionSpan[];
  steps: MeasuredStepDetection[];
  /** Frame index of the background reference (first stable frame), or null. */
  backgroundIndex: number | null;
}

export function diffFrames(
  a: GrayFrame,
  b: GrayFrame,
  pixelDeltaThreshold: number
): { meanAbsDiff: number; changedFraction: number } {
  const length = Math.min(a.pixels.length, b.pixels.length);
  if (!length) return { meanAbsDiff: 0, changedFraction: 0 };

  let total = 0;
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = Math.abs(a.pixels[index] - b.pixels[index]);
    total += delta;
    if (delta > pixelDeltaThreshold) changed += 1;
  }

  return {
    meanAbsDiff: total / length / 255,
    changedFraction: changed / length
  };
}

export function computePairDiffs(
  frames: GrayFrame[],
  options: SegmentationOptions = DEFAULT_SEGMENTATION_OPTIONS
): FramePairDiff[] {
  const diffs: FramePairDiff[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const { meanAbsDiff, changedFraction } = diffFrames(
      frames[index - 1],
      frames[index],
      options.pixelDeltaThreshold
    );
    diffs.push({ index, meanAbsDiff, changedFraction });
  }
  return diffs;
}

/**
 * Split a frame sequence into alternating motion / stable spans.
 *
 * Boundary labels use hysteresis (enter/exit thresholds), then two
 * deterministic merge passes remove sampling noise: motion blips shorter than
 * minMotionSeconds are absorbed into stable, and stable blips shorter than
 * minStableSeconds are absorbed into motion.
 */
export function segmentSpans(
  frames: GrayFrame[],
  options: SegmentationOptions = DEFAULT_SEGMENTATION_OPTIONS
): MotionSpan[] {
  if (!frames.length) return [];
  if (frames.length === 1) {
    return [makeSpan(frames, [], "stable", 0, 0)];
  }

  const diffs = computePairDiffs(frames, options);

  // Label each frame: frame i (i >= 1) takes the hysteresis state of boundary i;
  // frame 0 inherits the first boundary's label.
  const boundaryMotion: boolean[] = [];
  let inMotion = false;
  for (const diff of diffs) {
    if (inMotion) {
      inMotion = diff.changedFraction >= options.exitMotionChangedFraction;
    } else {
      inMotion = diff.changedFraction >= options.enterMotionChangedFraction;
    }
    boundaryMotion.push(inMotion);
  }

  const frameLabels: Array<"motion" | "stable"> = new Array(frames.length);
  frameLabels[0] = boundaryMotion[0] ? "motion" : "stable";
  for (let index = 1; index < frames.length; index += 1) {
    frameLabels[index] = boundaryMotion[index - 1] ? "motion" : "stable";
  }

  let spans = groupLabels(frames, diffs, frameLabels);
  spans = absorbShortSpans(frames, diffs, spans, "motion", options.minMotionSeconds);
  spans = absorbShortSpans(frames, diffs, spans, "stable", options.minStableSeconds);
  return spans;
}

/**
 * Compute a binary foreground silhouette by background subtraction, then a
 * 3x3 majority filter to drop isolated compression-noise pixels.
 */
export function computeSilhouette(
  frame: GrayFrame,
  background: GrayFrame,
  silhouettePixelThreshold: number
): Uint8Array {
  const length = Math.min(frame.pixels.length, background.pixels.length);
  const raw = new Uint8Array(frame.width * frame.height);
  for (let index = 0; index < length; index += 1) {
    raw[index] =
      Math.abs(frame.pixels[index] - background.pixels[index]) > silhouettePixelThreshold ? 1 : 0;
  }
  return majorityFilter(raw, frame.width, frame.height);
}

export function maskForegroundRatio(mask: Uint8Array): number {
  if (!mask.length) return 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) count += mask[index];
  return count / mask.length;
}

export function maskDeltaRatio(current: Uint8Array, previous: Uint8Array): number {
  const length = Math.min(current.length, previous.length);
  if (!length) return 0;
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (current[index] !== previous[index]) changed += 1;
  }
  return changed / length;
}

export function scoreStepConfidence(parts: StepConfidenceParts, baseline: boolean): number {
  if (baseline) {
    return clamp01(parts.stability * 0.6 + parts.quiet * 0.4);
  }
  return clamp01(
    parts.stability * 0.35 + parts.motion * 0.25 + parts.quiet * 0.2 + parts.delta * 0.2
  );
}

/**
 * Full measured detection: motion/stable segmentation, then each stable span
 * becomes a candidate step with silhouette evidence and a confidence score.
 */
export function detectMeasuredSteps(
  frames: GrayFrame[],
  optionOverrides: Partial<SegmentationOptions> = {}
): MeasuredDetectionResult {
  const options: SegmentationOptions = { ...DEFAULT_SEGMENTATION_OPTIONS, ...optionOverrides };
  const spans = segmentSpans(frames, options);
  const stableSpans = spans.filter((span) => span.kind === "stable");
  if (!stableSpans.length) {
    return { spans, steps: [], backgroundIndex: null };
  }

  const backgroundSpan = stableSpans[0];
  const backgroundIndex = representativeIndexOf(backgroundSpan);
  const background = frames[backgroundIndex];

  const steps: MeasuredStepDetection[] = [];
  let previousMask: Uint8Array = new Uint8Array(background.width * background.height);

  for (const [stepNumber, span] of stableSpans.entries()) {
    const spanPosition = spans.indexOf(span);
    const previousSpan = spanPosition > 0 ? spans[spanPosition - 1] : null;
    const precedingMotion = previousSpan?.kind === "motion" ? previousSpan : null;

    const representativeIndex = representativeIndexOf(span);
    const representative = frames[representativeIndex];
    const baseline = stepNumber === 0;

    const mask = computeSilhouette(representative, background, options.silhouettePixelThreshold);
    const foregroundRatio = maskForegroundRatio(mask);
    const silhouetteDeltaRatio = maskDeltaRatio(mask, previousMask);

    const stabilitySeconds = spanDurationSeconds(frames, span);
    const precedingMotionSeconds = precedingMotion
      ? spanDurationSeconds(frames, precedingMotion)
      : 0;

    const confidenceParts: StepConfidenceParts = {
      stability: clamp01(stabilitySeconds / 4),
      motion: precedingMotion ? clamp01(precedingMotion.peakChangedFraction / 0.15) : 0,
      quiet: clamp01(
        1 - span.meanChangedFraction / Math.max(options.exitMotionChangedFraction, 1e-6)
      ),
      delta: clamp01(silhouetteDeltaRatio / 0.01)
    };
    const confidence = scoreStepConfidence(confidenceParts, baseline);

    steps.push({
      index: stepNumber,
      startIndex: span.startIndex,
      endIndex: span.endIndex,
      startSeconds: span.startSeconds,
      endSeconds: span.endSeconds,
      representativeIndex,
      representativeSeconds: representative.seconds,
      stabilitySeconds,
      precedingMotionPeak: precedingMotion?.peakChangedFraction ?? 0,
      precedingMotionSeconds,
      intraSpanMeanChangedFraction: span.meanChangedFraction,
      mask,
      foregroundRatio,
      silhouetteDeltaRatio,
      confidence,
      confidenceParts,
      needsHumanReview: baseline ? false : confidence < options.reviewConfidenceThreshold,
      baseline
    });

    previousMask = mask;
  }

  return { spans, steps, backgroundIndex };
}

function representativeIndexOf(span: MotionSpan): number {
  return Math.floor((span.startIndex + span.endIndex) / 2);
}

function spanDurationSeconds(frames: GrayFrame[], span: MotionSpan): number {
  const interval = medianFrameInterval(frames);
  return span.endSeconds - span.startSeconds + interval;
}

function medianFrameInterval(frames: GrayFrame[]): number {
  if (frames.length < 2) return 1;
  const deltas = [];
  for (let index = 1; index < frames.length; index += 1) {
    deltas.push(frames[index].seconds - frames[index - 1].seconds);
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)] || 1;
}

function groupLabels(
  frames: GrayFrame[],
  diffs: FramePairDiff[],
  labels: Array<"motion" | "stable">
): MotionSpan[] {
  const spans: MotionSpan[] = [];
  let start = 0;
  for (let index = 1; index <= labels.length; index += 1) {
    if (index === labels.length || labels[index] !== labels[start]) {
      spans.push(makeSpan(frames, diffs, labels[start], start, index - 1));
      start = index;
    }
  }
  return spans;
}

function makeSpan(
  frames: GrayFrame[],
  diffs: FramePairDiff[],
  kind: "motion" | "stable",
  startIndex: number,
  endIndex: number
): MotionSpan {
  const inner = diffs.filter((diff) => diff.index > startIndex && diff.index <= endIndex);
  const changedFractions = inner.map((diff) => diff.changedFraction);
  return {
    kind,
    startIndex,
    endIndex,
    startSeconds: frames[startIndex]?.seconds ?? 0,
    endSeconds: frames[endIndex]?.seconds ?? 0,
    meanChangedFraction: changedFractions.length
      ? changedFractions.reduce((sum, value) => sum + value, 0) / changedFractions.length
      : 0,
    peakChangedFraction: changedFractions.length ? Math.max(...changedFractions) : 0
  };
}

function absorbShortSpans(
  frames: GrayFrame[],
  diffs: FramePairDiff[],
  spans: MotionSpan[],
  kindToAbsorb: "motion" | "stable",
  minSeconds: number
): MotionSpan[] {
  if (spans.length <= 1 || minSeconds <= 0) return spans;

  const relabeled = spans.map((span) => {
    if (span.kind !== kindToAbsorb) return span;
    // Never absorb a span at the sequence edge into nothing: only interior
    // blips between two spans of the opposite kind are sampling noise.
    const position = spans.indexOf(span);
    const isInterior = position > 0 && position < spans.length - 1;
    if (!isInterior) return span;
    if (spanDurationSeconds(frames, span) >= minSeconds) return span;
    return { ...span, kind: kindToAbsorb === "motion" ? ("stable" as const) : ("motion" as const) };
  });

  // Merge adjacent same-kind spans, recomputing stats from the raw diffs.
  const merged: MotionSpan[] = [];
  for (const span of relabeled) {
    const previous = merged[merged.length - 1];
    if (previous && previous.kind === span.kind) {
      merged[merged.length - 1] = makeSpan(
        frames,
        diffs,
        span.kind,
        previous.startIndex,
        span.endIndex
      );
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/** 3x3 majority filter: keep a pixel set only if ≥5 of its 3x3 neighborhood is set. */
export function majorityFilter(mask: Uint8Array, width: number, height: number): Uint8Array {
  const filtered = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let votes = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            votes += mask[ny * width + nx];
          }
        }
      }
      filtered[y * width + x] = votes >= 5 ? 1 : 0;
    }
  }
  return filtered;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
