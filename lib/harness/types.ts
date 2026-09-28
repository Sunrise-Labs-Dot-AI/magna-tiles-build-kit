import type { BuildGraph, InventoryPreset } from "@/lib/magnetic-tiles/types";
import type { AssemblyStep } from "@/lib/magnetic-tiles/types";

export type StructureKind = "tower" | "container" | "tunnel" | "staircase";
export type Axis = "x" | "y" | "z";
export interface Interval {
  min: number;
  max: number;
}
/** Nominal cells are 3 inches. Physical envelope limits are separate and exact. */
export interface IntentContract {
  version: 1;
  prompt: string;
  kind: StructureKind;
  cells: { width: number; height: number; depth: number; steps: number };
  fixed: Array<"width" | "height" | "depth" | "steps">;
  limits: Partial<Record<Axis, Interval>>;
  maxPieces: number | null;
  unlimitedPieces: boolean;
  /** Explicit stories/levels require intermediate floors, not just a tall hollow shell. */
  requireFloors: boolean;
  passage: { width: number; height: number };
  inventoryPreset: InventoryPreset;
  unresolved: string[];
  assumptions: string[];
}
export interface ConstructionProgram {
  kind: StructureKind;
  width: number;
  height: number;
  depth: number;
  steps: number;
  reinforcement: "shell" | "diaphragms" | "rigid-panels" | "portal-base";
  assembly?: "layers" | "stable-prefix";
}
export interface Evidence {
  id: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
  repair?: "reinforce" | "rigid-panels" | "sequence" | "budget" | "intent";
}
export interface ReleaseTrial {
  seed: number;
  passed: boolean;
  peakDisplacement: number;
  finalDisplacement: number;
  peakGroundPenetration: number;
  settledSteps: number;
  failedRequirements: string[];
  intentEvidence: Evidence[];
}
export interface Evaluation {
  passed: boolean;
  evidence: Evidence[];
  trials: ReleaseTrial[];
  stages: { step: number; tileCount: number; passed: boolean }[];
  /** Bound to the complete geometry and contract, not a stored success flag. */
  fingerprint: string;
}
export interface SearchAttempt {
  index: number;
  program: ConstructionProgram;
  triggeredBy: string[];
  evaluation: Evaluation;
}
export interface HarnessResult {
  contract: IntentContract;
  status:
    | "solved"
    | "unsupported"
    | "infeasible"
    | "budget-exhausted"
    | "search-exhausted";
  build: BuildGraph | null;
  instructions: AssemblyStep[];
  evaluation: Evaluation | null;
  attempts: SearchAttempt[];
  explanation: string;
  model: string;
}
