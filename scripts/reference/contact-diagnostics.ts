import { writeFile } from "node:fs/promises";
import { createEngineWorld } from "../../lib/engine/rapier-world";
import { closedShell } from "../../tests/fixtures/closed-shell";
import { validateMagneticBuild } from "../../lib/engine/build";
import { findRawOverlaps } from "../../lib/engine/overlap";
import { SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED } from "../../lib/engine/constants";

async function main() {
  const trials = [];
  for (const levels of [1, 2, 3]) for (const skin of [0.006, 0]) {
    const build = closedShell(levels), engine = await createEngineWorld(build);
    let peak = 0, rest = 0, tailPeakSpeed = 0;
    try {
      for (const { body } of engine.bodies.values()) body.collider(0).setContactSkin(skin);
      const magnitude = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
      for (let n = 0; n < 900; n++) {
        engine.step(); peak = Math.max(peak, engine.maxDisplacement());
        const linear = Math.max(...[...engine.bodies.values()].map(r => magnitude(r.body.linvel())));
        const angular = Math.max(...[...engine.bodies.values()].map(r => magnitude(r.body.angvel())));
        rest = linear < SETTLED_LINEAR_SPEED && angular < SETTLED_ANGULAR_SPEED ? rest + 1 : 0;
        if (n > 660) tailPeakSpeed = Math.max(tailPeakSpeed, engine.maxSpeed());
      }
      trials.push({ levels, pieces: build.tiles.length, skin, peakDisplacement: peak,
        finalSpeed: engine.maxSpeed(), tailPeakSpeed, restSteps: rest,
        rejected: validateMagneticBuild(build).rejectedReasons, rawOverlaps: findRawOverlaps(build.tiles),
        poppedJoints: engine.poppedJoints });
    } finally { engine.dispose(); }
  }
  await writeFile("verification/replication/contact-diagnostics.json", JSON.stringify({
    schema: 1,
    interpretation: "Identical finite-thickness shell geometry and material constants, changing only the artificial contact margin. Positive skin opposes flush hinge constraints and injects motion. Zero skin preserves full physical hulls and all contact pairs. This tests numerical consistency, not real magnetic force calibration.",
    trials,
  }, null, 2) + "\n");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
