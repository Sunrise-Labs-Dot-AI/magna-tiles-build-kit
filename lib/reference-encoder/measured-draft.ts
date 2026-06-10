/**
 * Deterministic conversion from a measured ingestion timeline to reviewable
 * timeline steps. This is the no-LLM path: titles and notes are templated from
 * measured numbers only, and every step carries its silhouette evidence.
 */
import { secondsToTimestamp } from "./timecode";
import type {
  MeasuredStepEvidence,
  MeasuredTimelinePayload,
  MeasuredTimelineStepPayload,
  ReferenceEncodingStep
} from "./types";

export function measuredStepToEvidence(step: MeasuredTimelineStepPayload): MeasuredStepEvidence {
  return {
    startSeconds: step.startSeconds,
    endSeconds: step.endSeconds,
    representativeSeconds: step.representativeSeconds,
    stabilitySeconds: step.stabilitySeconds,
    precedingMotionPeak: step.precedingMotionPeak,
    intraSpanMeanChangedFraction: step.intraSpanMeanChangedFraction,
    foregroundRatio: step.foregroundRatio,
    silhouetteDeltaRatio: step.silhouetteDeltaRatio,
    confidence: step.confidence,
    confidenceParts: step.confidenceParts,
    needsHumanReview: step.needsHumanReview,
    baseline: step.baseline,
    representativeFrameDataUrl: step.representativeFrameDataUrl,
    silhouetteDataUrl: step.silhouetteDataUrl
  };
}

export function measuredStepToEncodingStep(
  step: MeasuredTimelineStepPayload,
  ordinal: number
): ReferenceEncodingStep {
  const range = `${secondsToTimestamp(step.startSeconds)}–${secondsToTimestamp(step.endSeconds)}`;
  return {
    id: `measured-${step.index}`,
    timestamp: secondsToTimestamp(step.representativeSeconds),
    action: ordinal === 1 ? "place" : "connect",
    title: `Measured step ${ordinal}: placement settled (${range})`,
    notes: [
      `Stable for ${step.stabilitySeconds.toFixed(1)}s after motion peaking at ${(step.precedingMotionPeak * 100).toFixed(1)}% changed pixels.`,
      `Silhouette covers ${(step.foregroundRatio * 100).toFixed(1)}% of the frame (${(step.silhouetteDeltaRatio * 100).toFixed(2)}% changed vs previous step).`,
      "Review the frame + silhouette, then map this to the actual attach action."
    ].join(" "),
    evidence: {
      timestamps: [
        secondsToTimestamp(step.startSeconds),
        secondsToTimestamp(step.representativeSeconds),
        secondsToTimestamp(step.endSeconds)
      ],
      visualCues: ["motion settled", "frame differencing", "background-subtraction silhouette"]
    },
    measured: measuredStepToEvidence(step)
  };
}

/**
 * All non-baseline measured steps as draft timeline steps, in video order.
 * Purely deterministic; used directly by the UI and as the measured fallback
 * when no model key is configured.
 */
export function stepsFromMeasuredTimeline(
  timeline: MeasuredTimelinePayload
): ReferenceEncodingStep[] {
  return timeline.steps
    .filter((step) => !step.baseline)
    .map((step, position) => measuredStepToEncodingStep(step, position + 1));
}
