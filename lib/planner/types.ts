import type {
  AssemblyStep,
  BuildGraph,
  InventoryPreset,
  Vec3,
} from "@/lib/magnetic-tiles/types";

export interface DesignBrief {
  prompt: string;
  kind: "racecourse" | "structure";
  lanes: 1 | 2;
  turns: number;
  downhill: boolean;
  unsupportedTerms: string[];
  unlimitedPieces?: boolean;
  inventoryPreset: InventoryPreset;
  car: { width: number; length: number; wheelRadius: number; massKg: number };
}
export interface CourseLane {
  id: string;
  /** Ordered surface coordinates, in inches. Never used to steer the simulation. */
  waypoints: Vec3[];
  width: number;
  surfaceTileIds: string[];
}
export interface DesignCheck {
  code: string;
  label: string;
  status: "pass" | "fail" | "unverified";
  detail: string;
  tileIds?: string[];
}
export interface CarSample {
  time: number;
  position: Vec3;
}
export interface CarTrial {
  /** Absent when rejected before creating a physics world. */
  peakGroundPenetration?: number;
  laneId: string;
  passed: boolean;
  reachedWaypoint: number;
  reason: string;
  samples: CarSample[];
  contactEvidence?: {
    roadContactSteps: number;
    longestContactGapSeconds: number;
    allowedContactGapSeconds: number;
    postRunStructurePassed: boolean;
  };
}
export interface CandidateResult {
  id: string;
  checks: DesignCheck[];
  passed: boolean;
}
export interface DesignResult {
  harness?: import("@/lib/harness/types").HarnessResult;
  brief: DesignBrief;
  build: BuildGraph;
  instructions: AssemblyStep[];
  lanes: CourseLane[];
  checks: DesignCheck[];
  trials: CarTrial[];
  candidates: CandidateResult[];
  status: "simulation-passed" | "needs-repair";
  model: string;
}
