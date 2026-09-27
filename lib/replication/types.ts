import type {
  AssemblyStep,
  BuildGraph,
  Inventory,
  TileBasis,
  Vec3,
} from "@/lib/magnetic-tiles/types";
import type { CourseLane, DesignBrief } from "@/lib/planner/types";

export type Verdict = "pass" | "fail" | "unverified";
export interface Check {
  status: Verdict;
  detail: string;
}
export interface StagePose {
  id: string;
  frameId: string;
  title: string;
  instruction: string;
  tileIds: string[];
  /** Source-stage contract: these earlier modules are already installed obstacles. */
  installedStageIds?: string[];
  /** Each snapshot has its own pose; never combine frames across construction stages. */
  transform?: { basis: TileBasis; translation: Vec3 };
  support: "released" | "held";
}
export interface Replica {
  id: string;
  sourceId: string;
  title: string;
  build: BuildGraph;
  inventory: Inventory;
  bomFrameId: string;
  stages: StagePose[];
  uncertainties: {
    id: string;
    tileIds: string[];
    frameIds: string[];
    detail: string;
  }[];
  materialQuestions: string[];
  construction?: import("./construction").ConstructionStage[];
  route?: {
    lanes: CourseLane[];
    brief: DesignBrief;
    sourceFrameId: string;
    evidence: string;
  };
}
export interface Landmark {
  id: string;
  tileId: string;
  vertex: number;
  pixel: [number, number];
  uncertaintyPx: number;
  use: "camera" | "check";
}
export interface Observation {
  id: string;
  replicaId: string;
  frameId: string;
  stageId: string;
  partition: "fit" | "holdout";
  width: number;
  height: number;
  landmarks: Landmark[];
  /** Initial camera search orientation; geometry cannot be changed by camera fitting. */
  viewDirection: Vec3;
  /** Independently observed camera region, expressed in this stage's coordinates. */
  cameraRegion?: { tableY: number; horizontalDirection: Vec3 };
}
export interface Camera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  focal: number;
  cx: number;
  cy: number;
}
export interface ProjectionResult {
  id: string;
  frameId: string;
  partition: Observation["partition"];
  status: Verdict;
  detail: string;
  camera: Camera | null;
  cameraRegion: Check;
  cameraAnchors: number;
  checkLandmarks: number;
  rmsPx: number | null;
  maxPx: number | null;
  sourceDiagonalPx: number;
  residuals: {
    id: string;
    use: Landmark["use"];
    observed: [number, number];
    projected: [number, number];
    errorPx: number;
    uncertaintyPx: number;
  }[];
}
export interface ReplicaReport {
  id: string;
  fingerprint: string;
  validationCodeHash: string;
  generatedAt: string;
  checks: Record<
    | "source"
    | "inventory"
    | "fidelity"
    | "materials"
    | "geometry"
    | "release"
    | "settledShape"
    | "assembly"
    | "function",
    Check
  >;
  replication: "not-verified" | "simulation-verified";
  projections: ProjectionResult[];
  releases: {
    seed: number;
    status: Verdict;
    peakDisplacement: number;
    finalDisplacement: number;
    finalSpeed: number;
    linearSpeed: number;
    angularSpeed: number;
    settledSteps: number;
    poppedJoints: string[];
    settledProjections: ProjectionResult[];
  }[];
  stages: {
    id: string;
    status: Verdict;
    detail: string;
    displacement: number | null;
  }[];
  instructions: AssemblyStep[];
  constructionPaths: import("./construction").ConstructionResult[];
  assemblySimulation: import("./assembly").AssemblyResult[];
  holdoutCoverage: Check;
  carTrials: import("@/lib/planner/types").CarTrial[];
}
