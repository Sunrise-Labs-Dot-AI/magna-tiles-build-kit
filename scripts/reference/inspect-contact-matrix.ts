/** Static inspection only. Terminal states of interrupted cells are not settled states. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { distance, quaternionAngle, quaternionToBasis, subtract, transformLocal } from "../../lib/engine/math";
import { assessContactMatrix, contactCellKey, type ContactMatrixTrial } from "./contact-matrix";

async function main() {
  const input = process.argv[2] ?? "/tmp/magnatiles-loaded-contact-matrix.json";
  const output = process.argv[3] ?? "/tmp/magnatiles-loaded-contact-inspection.json";
  const bytes = await readFile(input);
  const data = JSON.parse(bytes.toString()) as { completed: boolean; trials: ContactMatrixTrial[] };
  const rows = data.trials.map(trial => {
    const base = trial.terminal.bodies.find(b => b.referenceTile.id === "roof" || b.referenceTile.id === "base")!;
    const deviations = trial.terminal.bodies.map(body => ({
      tileId: body.referenceTile.id,
      centerDifferenceRelativeToBase: distance(subtract(body.position, base.position),
        transformLocal(subtract(body.referenceTile.position, base.referenceTile.position), { x: 0, y: 0, z: 0 }, quaternionToBasis(base.rotation))),
      orientationDifferenceRelativeToBaseDegrees: quaternionAngle(body.rotation, base.rotation) * 180 / Math.PI,
    }));
    return { cell: contactCellKey(trial), passed: trial.passed,
      terminalPhase: trial.completed ? "completed duration" : "first failure",
      simulatedSeconds: trial.simulatedSeconds, peakPenetration: trial.peakPenetration,
      latePenetration: trial.latePenetration, observedLatePenetration: trial.observedLatePenetration,
      firstFailure: trial.firstFailure, finalSpeeds: trial.finalSpeeds,
      bodyCount: trial.terminal.bodies.length, activeJoints: trial.terminal.joints.map(j => j.model.id),
      poppedJoints: trial.terminal.poppedJoints, solidFailures: trial.terminal.solidFailures,
      maxCenterDifferenceRelativeToBase: Math.max(...deviations.map(d => d.centerDifferenceRelativeToBase)),
      maxOrientationDifferenceRelativeToBaseDegrees: Math.max(...deviations.map(d => d.orientationDifferenceRelativeToBaseDegrees)), deviations };
  });
  const assessment = assessContactMatrix(data.trials);
  await writeFile(output, JSON.stringify({ scope: "Static inspection of actual recorded terminal states. Failed or interrupted cells are not settled or accepted builds. No source or material calibration credit.",
    inputSha256: createHash("sha256").update(bytes).digest("hex"), completed: data.completed, assessment, rows }, null, 2) + "\n");
  for (const frequency of assessment.frequencies)
    console.log(`${frequency.frequency} Hz: ${frequency.passedTrials}/${frequency.totalTrials} ordinary passes; stricter convergence=${frequency.passed}; eligible=${frequency.eligible}`);
  console.log(`Complete=${data.completed}; selected=${assessment.selectedFrequency}`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
