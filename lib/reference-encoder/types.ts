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
