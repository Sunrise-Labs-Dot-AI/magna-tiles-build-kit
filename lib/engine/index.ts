export { simulate, rollTest, type RollTestResult, type SimulationResult } from "./simulate";
export { gateBuild, type GateBuildResult } from "./gate";
export {
  findRawOverlaps,
  overlapsInvolvingTile,
  assertNoRawOverlaps,
  RawOverlapError,
  RAW_OVERLAP_TOLERANCE,
  type RawOverlap
} from "./overlap";
export {
  MAGNET_HOLD_FORCE,
  TILE_FRICTION,
  TILE_MASS_KG,
  TILE_THICKNESS,
  BALL_FRICTION,
  GROUND_FRICTION
} from "./constants";
export { createEngineWorld, initRapier } from "./rapier-world";
export { createMagneticPhysicsModel, createRollTestPlan, isFunctionalRamp } from "./physics-model";
export type { EngineBuild } from "./build";
