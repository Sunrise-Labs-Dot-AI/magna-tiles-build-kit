export { TILE_THICKNESS } from "@/lib/magnetic-tiles/catalog";

export const ENGINE_UNITS_PER_METER = 10;

// ASSUMED + CALIBRATED: uniform plastic + magnet assembly mass per catalog small square.
// Tuned only against the calibration fixtures in tests/engine-calibration.test.ts.
export const TILE_MASS_KG = 0.026;

// ASSUMED + CALIBRATED: finite magnetic edge hold threshold before a hinge is removed.
// Real Magna-Tiles vary by age and production batch; replace this with measured pull-force data when available.
export const MAGNET_HOLD_FORCE = 5.8;

// ASSUMED + CALIBRATED: surface interaction constants for glossy plastic on Magna-Tiles.
export const TILE_FRICTION = 0.82;
export const BALL_FRICTION = 0.34;
export const GROUND_FRICTION = 0.95;

export const HINGE_MIN_ANGLE = -Math.PI;
export const HINGE_MAX_ANGLE = Math.PI;
export const SIMULATION_TIMESTEP_SECONDS = 1 / 120;
export const SIMULATION_MAX_STEPS = 900;
export const SETTLED_LINEAR_SPEED = 0.035;
export const SETTLED_ANGULAR_SPEED = 0.08;
export const SETTLED_REQUIRED_STEPS = 90;
export const DROP_HEIGHT = 0.28;
export const MAX_STANDING_DISPLACEMENT = 0.95;
export const COLLAPSE_DISPLACEMENT = 2.35;
export const EDGE_BREAK_STIFFNESS = 16;
export const EDGE_BREAK_DAMPING = 0.45;
export const EDGE_BREAK_DISTANCE = 0.42;
export const ROLL_BALL_RADIUS = 0.34;
export const ROLL_TEST_SETTLE_STEPS = 240;
export const ROLL_TEST_MAX_STEPS = 1200;
export const ROLL_TEST_OFF_SURFACE_MARGIN = 1.15;
