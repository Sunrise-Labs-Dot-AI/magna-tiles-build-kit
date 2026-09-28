import { MAX_COLLISION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { describe, expect, it, vi } from "vitest";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { contactMatrixFixtures, loadedShellContactFixture } from "./fixtures/loaded-contact";
import { flatContactFixture, loadedContactFixture } from "./fixtures/rigid-contact";
import { CONTACT_MATRIX, assessContactMatrix, assertContactFixture, contactMatrixCells, runContactCell, simulateContactCell, type ContactMatrixTrial } from "../scripts/reference/contact-matrix";

const cell = contactMatrixCells().find(c => c.hz === 1/MAX_COLLISION_TIMESTEP_SECONDS)!;

describe("independent loaded contact matrix", () => {
  it("uses all six independent catalog fixtures, preserving the original five-panel fixture", () => {
    const builds = contactMatrixFixtures();
    expect(builds.map(b => b.tiles.length)).toEqual([1, 5, 9, 13, 17, 25]);
    expect(builds[1]).toEqual(loadedContactFixture());
    for (const build of builds) {
      expect(() => assertContactFixture(build)).not.toThrow();
      expect(new Set(build.tiles.map(t => t.id)).size).toBe(build.tiles.length);
      expect(build.tiles.every(t => t.shape === "small-square" && TILE_SPECS[t.shape].width === 3)).toBe(true);
    }
    expect(() => loadedShellContactFixture(5)).toThrow(/Undeclared/);
    const duplicate = structuredClone(builds[1]); duplicate.tiles[1] = duplicate.tiles[0];
    expect(() => assertContactFixture(duplicate)).toThrow(/Invalid/);
    const broken = structuredClone(builds[1]); broken.connections[0].toEdge = 200;
    expect(() => assertContactFixture(broken)).toThrow();
  });

  it("has exactly the predeclared 216 distinct cells and unchanged criteria", () => {
    expect(contactMatrixCells()).toHaveLength(216);
    expect(new Set(contactMatrixCells().map(c => JSON.stringify(c))).size).toBe(216);
    expect(CONTACT_MATRIX).toMatchObject({ frequencies: [120, 240, 480], eligibleFrequencies: [120, 240], rates: [960, 1920],
      solvers: [16, 32], seeds: [0, 17, 53], peakLimit: .03, displacementLimit: .95, lateLimit: .01,
      selectionPeak: .025, selectionLate: .008, peakSpread: .005, lateSpread: .002 });
  });

  it("rejects a historical coarse-rate label when the current engine subdivides it", async () => {
    const coarse = contactMatrixCells()[0];
    const trial = await runContactCell(flatContactFixture(), coarse);
    expect(trial.passed).toBe(false);
    expect(trial.firstFailure?.reason).toBe("unexpected-integration-count");
    expect(trial.attemptedSteps).toBe(1);
    expect(trial.integrationSteps).toBe((1/coarse.hz)/MAX_COLLISION_TIMESTEP_SECONDS);
    expect(trial.simulatedSeconds).toBeCloseTo(1/coarse.hz, 9);
    expect(trial.latePenetration).toBeNull();
    expect(trial.restReportingSteps).toBeNull();
  });

  it("records actual integration time and a complete terminal snapshot for a real free flat-panel drop", async () => {
    const trial = await runContactCell(flatContactFixture(), cell);
    expect(trial.passed).toBe(true);
    expect(trial.completed).toBe(true);
    expect(trial.integrationSteps).toBe(cell.hz*7.5);
    expect(trial.simulatedSeconds).toBeCloseTo(7.5, 5);
    expect(trial.restReportingSteps).toBeGreaterThanOrEqual(90);
    expect(trial.terminal.bodies).toHaveLength(1);
    expect(trial.terminal.bodies[0].bodyType).toBe(RigidBodyType.Dynamic);
    expect(trial.latePenetration).toBe(trial.observedLatePenetration);
  });

  it("stops on the first penetrating integration step, with unavailable late/rest metrics", async () => {
    const engine = await createEngineWorld(flatContactFixture(), { drop: true, floorY: 0 });
    try {
      const body = [...engine.bodies.values()][0].body;
      const native = engine.world.step.bind(engine.world);
      let steps = 0;
      const spy = vi.spyOn(engine.world, "step").mockImplementation(() => {
        native(); if (++steps === 3) body.setTranslation({ x: 0, y: -.2, z: 0 }, true);
      });
      const trial = simulateContactCell(engine, cell);
      expect(spy).toHaveBeenCalledTimes(3);
      expect(trial.integrationSteps).toBe(3);
      expect(trial.firstFailure?.reason).toBe("table");
      expect(trial.simulatedSeconds).toBeCloseTo(3 / cell.hz, 7);
      expect(trial.terminal.bodies[0].position.y).toBeCloseTo(-.2);
      expect(trial.latePenetration).toBeNull();
      expect(trial.observedLatePenetration).toBeNull();
      expect(trial.restReportingSteps).toBeNull();
      expect(trial.completed).toBe(false);
      expect(trial.passed).toBe(false);
    } finally { engine.dispose(); }
  });

  it("records zero elapsed time for a failure before native integration", async () => {
    const engine = await createEngineWorld(flatContactFixture(), { drop: true, floorY: 0 });
    try {
      const body = [...engine.bodies.values()][0].body;
      vi.spyOn(body, "linvel").mockReturnValue({ x: NaN, y: 0, z: 0 });
      const trial = simulateContactCell(engine, cell);
      expect(trial.integrationSteps).toBe(0);
      expect(trial.simulatedSeconds).toBe(0);
      expect(trial.firstFailure?.reason).toBe("invalid-state");
      expect(trial.passed).toBe(false);
    } finally { engine.dispose(); }
  });

  it("retains a partial late observation without certifying the full late/rest window", async () => {
    const engine = await createEngineWorld(flatContactFixture(), { drop: true, floorY: 0 });
    try {
      const body = [...engine.bodies.values()][0].body;
      const native = engine.world.step.bind(engine.world);
      let steps = 0;
      vi.spyOn(engine.world, "step").mockImplementation(() => {
        native();
        if (++steps === cell.hz*6.75+1) body.setTranslation({ x: 0, y: .075, z: 0 }, true);
      });
      const trial = simulateContactCell(engine, cell);
      expect(trial.firstFailure?.reason).toBe("late-penetration");
      expect(trial.integrationSteps).toBe(cell.hz*6.75+1);
      expect(trial.observedLatePenetration).toBeCloseTo(.015);
      expect(trial.latePenetration).toBeNull();
      expect(trial.restReportingSteps).toBeNull();
      expect(trial.passed).toBe(false);
    } finally { engine.dispose(); }
  });

  it("stops immediately after a joint pops without counting future frozen steps", async () => {
    const build = loadedContactFixture();
    const engine = await createEngineWorld(build, { drop: true, floorY: 0 });
    try {
      const native = engine.world.step.bind(engine.world);
      let steps = 0;
      vi.spyOn(engine.world, "step").mockImplementation(() => {
        native();
        if (++steps === 2) engine.poppedJoints.push("injected-break");
      });
      const trial = simulateContactCell(engine, { ...cell, fixture: build.id });
      expect(trial.firstFailure?.reason).toBe("popped-joint");
      expect(trial.integrationSteps).toBe(2);
      expect(trial.terminal.poppedJoints).toContain("injected-break");
      expect(trial.latePenetration).toBeNull();
      expect(trial.restReportingSteps).toBeNull();
      expect(trial.passed).toBe(false);
    } finally { engine.dispose(); }
  });

  // Deliberate synthetic records exercise selection boundaries; they are never
  // written as physical evidence. Start from one actual successful trial.
  it("requires complete, converged measurements and excludes diagnostic-only frequency", async () => {
    const flat = await runContactCell(flatContactFixture(), cell);
    const templates = new Map();
    for (const build of contactMatrixFixtures()) {
      const engine = await createEngineWorld(build, { drop: true, floorY: 0 });
      try {
        const terminal = engine.snapshot();
        terminal.bodies.forEach(b => { b.releasePerturbed = true; });
        templates.set(build.id, terminal);
      } finally { engine.dispose(); }
    }
    const good = (): ContactMatrixTrial[] => contactMatrixCells().map(c => ({ ...structuredClone(flat), ...c,
      terminal: structuredClone(templates.get(c.fixture)),
      parameters: { ...flat.parameters, dt: Math.fround(1/c.hz), frequencyFromERP: c.frequency, solver: c.solver,
        contactERP: (Math.fround(1/c.hz)*2*Math.PI*c.frequency)/(Math.fround(1/c.hz)*2*Math.PI*c.frequency+10) },
      integrationSteps: c.hz * 7.5, attemptedSteps: c.hz * 7.5, simulatedSeconds: 7.5,
      peakPenetration: .02, latePenetration: .005, restReportingSteps: 100 }));
    expect(assessContactMatrix(good()).selectedFrequency).toBe(120);
    expect(assessContactMatrix([]).selectedFrequency).toBeNull();
    expect(assessContactMatrix(good().slice(1)).selectedFrequency).toBeNull();
    const duplicate = good(); duplicate[1] = duplicate[0];
    expect(assessContactMatrix(duplicate).selectedFrequency).toBeNull();
    const unexpected = good(); unexpected[0].hz = 480;
    expect(assessContactMatrix(unexpected).selectedFrequency).toBeNull();
    for (const mutate of [
      (t: ContactMatrixTrial) => { t.completed = false; },
      (t: ContactMatrixTrial) => { t.firstFailure = { reason: "table", attemptedStep: 1, integrationSteps: 1, simulatedSeconds: 1/960 }; },
      (t: ContactMatrixTrial) => { t.latePenetration = null; },
      (t: ContactMatrixTrial) => { t.peakPenetration = NaN; },
      (t: ContactMatrixTrial) => { t.peakPenetration = .026; },
      (t: ContactMatrixTrial) => { t.latePenetration = .009; },
      (t: ContactMatrixTrial) => { t.restReportingSteps = 89; },
      (t: ContactMatrixTrial) => { t.simulatedSeconds = 7; },
      (t: ContactMatrixTrial) => { t.terminal.poppedJoints.push("broken"); },
      (t: ContactMatrixTrial) => { t.parameters.frequencyFromERP = 30; },
      (t: ContactMatrixTrial) => { t.parameters.dt = 1/480; },
      (t: ContactMatrixTrial) => { t.parameters.solver = 4; },
      (t: ContactMatrixTrial) => { t.parameters.lengthUnit = 39.37; },
      (t: ContactMatrixTrial) => { t.parameters.normalizedAllowedLinearError = .1; },
      (t: ContactMatrixTrial) => { t.parameters.contactERP = .5; },
      (t: ContactMatrixTrial) => { t.terminal.bodies[0].bodyType = RigidBodyType.Fixed; },
    ]) {
      const rows = good(); mutate(rows[0]);
      expect(assessContactMatrix(rows).selectedFrequency).toBe(240);
    }
    const peakSensitive = good(); peakSensitive[0].peakPenetration = .014;
    const peakAssessment = assessContactMatrix(peakSensitive);
    expect(peakAssessment.selectedFrequency).toBe(240);
    expect(peakAssessment.frequencies[0].groups[0].peakSpread).toBeCloseTo(.006);
    const lateSensitive = good(); lateSensitive[0].latePenetration = .002;
    expect(assessContactMatrix(lateSensitive).selectedFrequency).toBe(240);
    const onlyDiagnostic = good(); onlyDiagnostic.filter(t => t.frequency !== 480).forEach(t => { t.peakPenetration = .026; });
    expect(assessContactMatrix(onlyDiagnostic).frequencies[2].passed).toBe(true);
    expect(assessContactMatrix(onlyDiagnostic).selectedFrequency).toBeNull();
    const failed = good(); failed[0].firstFailure = { reason: "table", attemptedStep: 1, integrationSteps: 1, simulatedSeconds: 1/960 };
    expect(assessContactMatrix(failed).frequencies[0].groups[0]).toMatchObject({ complete: false, peakSpread: null, lateSpread: null });
    for (const corrupt of [
      (t: ContactMatrixTrial) => { t.terminal = structuredClone(flat.terminal); },
      (t: ContactMatrixTrial) => { t.terminal.bodies.pop(); },
      (t: ContactMatrixTrial) => { t.terminal.bodies[1] = t.terminal.bodies[0]; },
      (t: ContactMatrixTrial) => { t.terminal.bodies[0].referenceTile.shape = "large-square"; },
      (t: ContactMatrixTrial) => { t.terminal.joints.pop(); },
      (t: ContactMatrixTrial) => { t.terminal.joints[1] = t.terminal.joints[0]; },
      (t: ContactMatrixTrial) => { t.terminal.joints[0].model.toLocalAnchor.x += .1; },
      (t: ContactMatrixTrial) => { t.terminal.connections.pop(); },
    ]) {
      const rows = good(); corrupt(rows.find(t => t.fixture === "loaded-base-contact")!);
      expect(assessContactMatrix(rows).selectedFrequency).toBe(240);
    }
  });
});
