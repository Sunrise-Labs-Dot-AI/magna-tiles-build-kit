import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { assertArtifactDigest } from "@/lib/replication/provenance";
import { PHYSICS_MODEL_VERSION } from "@/lib/engine/constants";
import { assessContactProfile, assessFinerContactMatrix } from "../scripts/reference/finer-contact-matrix";
import { assertConfiguredContactReport, configuredContactCells, configuredContactContext, CONTACT_SELECTION_EVIDENCE,
  type ConfiguredContactContext, type ConfiguredContactReport } from "../scripts/reference/configured-contact";
import { runContactCell, type ContactMatrixTrial } from "../scripts/reference/contact-matrix";

let context: ConfiguredContactContext, template: ConfiguredContactReport;
beforeAll(async () => {
  context = await configuredContactContext();
  const archived = JSON.parse(gunzipSync(readFileSync(CONTACT_SELECTION_EVIDENCE.path)).toString());
  expect(assessFinerContactMatrix(archived.trials)).toEqual(archived.assessment);
  const trials = (archived.trials as ContactMatrixTrial[]).filter(t => t.frequency === 480 && [1920,3840].includes(t.hz));
  // Structural consumer tests only: historical measurements with a synthetic
  // current identity. Never write these rows as regenerated physical evidence.
  trials.forEach(t => { t.terminal.physicsModel = PHYSICS_MODEL_VERSION; });
  template = { ...context, completed: true, qualified: true, trials, assessment: assessContactProfile(trials,480,1920) };
});

describe("configured profile evidence contract", () => {
  it("binds the current settings to the complete independently selected experiment", () => {
    expect(context.configuredProfile).toEqual({ frequency:480, collisionHz:1920 });
    expect(configuredContactCells(context.configuredProfile)).toHaveLength(72);
    expect(() => assertConfiguredContactReport(template,context)).not.toThrow();
    expect(assessContactProfile([],999,123).passed).toBe(false);
  });

  it("uses the actual current native step and identity for a fresh flat drop", async () => {
    const cell = configuredContactCells(context.configuredProfile)[0];
    const trial = await runContactCell(context.fixtureBuilds[0],cell,"finer");
    expect(trial.passed).toBe(true);
    expect(trial.parameters.frequencyFromERP).toBeCloseTo(480,3);
    expect(trial.integrationSteps).toBe(1920*7.5);
    expect(trial.terminal.physicsModel).toBe(context.physicsModel);
    const report = structuredClone(template); report.trials[0] = trial;
    report.assessment = assessContactProfile(report.trials,480,1920);
    expect(() => assertConfiguredContactReport(report,context)).not.toThrow();
  });

  const corruptions: [string, (r: ConfiguredContactReport) => void][] = [
    ["missing cell", r => { r.trials.pop(); }],
    ["duplicate cell", r => { r.trials[1] = r.trials[0]; }],
    ["extra cell", r => { r.trials.push(r.trials[0]); }],
    ["wrong frequency", r => { r.trials[0].frequency = 240; }],
    ["wrong rate", r => { r.trials[0].hz = 960; }],
    ["truncated native integration", r => { r.trials[0].integrationSteps--; }],
    ["wrong elapsed time", r => { r.trials[0].simulatedSeconds = 7; }],
    ["missing late interval", r => { r.trials[0].latePenetration = null; }],
    ["ordinary failure marked successful", r => { r.trials[0].peakPenetration = .031; }],
    ["selection margin failure", r => { r.trials[0].latePenetration = .009; }],
    ["sensitivity failure", r => { r.trials[0].peakPenetration = .02; }],
    ["wrong ERP", r => { r.trials[0].parameters.contactERP = .5; }],
    ["wrong solver", r => { r.trials[0].parameters.solver = 4; }],
    ["wrong native dt", r => { r.trials[0].parameters.dt = 1/960; }],
    ["missing body", r => { r.trials[0].terminal.bodies.pop(); }],
    ["missing joint", r => { r.trials.find(t => t.terminal.joints.length)!.terminal.joints.pop(); }],
    ["altered fixture", r => { r.trials[0].terminal.bodies[0].referenceTile.position.y += .000001; }],
    ["stale state", r => { r.trials[0].terminal.physicsModel = "old"; }],
    ["inconsistent late interval", r => { r.trials[0].observedLatePenetration = 0; }],
    ["impossible rest count", r => { r.trials[0].restReportingSteps = 901; }],
    ["moving final body", r => { r.trials[0].terminal.bodies[0].linearVelocity.x = .02; }],
    ["unreported displacement", r => { r.trials[0].terminal.bodies[0].position.x += 2; }],
    ["unreported table crossing", r => { r.trials[0].terminal.bodies[0].position.y = -.2; }],
    ["false final rest", r => { r.trials[0].finalSpeeds.angular = .1; }],
    ["missing joint metric", r => { r.trials.find(t => t.terminal.joints.length)!.terminal.joints[0].previousDistance = NaN; }],
    ["nonfinite overlap", r => { r.trials[0].terminal.peakSolidOverlap = NaN; }],
    ["disabled CCD", r => { r.trials[0].terminal.bodies[0].ccd = false; }],
    ["invalid quaternion", r => { r.trials[0].terminal.bodies[0].rotation.w = 2; }],
    ["stale validator", r => { r.validationCodeHash = "old"; }],
    ["changed input hash", r => { r.inputHash = "changed"; }],
    ["changed criteria", r => { r.criteria = { ...r.criteria, selectionLate: .02 } as unknown as typeof r.criteria; }],
    ["incomplete report", r => { r.completed = false; }],
    ["failed flag", r => { r.trials[0].passed = false; }],
  ];
  it.each(corruptions)("rejects %s even with regenerated summaries and outer digest", (_label, mutate) => {
    const report = structuredClone(template); mutate(report);
    report.assessment = assessContactProfile(report.trials,480,1920);
    const bytes = JSON.stringify(report), hash = createHash("sha256").update(bytes).digest("hex");
    expect(() => assertArtifactDigest("contact",bytes,hash)).not.toThrow();
    expect(() => assertConfiguredContactReport(JSON.parse(bytes),context)).toThrow();
  });
});
