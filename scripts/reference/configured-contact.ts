import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { CONTACT_NATURAL_FREQUENCY_HZ, MAX_COLLISION_TIMESTEP_SECONDS, PHYSICS_MODEL_VERSION,
  SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SIMULATION_TIMESTEP_SECONDS } from "../../lib/engine/constants";
import { validationCodeHash } from "../../lib/replication/provenance";
import { tilePrismPoints } from "../../lib/engine/build";
import { distance, quaternionToBasis, transformLocal } from "../../lib/engine/math";
import { currentTilePose } from "../../lib/engine/rapier-world";
import { checkSolidSweep, prismPose } from "../../lib/magnetic-tiles/swept-prisms";
import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { CONTACT_CRITERIA, FINER_CONTACT_MATRIX, contactMatrixCells, passesContactTrial, type ContactMatrixTrial } from "./contact-matrix";
import { assessContactProfile, assessFinerContactMatrix } from "./finer-contact-matrix";

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const CONTACT_SELECTION_EVIDENCE = {
  path: "runs/diagnostics/2026-09-27-finer-contact-matrix.json.gz",
  checkpoint: "39686d84a81bec3b7277fee1445ef4eed5dd4520",
  rawSha256: "e8558125b1e9e5de8c67782b402a18bf2242da95651837273b592e2e588674be",
  gzipSha256: "d41dc964f4db60d69ba49deed15d377a95fa306ad661a91610ce6e9a90ff1b09",
} as const;

/** Historical choice is immutable and independently recomputed, not supplied by
 * the current report. Reproduce its coarse candidates at its archived checkpoint. */
export async function configuredContactContext() {
  const compressed = await readFile(CONTACT_SELECTION_EVIDENCE.path);
  assert.equal(sha(compressed), CONTACT_SELECTION_EVIDENCE.gzipSha256, "Changed historical contact archive");
  const raw = gunzipSync(compressed);
  assert.equal(sha(raw), CONTACT_SELECTION_EVIDENCE.rawSha256, "Changed historical contact evidence");
  const historical = JSON.parse(raw.toString());
  const fixtures = json(contactMatrixFixtures());
  assert.deepEqual(historical.criteria, FINER_CONTACT_MATRIX);
  assert.deepEqual(historical.fixtureBuilds, fixtures, "Contact fixtures changed since independent selection");
  assert.equal(historical.completed, true);
  const selection = assessFinerContactMatrix(historical.trials);
  assert.deepEqual(historical.assessment, selection);
  const configuredProfile = { frequency: CONTACT_NATURAL_FREQUENCY_HZ, collisionHz: 1/MAX_COLLISION_TIMESTEP_SECONDS };
  assert.deepEqual(selection.selectedProfile, configuredProfile, "Runtime differs from independently qualified profile");
  return {
    schema: "configured-contact-v2" as const,
    scope: "Current numerical profile verification, not a new frequency search or physical material/source/assembly certification.",
    validationCodeHash: await validationCodeHash(),
    physicsModel: PHYSICS_MODEL_VERSION,
    selectionEvidence: CONTACT_SELECTION_EVIDENCE,
    configuredProfile,
    criteria: CONTACT_CRITERIA,
    inputHash: sha(JSON.stringify(fixtures)), fixtureBuilds: fixtures,
  };
}

export type ConfiguredContactContext = Awaited<ReturnType<typeof configuredContactContext>>;
export interface ConfiguredContactReport extends ConfiguredContactContext {
  completed: boolean;
  qualified: boolean;
  assessment: ReturnType<typeof assessContactProfile>;
  trials: ContactMatrixTrial[];
}

export function configuredContactCells(profile: ConfiguredContactContext["configuredProfile"]) {
  return contactMatrixCells("finer").filter(cell => cell.frequency === profile.frequency &&
    [profile.collisionHz, profile.collisionHz * 2].includes(cell.hz));
}

/** A matching outer digest proves file integrity, not a passing experiment.
 * Recheck the complete measured contract before any artifact gets current credit. */
export function assertConfiguredContactReport(report: ConfiguredContactReport, context: ConfiguredContactContext): void {
  for (const [key, value] of Object.entries(context))
    assert.deepEqual(report[key as keyof ConfiguredContactReport], value, `Stale or changed contact ${key}`);
  assert.equal(report.completed, true, "Incomplete configured contact report");
  assert(Array.isArray(report.trials), "Missing contact trials");
  const { frequency, collisionHz } = context.configuredProfile;
  const assessment = assessContactProfile(report.trials, frequency, collisionHz);
  assert.deepEqual(report.assessment, assessment, "Stored contact assessment differs from measurements");
  assert.equal(assessment.passed, true, "Configured contact profile fails coverage, measurements or convergence");
  assert.equal(report.qualified, true, "Unqualified contact report");
  for (const trial of report.trials) {
    assert.equal(trial.passed, passesContactTrial(trial), "Stored contact pass flag differs from measurements");
    assert.equal(trial.terminal.physicsModel, context.physicsModel, "Stale contact body state");
    assert.equal(trial.observedLatePenetration, trial.latePenetration, "Incomplete late contact window");
    assert(trial.latePenetration! <= trial.peakPenetration, "Late penetration exceeds whole-run peak");
    assert(Number.isInteger(trial.restReportingSteps) && trial.restReportingSteps! <= CONTACT_CRITERIA.durationSeconds/SIMULATION_TIMESTEP_SECONDS,
      "Invalid contact rest accounting");
    assert(trial.finalSpeeds.linear < SETTLED_LINEAR_SPEED && trial.finalSpeeds.angular < SETTLED_ANGULAR_SPEED,
      "Reported rest contradicts final motion");
    assert(Number.isFinite(trial.terminal.peakSolidOverlap) && trial.terminal.peakSolidOverlap >= 0 &&
      trial.terminal.peakSolidOverlap <= CONTACT_CRITERIA.peakLimit, "Invalid terminal solid overlap");
    const poses = trial.terminal.bodies.map(body => prismPose(currentTilePose(body.referenceTile,body.position,body.rotation,0)));
    assert.equal(checkSolidSweep(poses,poses,0,CONTACT_CRITERIA.peakLimit).failure, undefined, "Terminal solids contradict passing report");
    for (const body of trial.terminal.bodies) {
      assert.equal(body.ccd, true, "Contact fixture CCD was disabled");
      assert.equal(typeof body.sleeping, "boolean", "Missing terminal activation state");
      assert(Math.abs(Math.hypot(...Object.values(body.rotation))-1) < 1e-5, "Invalid terminal rotation");
      assert(Math.hypot(...Object.values(body.linearVelocity)) <= trial.finalSpeeds.linear + 1e-12 &&
        Math.hypot(...Object.values(body.angularVelocity)) <= trial.finalSpeeds.angular + 1e-12,
      "Final motion summary omits a body's motion");
      // These fixtures have a fixed y=0 floor and an identity body reference
      // rotation, so reconstruct the engine's f32 hull measurement exactly.
      const hull = tilePrismPoints(body.referenceTile), basis = quaternionToBasis(body.rotation);
      for (let i = 0; i < hull.length; i += 3) {
        const local = { x:hull[i], y:hull[i+1], z:hull[i+2] };
        const actual = transformLocal(local,body.position,basis);
        const target = { x:local.x+body.referenceTile.position.x, y:local.y+body.referenceTile.position.y, z:local.z+body.referenceTile.position.z };
        assert(distance(actual,target) <= trial.peakDisplacement+1e-12, "Terminal displacement exceeds reported peak");
        assert(-actual.y <= trial.latePenetration!+1e-12, "Terminal table depth exceeds reported late peak");
      }
    }
    assert(trial.terminal.joints.every(j => [j.previousDistance, j.companionPreviousDistance].every(n => Number.isFinite(n) && n >= 0)),
      "Invalid terminal joint state");
  }
}
