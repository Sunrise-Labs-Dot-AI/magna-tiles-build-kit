import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createEngineWorld, type EngineState } from "@/lib/engine/rapier-world";
import { contactMatrixFixtures } from "./fixtures/loaded-contact";
import { flatContactFixture } from "./fixtures/rigid-contact";
import { CONTACT_CRITERIA, FINER_CONTACT_MATRIX, assessContactMatrix, contactMatrixCells, runContactCell, simulateContactCell, type ContactMatrixTrial } from "../scripts/reference/contact-matrix";
import { assessFinerContactMatrix } from "../scripts/reference/finer-contact-matrix";

const cells = contactMatrixCells("finer");

async function syntheticPassingMatrix(): Promise<ContactMatrixTrial[]> {
  // Selection tests only: fixture-specific initial snapshots are deliberately
  // synthetic, never used or saved as physical evidence.
  const snapshots = new Map<string, EngineState>();
  for (const build of contactMatrixFixtures()) {
    const engine = await createEngineWorld(build, { drop: true, floorY: 0 });
    try {
      const state = engine.snapshot();
      state.bodies.forEach(body => { body.releasePerturbed = true; });
      snapshots.set(build.id, state);
    } finally { engine.dispose(); }
  }
  return cells.map(cell => {
    const dt = Math.fround(1/cell.hz), omegaDt = dt*2*Math.PI*cell.frequency;
    return { ...cell, completed: true, attemptedSteps: cell.hz*7.5, integrationSteps: cell.hz*7.5,
      simulatedSeconds: 7.5, peakPenetration: .005, latePenetration: .002, observedLatePenetration: .002,
      peakDisplacement: .28, restReportingSteps: 120, finalSpeeds: { linear: 0, angular: 0 },
      firstFailure: null, invalidState: false, terminal: structuredClone(snapshots.get(cell.fixture)!),
      parameters: { dt, frequencyFromERP: cell.frequency, solver: cell.solver, lengthUnit: 1,
        normalizedAllowedLinearError: Math.fround(.001), contactERP: omegaDt/(omegaDt+10) }, passed: true };
  });
}

describe("finer-step contact profile qualification", () => {
  it("preserves the full historical matrix verdict and its unchanged criteria", () => {
    const archived = JSON.parse(gunzipSync(readFileSync("runs/diagnostics/2026-09-27-loaded-contact-matrix.json.gz")).toString());
    expect(assessContactMatrix(archived.trials)).toEqual(archived.assessment);
    for (const [key, value] of Object.entries(CONTACT_CRITERIA)) expect(archived.criteria[key]).toEqual(value);
    expect(contactMatrixCells()).toHaveLength(216);
  });

  it("requires the entire predeclared 216-cell finer matrix", () => {
    expect(cells).toHaveLength(216);
    expect(new Set(cells.map(c => JSON.stringify(c))).size).toBe(216);
    expect(FINER_CONTACT_MATRIX).toMatchObject({ frequencies: [240, 480], rates: [1920, 3840, 7680], candidateCollisionRates: [1920, 3840],
      solvers: [16, 32], seeds: [0, 17, 53], peakLimit: .03, lateLimit: .01, selectionPeak: .025, selectionLate: .008, peakSpread: .005, lateSpread: .002 });
    expect(cells.some(c => c.hz === 960 || c.frequency === 120)).toBe(false);
  });

  it.each([1920, 3840, 7680])("records native time and free rest for a real flat drop at %i Hz", async hz => {
    const cell = cells.find(c => c.hz === hz)!;
    const trial = await runContactCell(flatContactFixture(), cell, "finer");
    expect(trial.passed).toBe(true);
    expect(trial.integrationSteps).toBe(hz*7.5);
    expect(trial.attemptedSteps).toBe(trial.integrationSteps);
    expect(trial.simulatedSeconds).toBeCloseTo(7.5, 5);
    expect(trial.restReportingSteps).toBeGreaterThanOrEqual(90);
  });

  it("does not admit a coarse-only cell through the finer experiment", async () => {
    await expect(runContactCell(flatContactFixture(), contactMatrixCells()[0], "finer")).rejects.toThrow("Undeclared matrix cell");
  });

  it("still stops at the first failing finer step without late/rest credit", async () => {
    const engine = await createEngineWorld(flatContactFixture(), { drop: true, floorY: 0 });
    try {
      const cell = cells.find(c => c.hz === 7680)!;
      const body = [...engine.bodies.values()][0].body, native = engine.world.step.bind(engine.world);
      let steps = 0;
      vi.spyOn(engine.world, "step").mockImplementation(() => {
        native(); if (++steps === 3) body.setTranslation({ x: 0, y: -.2, z: 0 }, true);
      });
      const trial = simulateContactCell(engine, cell, "finer");
      expect(steps).toBe(3);
      expect(trial.firstFailure?.reason).toBe("table");
      expect(trial.simulatedSeconds).toBeCloseTo(3/7680, 8);
      expect(trial.passed).toBe(false);
      expect(trial.latePenetration).toBeNull();
      expect(trial.restReportingSteps).toBeNull();
    } finally { engine.dispose(); }
  });

  it("selects only the lowest qualifying frequency and then collision rate", async () => {
    const good = await syntheticPassingMatrix();
    const assess = (rows = good) => assessFinerContactMatrix(rows);
    expect(assess().selectedProfile).toEqual({ frequency: 240, collisionHz: 1920 });
    expect(assess().profiles.map(p => [p.frequency, p.collisionHz, p.refinementHz, p.totalTrials])).toEqual([
      [240, 1920, 3840, 72], [240, 3840, 7680, 72], [480, 1920, 3840, 72], [480, 3840, 7680, 72],
    ]);
    const coarseSensitive = structuredClone(good);
    coarseSensitive[0].peakPenetration = .02;
    const coarse = assess(coarseSensitive);
    expect(coarse.selectedProfile).toEqual({ frequency: 240, collisionHz: 3840 });
    expect(coarse.profiles[0]).toMatchObject({ passed: false });
    expect(coarse.profiles[0].groups[0].peakSpread).toBeCloseTo(.015);
    const stifferNeeded = structuredClone(good);
    stifferNeeded.filter(t => t.frequency === 240).forEach(t => { t.latePenetration = .0081; });
    expect(assess(stifferNeeded).selectedProfile).toEqual({ frequency: 480, collisionHz: 1920 });
    stifferNeeded.find(t => t.frequency === 480 && t.hz === 1920)!.peakPenetration = .02;
    expect(assess(stifferNeeded).selectedProfile).toEqual({ frequency: 480, collisionHz: 3840 });
    const middle = stifferNeeded.find(t => t.frequency === 480 && t.hz === 3840)!;
    middle.firstFailure = { reason: "table", attemptedStep: 3, integrationSteps: 3, simulatedSeconds: 3/3840 };
    const failed = assess(stifferNeeded);
    expect(failed.selectedProfile).toBeNull();
    expect(failed.profiles[2].groups[0]).toMatchObject({ complete: false, peakSpread: null, lateSpread: null });
    expect(failed.profiles[3].groups[0]).toMatchObject({ complete: false, peakSpread: null, lateSpread: null });
    expect(assess([]).selectedProfile).toBeNull();
    expect(assess(good.slice(1)).selectedProfile).toBeNull();
    const duplicate = structuredClone(good); duplicate[1] = duplicate[0];
    expect(assess(duplicate).selectedProfile).toBeNull();
    const unexpected = structuredClone(good); unexpected[0].hz = 960;
    expect(assess(unexpected).selectedProfile).toBeNull();
  });

  it("revalidates effective settings and whole snapshots in each candidate profile", async () => {
    const good = await syntheticPassingMatrix();
    for (const mutate of [
      (t: ContactMatrixTrial) => { t.parameters.solver = 4; },
      (t: ContactMatrixTrial) => { t.parameters.frequencyFromERP = 120; },
      (t: ContactMatrixTrial) => { t.terminal.bodies.pop(); },
      (t: ContactMatrixTrial) => { t.latePenetration = null; },
    ]) {
      const rows = structuredClone(good);
      rows.filter(t => t.hz === 3840).forEach(mutate);
      expect(assessFinerContactMatrix(rows).selectedProfile).toBeNull();
    }
  });
});
