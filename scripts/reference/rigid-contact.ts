import { writeFile } from "node:fs/promises";
import { createEngineWorld, perturbFirstRelease } from "../../lib/engine/rapier-world";
import { validateMagneticBuild } from "../../lib/engine/build";
import { validateEngineInput } from "../../lib/engine/input";
import { findRawOverlaps, RAW_OVERLAP_TOLERANCE } from "../../lib/engine/overlap";
import { CONTACT_NATURAL_FREQUENCY_HZ, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED } from "../../lib/engine/constants";
import { flatContactFixture, loadedContactFixture } from "../../tests/fixtures/rigid-contact";
import { validationCodeHash } from "../../lib/replication/provenance";
import { PHYSICS_BACKEND_ID } from "../../lib/engine/backend-identity";
import type { SolidFailure } from "../../lib/magnetic-tiles/swept-prisms";

interface ContactTrial {
  fixture: string; frequency: number; hz: number; solver: number; seed: number;
  peakPenetration: number; latePenetration: number; peakDisplacement: number;
  finalSpeeds: {linear:number;angular:number}; settledSteps: number; poppedJoints: string[];
  lengthUnit: number; normalizedAllowedLinearError: number; contactERP: number; passed: boolean;
  solidFailures: SolidFailure[]; peakSolidOverlap: number; invalidState: boolean;
}
async function main() {
  const trials: ContactTrial[] = [];
  for (const fixture of [flatContactFixture, loadedContactFixture]) {
    const build = fixture();
    if (validateEngineInput(build).length || validateMagneticBuild(build).rejectedReasons.length || findRawOverlaps(build.tiles).length)
      throw new Error(`Invalid independent contact fixture ${build.id}`);
    for (const frequency of [30,60,120]) for (const hz of [960,1920]) for (const solver of [16,32]) for (const seed of [0,17,53]) {
      const engine = await createEngineWorld(build,{drop:true,floorY:0});
      try {
        const parameters = engine.world.integrationParameters;
        parameters.dt = 1/hz; parameters.numSolverIterations = solver; parameters.contact_natural_frequency = frequency;
        [...engine.bodies.values()].forEach((r,i) => perturbFirstRelease(r,i,seed));
        let rest = 0, latePenetration = 0;
        for (let step = 0; step < hz*7.5; step++) {
          engine.step();
          if (step >= hz*6.75) latePenetration = Math.max(latePenetration,engine.groundPenetration);
          rest = engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED && engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED ? rest+1 : 0;
        }
        const settledSteps = Math.floor(rest/hz*120);
        trials.push({ fixture: build.id, frequency, hz, solver, seed, peakPenetration: engine.peakGroundPenetration, latePenetration,
          peakDisplacement: engine.peakDisplacement, finalSpeeds: engine.stepSpeeds, settledSteps, poppedJoints: engine.poppedJoints,
          lengthUnit: parameters.lengthUnit, normalizedAllowedLinearError: parameters.normalizedAllowedLinearError,
          contactERP: parameters.contact_erp,
          solidFailures: engine.solidFailures, peakSolidOverlap: engine.peakSolidOverlap, invalidState: engine.invalidState,
          passed: !engine.invalidState && !engine.solidFailures.length && engine.peakGroundPenetration <= RAW_OVERLAP_TOLERANCE && latePenetration <= .01 && engine.peakDisplacement <= .95 && settledSteps >= 90 && !engine.poppedJoints.length });
      } finally { engine.dispose(); }
    }
  }
  const selected = [30,60,120].find(f => trials.filter(t => t.frequency===f).every(t => t.passed));
  const evidence = { validationCodeHash: await validationCodeHash(),
    scope: "Numerical rigid-contact convergence only. Independent catalog flat/base-load fixtures; no source-derived geometry or physical material calibration.",
    versions: { backend: PHYSICS_BACKEND_ID, javascript: "rapier3d-compat 0.19.2", rust: "rapier3d 0.30.1" },
    sources: ["https://raw.githubusercontent.com/dimforge/rapier.js/v0.19.2/Cargo.lock", "https://raw.githubusercontent.com/dimforge/rapier/v0.30.1/src/dynamics/integration_parameters.rs"],
    criteria: { peakPenetration: RAW_OVERLAP_TOLERANCE, latePenetration: .01, peakDisplacement: .95, restReportingSteps: 90, durationSeconds: 7.5, lateStartSeconds: 6.75 },
    selectedFrequency: selected ?? null, configuredFrequency: CONTACT_NATURAL_FREQUENCY_HZ, trials };
  await writeFile("verification/replication/rigid-contact-fixture.json",JSON.stringify(evidence,null,2)+"\n");
  if (selected !== CONTACT_NATURAL_FREQUENCY_HZ) throw new Error(`Contact convergence does not support configured frequency: ${selected}`);
  console.log(`Independent rigid-contact sweep: ${trials.length} trials; lowest passing frequency ${selected} Hz.`);
}
void main().catch(error => {console.error(error);process.exitCode=1;});
