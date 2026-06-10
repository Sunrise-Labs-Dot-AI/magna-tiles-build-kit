import type { Inventory, TileShape } from "@/lib/magnetic-tiles/types";

export type AssemblyAction =
  | "place"
  | "connect"
  | "build-subassembly"
  | "fold"
  | "rotate"
  | "stand-up"
  | "brace"
  | "adjust"
  | "balance-check";

export interface ReferenceVideoSource {
  url: string;
  videoId: string;
  embedUrl: string;
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnailUrl: string;
  providerName: string;
}

export interface ReferenceFrameCandidate {
  timestamp: string;
  seconds: number;
  mimeType: "image/jpeg";
  dataUrl: string;
  priorityScore: number;
  selectionReason: string;
  selectedByDefault: boolean;
  landmarkRole?: "bill-of-materials";
}

/**
 * Measured (pixel-derived) evidence attached to a timeline step. Every field
 * is computed deterministically from real video frames by
 * lib/reference-encoder/segmentation.ts — never authored by a model.
 */
export interface MeasuredStepEvidence {
  startSeconds: number;
  endSeconds: number;
  representativeSeconds: number;
  stabilitySeconds: number;
  precedingMotionPeak: number;
  intraSpanMeanChangedFraction: number;
  foregroundRatio: number;
  silhouetteDeltaRatio: number;
  confidence: number;
  confidenceParts: {
    stability: number;
    motion: number;
    quiet: number;
    delta: number;
  };
  needsHumanReview: boolean;
  baseline: boolean;
  /** Set by a human reviewer to clear a needs-review flag. Never set by code. */
  humanAccepted?: boolean;
  representativeFrameDataUrl?: string;
  silhouetteDataUrl?: string;
}

export interface ReferenceEncodingStep {
  id: string;
  timestamp: string;
  action: AssemblyAction;
  title: string;
  notes: string;
  subassemblyId?: string;
  tileCounts?: Partial<Inventory>;
  pieceEstimateConfidence?: "low" | "medium" | "high";
  learnedTechnique?: string;
  dependsOn?: string[];
  evidence?: {
    timestamps: string[];
    overlayText?: string;
    visualCues: string[];
  };
  physicalNotes?: string[];
  measured?: MeasuredStepEvidence;
}

export interface ReferenceMaterialCount {
  label: string;
  count: number;
  notes?: string;
}

export interface ReferenceBuildEncoding {
  source: ReferenceVideoSource;
  status: "draft" | "reviewed";
  buildLabel: string;
  billOfMaterials?: Partial<Inventory>;
  additionalMaterials?: ReferenceMaterialCount[];
  observedTechniques: string[];
  encoderLessons?: string[];
  steps: ReferenceEncodingStep[];
}

export interface ReferenceBuildSegment {
  id: string;
  buildLabel: string;
  startTimestamp: string;
  endTimestamp: string;
  summary: string;
  billOfMaterials?: Partial<Inventory>;
  additionalMaterials?: ReferenceMaterialCount[];
  observedTechniques: string[];
  steps: ReferenceEncodingStep[];
}

export interface ReferenceBuildCollection {
  source: ReferenceVideoSource;
  status: "draft" | "reviewed";
  collectionLabel: string;
  encoderLessons?: string[];
  segments: ReferenceBuildSegment[];
}

/**
 * Client-safe serialized form of a measured ingestion run (lib/reference-encoder/ingest.ts).
 * Image evidence is inlined as data URLs so the review UI needs no extra file routes.
 */
export interface MeasuredTimelineStepPayload {
  index: number;
  startSeconds: number;
  endSeconds: number;
  representativeSeconds: number;
  stabilitySeconds: number;
  precedingMotionPeak: number;
  intraSpanMeanChangedFraction: number;
  foregroundRatio: number;
  silhouetteDeltaRatio: number;
  confidence: number;
  confidenceParts: {
    stability: number;
    motion: number;
    quiet: number;
    delta: number;
  };
  needsHumanReview: boolean;
  baseline: boolean;
  representativeFrameDataUrl: string;
  silhouetteDataUrl: string;
}

export interface MeasuredTimelinePayload {
  videoId: string;
  sourceUrl: string;
  durationSeconds: number;
  analysisFps: number;
  analysisFrameCount: number;
  analysisWidth: number;
  analysisHeight: number;
  motionSpanCount: number;
  stableSpanCount: number;
  reviewConfidenceThreshold: number;
  steps: MeasuredTimelineStepPayload[];
  generatedAt: string;
}

export const ASSEMBLY_ACTIONS: AssemblyAction[] = [
  "place",
  "connect",
  "build-subassembly",
  "fold",
  "rotate",
  "stand-up",
  "brace",
  "adjust",
  "balance-check"
];

export const TECHNIQUE_TAGS = [
  "build flat, then fold",
  "make a subassembly",
  "stand up a panel group",
  "brace with side returns",
  "adjust angle for magnet alignment",
  "widen base for balance",
  "use symmetry",
  "temporary hand support"
];

export const REFERENCE_SHAPES: TileShape[] = [
  "small-square",
  "large-square",
  "equilateral-triangle",
  "right-triangle",
  "isosceles-triangle"
];
