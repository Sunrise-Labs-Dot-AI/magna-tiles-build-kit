import { createEngineWorld, perturbFirstRelease, type EngineState, type EngineWorld } from "../../lib/engine/rapier-world";
import { validateMagneticBuild, type EngineBuild } from "../../lib/engine/build";
import { validateEngineInput } from "../../lib/engine/input";
import { findRawOverlaps, RAW_OVERLAP_TOLERANCE } from "../../lib/engine/overlap";
import { MAX_STANDING_DISPLACEMENT, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED } from "../../lib/engine/constants";
import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { createMagneticPhysicsModel } from "../../lib/engine/physics-model";
import { RigidBodyType } from "../../lib/engine/physics-backend";

// Declared before any run in runs/2026-09-27-loaded-contact-plan.md.
export const CONTACT_CRITERIA = {
  durationSeconds: 7.5, lateStartSeconds: 6.75,
  peakLimit: RAW_OVERLAP_TOLERANCE, lateLimit: .01, displacementLimit: MAX_STANDING_DISPLACEMENT,
  restReportingSteps: 90, selectionPeak: .025, selectionLate: .008,
  peakSpread: .005, lateSpread: .002,
} as const;
export const CONTACT_MATRIX = {
  frequencies: [120, 240, 480], eligibleFrequencies: [120, 240],
  rates: [960, 1920], solvers: [16, 32], seeds: [0, 17, 53], ...CONTACT_CRITERIA,
} as const;
// Separately reviewed before running in runs/2026-09-27-finer-contact-plan.md.
export const FINER_CONTACT_MATRIX = {
  frequencies: [240, 480], rates: [1920, 3840, 7680], candidateCollisionRates: [1920, 3840],
  solvers: [16, 32], seeds: [0, 17, 53], ...CONTACT_CRITERIA,
} as const;
export type ContactExperiment = "loaded" | "finer";

export interface ContactCell { fixture: string; frequency: number; hz: number; solver: number; seed: number }
export interface ContactMatrixTrial extends ContactCell {
  completed: boolean; attemptedSteps: number; integrationSteps: number; simulatedSeconds: number;
  peakPenetration: number; latePenetration: number | null; observedLatePenetration: number | null;
  peakDisplacement: number; restReportingSteps: number | null;
  finalSpeeds: { linear: number; angular: number };
  firstFailure: { reason: string; attemptedStep: number; integrationSteps: number; simulatedSeconds: number } | null;
  invalidState: boolean; terminal: EngineState;
  parameters: { dt: number; frequencyFromERP: number; solver: number; lengthUnit: number; normalizedAllowedLinearError: number; contactERP: number };
  passed: boolean;
}
export const contactCellKey = (cell: ContactCell) => [cell.fixture, cell.frequency, cell.hz, cell.solver, cell.seed].join("/");
const expectedFixtures = new Map(contactMatrixFixtures().map(build => [build.id, {
  build, joints: createMagneticPhysicsModel(build, { drop: true, floorY: 0 }).joints,
}]));

export function contactMatrixCells(experiment: ContactExperiment = "loaded"): ContactCell[] {
  if (experiment !== "loaded" && experiment !== "finer") throw new Error("Unknown contact experiment");
  const matrix = experiment === "loaded" ? CONTACT_MATRIX : FINER_CONTACT_MATRIX;
  return matrix.frequencies.flatMap(frequency => contactMatrixFixtures().flatMap(build =>
    matrix.rates.flatMap(hz => matrix.solvers.flatMap(solver =>
      matrix.seeds.map(seed => ({ fixture: build.id, frequency, hz, solver, seed }))))));
}

export function assertContactFixture(build: EngineBuild): void {
  const errors = [...validateEngineInput(build), ...validateMagneticBuild(build).rejectedReasons];
  if (errors.length || findRawOverlaps(build.tiles).length) throw new Error(`Invalid independent contact fixture ${build.id}: ${errors.join(", ")}`);
}

export function passesContactTrial(trial: ContactMatrixTrial): boolean {
  const expected = expectedFixtures.get(trial.fixture), p = trial.parameters;
  if (!expected || !p || p.dt !== Math.fround(1 / trial.hz) || p.solver !== trial.solver ||
    p.lengthUnit !== 1 || p.normalizedAllowedLinearError !== Math.fround(.001)) return false;
  const omegaDt = p.dt * 2 * Math.PI * trial.frequency;
  if (!Number.isFinite(p.contactERP) || Math.abs(p.contactERP - omegaDt / (omegaDt + 10)) > 1e-7 ||
    !Number.isFinite(p.frequencyFromERP) || Math.abs(p.frequencyFromERP - trial.frequency) > trial.frequency * 2e-6) return false;
  const { terminal } = trial;
  if (!terminal || !Array.isArray(terminal.bodies) || !Array.isArray(terminal.joints) ||
    !Array.isArray(terminal.connections) || !Array.isArray(terminal.solidFailures) || !Array.isArray(terminal.poppedJoints) ||
    terminal.bodies.length !== expected.build.tiles.length ||
    new Set(terminal.bodies.map(b => b.referenceTile.id)).size !== expected.build.tiles.length ||
    terminal.bodies.some(b => b.bodyType !== RigidBodyType.Dynamic || !b.releasePerturbed ||
      JSON.stringify(b.referenceTile) !== JSON.stringify(expected.build.tiles.find(t => t.id === b.referenceTile.id)) ||
      ![...Object.values(b.position), ...Object.values(b.rotation), ...Object.values(b.linearVelocity), ...Object.values(b.angularVelocity)].every(Number.isFinite)) ||
    JSON.stringify(terminal.connections) !== JSON.stringify(expected.build.connections) ||
    terminal.joints.length !== expected.joints.length ||
    new Set(terminal.joints.map(j => j.model.id)).size !== expected.joints.length ||
    terminal.joints.some(j => JSON.stringify(j.model) !== JSON.stringify(expected.joints.find(e => e.id === j.model.id)))) return false;
  const numbers = [trial.simulatedSeconds, trial.peakPenetration, trial.peakDisplacement,
    trial.latePenetration, trial.restReportingSteps, trial.finalSpeeds.linear, trial.finalSpeeds.angular];
  return trial.completed && trial.firstFailure === null && !trial.invalidState &&
    numbers.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) &&
    trial.integrationSteps === trial.hz * CONTACT_MATRIX.durationSeconds &&
    trial.attemptedSteps === trial.integrationSteps &&
    Math.abs(trial.simulatedSeconds - CONTACT_MATRIX.durationSeconds) < .00001 &&
    !terminal.solidFailures.length && !terminal.poppedJoints.length &&
    trial.peakPenetration <= CONTACT_MATRIX.peakLimit && trial.latePenetration! <= CONTACT_MATRIX.lateLimit &&
    trial.peakDisplacement <= CONTACT_MATRIX.displacementLimit && trial.restReportingSteps! >= CONTACT_MATRIX.restReportingSteps;
}

/** One requested step equals one native integration step at these declared rates.
 * Count actual native calls, including a pre-integration rejection at zero time.
 * Never call step again after failure; incomplete late/rest windows are null. */
export function simulateContactCell(engine: EngineWorld, cell: ContactCell, experiment: ContactExperiment = "loaded"): ContactMatrixTrial {
  if (!contactMatrixCells(experiment).some(c => contactCellKey(c) === contactCellKey(cell))) throw new Error("Undeclared matrix cell");
  const p = engine.world.integrationParameters;
  p.dt = 1 / cell.hz; p.numSolverIterations = cell.solver; p.contact_natural_frequency = cell.frequency;
  // Rapier exposes a frequency setter, not a getter. Infer the effective value
  // from the readable ERP with the unchanged native damping ratio of five.
  const parameters = { dt: p.dt, frequencyFromERP: p.contact_erp * 10 / ((1 - p.contact_erp) * p.dt * 2 * Math.PI), solver: p.numSolverIterations,
    lengthUnit: p.lengthUnit, normalizedAllowedLinearError: p.normalizedAllowedLinearError, contactERP: p.contact_erp };
  [...engine.bodies.values()].forEach((body, index) => perturbFirstRelease(body, index, cell.seed));
  let integrationSteps = 0, simulatedSeconds = 0, attemptedSteps = 0, rest = 0;
  let observedLatePenetration: number | null = null;
  let firstFailure: ContactMatrixTrial["firstFailure"] = null;
  const nativeStep = engine.world.step;
  engine.world.step = (...args: Parameters<typeof nativeStep>) => {
    nativeStep.apply(engine.world, args);
    integrationSteps++; simulatedSeconds += p.dt;
  };
  try {
    for (let step = 0; step < cell.hz * CONTACT_MATRIX.durationSeconds; step++) {
      attemptedSteps++;
      engine.step();
      if (step >= cell.hz * CONTACT_MATRIX.lateStartSeconds)
        observedLatePenetration = Math.max(observedLatePenetration ?? 0, engine.groundPenetration);
      rest = engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED && engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED ? rest + 1 : 0;
      const reason = engine.invalidState ? "invalid-state" : engine.solidFailures[0]?.kind ??
        (engine.poppedJoints.length ? "popped-joint" :
          engine.peakGroundPenetration > CONTACT_MATRIX.peakLimit ? "table-penetration" :
          engine.peakDisplacement > CONTACT_MATRIX.displacementLimit ? "displacement" :
          observedLatePenetration !== null && observedLatePenetration > CONTACT_MATRIX.lateLimit ? "late-penetration" :
          integrationSteps !== attemptedSteps ? "unexpected-integration-count" : null);
      if (reason) {
        firstFailure = { reason, attemptedStep: attemptedSteps, integrationSteps, simulatedSeconds };
        break;
      }
    }
  } finally { engine.world.step = nativeStep; }
  const completed = !firstFailure && integrationSteps === cell.hz * CONTACT_MATRIX.durationSeconds;
  const trial: ContactMatrixTrial = { ...cell, completed, attemptedSteps, integrationSteps, simulatedSeconds,
    peakPenetration: engine.peakGroundPenetration, latePenetration: completed ? observedLatePenetration : null,
    observedLatePenetration, peakDisplacement: engine.peakDisplacement,
    restReportingSteps: completed ? Math.floor(rest / cell.hz * 120) : null,
    finalSpeeds: { ...engine.stepSpeeds }, firstFailure, invalidState: engine.invalidState,
    terminal: engine.snapshot(), parameters, passed: false };
  trial.passed = passesContactTrial(trial);
  return trial;
}

export async function runContactCell(build: EngineBuild, cell: ContactCell, experiment: ContactExperiment = "loaded"): Promise<ContactMatrixTrial> {
  if (build.id !== cell.fixture) throw new Error("Fixture identity mismatch");
  assertContactFixture(build);
  const engine = await createEngineWorld(build, { drop: true, floorY: 0 });
  try { return simulateContactCell(engine, cell, experiment); } finally { engine.dispose(); }
}

/** No missing, duplicate, extra or failed cell can win through an empty every().
 * Re-evaluate measured outcomes instead of trusting serialized passed booleans. */
export function assessContactMatrix(trials: ContactMatrixTrial[]) {
  const expected = contactMatrixCells(), keys = trials.map(contactCellKey);
  const expectedKeys = new Set(expected.map(contactCellKey));
  const coverageErrors = [
    ...expected.filter(cell => !keys.includes(contactCellKey(cell))).map(cell => `missing:${contactCellKey(cell)}`),
    ...keys.filter((key, index) => keys.indexOf(key) !== index).map(key => `duplicate:${key}`),
    ...keys.filter(key => !expectedKeys.has(key)).map(key => `unexpected:${key}`),
  ];
  const frequencies = CONTACT_MATRIX.frequencies.map(frequency => {
    const rows = trials.filter(t => t.frequency === frequency);
    const groups = contactMatrixFixtures().flatMap(build => CONTACT_MATRIX.seeds.map(seed => {
      const cells = rows.filter(t => t.fixture === build.id && t.seed === seed);
      const complete = cells.length === 4 && new Set(cells.map(contactCellKey)).size === 4 &&
        cells.every(t => expectedKeys.has(contactCellKey(t)) && passesContactTrial(t));
      const peakSpread = complete ? Math.max(...cells.map(t => t.peakPenetration)) - Math.min(...cells.map(t => t.peakPenetration)) : null;
      const lateSpread = complete ? Math.max(...cells.map(t => t.latePenetration!)) - Math.min(...cells.map(t => t.latePenetration!)) : null;
      return { fixture: build.id, seed, complete, peakSpread, lateSpread,
        passed: complete && peakSpread! <= CONTACT_MATRIX.peakSpread && lateSpread! <= CONTACT_MATRIX.lateSpread };
    }));
    const eligible = (CONTACT_MATRIX.eligibleFrequencies as readonly number[]).includes(frequency);
    const passed = !coverageErrors.length && rows.every(t => passesContactTrial(t) &&
      t.peakPenetration <= CONTACT_MATRIX.selectionPeak && t.latePenetration! <= CONTACT_MATRIX.selectionLate) && groups.every(g => g.passed);
    return { frequency, eligible, passed, passedTrials: rows.filter(passesContactTrial).length, totalTrials: rows.length, groups };
  });
  return { coverageErrors, frequencies, selectedFrequency: frequencies.find(f => f.eligible && f.passed)?.frequency ?? null };
}
