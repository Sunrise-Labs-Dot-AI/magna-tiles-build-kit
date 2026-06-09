import type {
  BuildFamily,
  Inventory,
  InventoryPreset,
  MagneticConnection,
  StabilityReport,
  TileInstance,
  TileShape
} from "@/lib/magnetic-tiles/types";

export type BuilderMode = "edge-snap" | "freeform";
export type BuilderDraftStatus =
  | "draft"
  | "geometry-valid"
  | "engine-valid"
  | "engine-fail-pending-reauthoring"
  | "review-ready"
  | "human-reviewed";

export interface BuilderTile extends TileInstance {
  authoredMode: BuilderMode;
  confirmed: boolean;
  sizeOverride?: {
    width: number;
    height: number;
  };
  locked?: boolean;
}

export type BuilderOperation =
  | {
      kind: "add-root";
      shape: TileShape;
      color: string;
    }
  | {
      kind: "edge-snap";
      parentTileId: string;
      parentEdge: number;
      childShape: TileShape;
      childEdge: number;
      foldAngle: number;
      reverse: boolean;
    }
  | {
      kind: "freeform-transform";
      tileId: string;
      dx?: number;
      dy?: number;
      dz?: number;
      drx?: number;
      dry?: number;
      drz?: number;
    }
  | {
      kind: "mirror";
      tileIds: string[];
    };

export interface AuthoredBuildDraft {
  id: string;
  title: string;
  prompt: string;
  family: BuildFamily;
  inventoryPreset: InventoryPreset;
  status: BuilderDraftStatus;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  expectedInventory?: Partial<Inventory>;
  referenceFrameSrcs: string[];
  visualSignoff: boolean;
  tiles: BuilderTile[];
  connections: MagneticConnection[];
}

export interface BuildDraftSummary {
  id: string;
  title: string;
  status: BuilderDraftStatus;
  tileCount: number;
  updatedAt: string;
}

export interface ReviewReadinessReport {
  status: BuilderDraftStatus;
  geometryValid: boolean;
  reviewReady: boolean;
  blockingReasons: string[];
  validation: StabilityReport;
}
