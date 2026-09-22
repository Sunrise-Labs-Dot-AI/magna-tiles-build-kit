export type TileShape =
  | "small-square"
  | "large-square"
  | "xl-square"
  | "equilateral-triangle"
  | "right-triangle"
  | "isosceles-triangle";

export type BuildFamily =
  | "castle"
  | "house"
  | "tower"
  | "bridge"
  | "rocket"
  | "animal"
  | "aircraft"
  | "ramp";

export type InventoryPreset = "classic-100" | "builder-xl";

export type Severity = "error" | "warning" | "info";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  x: number;
  y: number;
  z: number;
}

export interface TileBasis {
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
}

export interface TileSpec {
  shape: TileShape;
  label: string;
  shortLabel: string;
  edgeLength: number;
  width: number;
  height: number;
  maxEdges: number;
}

export type Inventory = Record<TileShape, number>;

export interface TileInstance {
  id: string;
  shape: TileShape;
  color: string;
  position: Vec3;
  rotation: Rotation;
  basis?: TileBasis;
  step: number;
  role: string;
  mirrored?: boolean;
  subassemblyId?: string;
  parentTileId?: string;
  parentEdge?: number;
  childEdge?: number;
  foldAngle?: number;
  root?: boolean;
}

export interface MagneticConnection {
  fromTileId: string;
  fromEdge: number;
  toTileId: string;
  toEdge: number;
  kind: "edge" | "support";
}

export interface BuildBounds {
  width: number;
  height: number;
  depth: number;
}

export interface BuildGraph {
  id: string;
  prompt: string;
  title: string;
  family: BuildFamily;
  inventoryPreset?: InventoryPreset;
  seed: number;
  summary: string;
  tiles: TileInstance[];
  connections: MagneticConnection[];
  bounds: BuildBounds;
}

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  detail: string;
  tileIds?: string[];
}

export interface StabilityReport {
  status: "pass" | "warning" | "error";
  issues: ValidationIssue[];
  usedInventory: Inventory;
  remainingInventory: Inventory;
}

export interface AssemblyStep {
  step: number;
  title: string;
  instruction: string;
  tileIds: string[];
  tileCounts: Partial<Inventory>;
}

export interface GeneratedBuildResponse {
  physics?: { passed: boolean; reasons: string[] };
  build: BuildGraph;
  validation: StabilityReport;
  instructions: AssemblyStep[];
}

export interface BuildLibraryItem {
  id: string;
  title: string;
  prompt: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  estimatedMinutes: number;
  status: "draft" | "geometry-valid" | "engine-valid" | "engine-fail-pending-reauthoring" | "review-ready" | "human-reviewed";
  tags: string[];
}

export interface PromptProfile {
  family: BuildFamily;
  size: "small" | "medium" | "tall" | "wide";
  palette: string[];
  accents: string[];
  title: string;
  seed: number;
}
