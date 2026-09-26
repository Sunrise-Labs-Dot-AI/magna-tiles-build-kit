import { writeFile } from "node:fs/promises";
import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { createEngineWorld } from "../../lib/engine/rapier-world";
import { quaternionToBasis, transformLocal } from "../../lib/engine/math";
import { releaseCandidate } from "../../lib/replication/release";
import {
  assemble,
  outside,
  square,
  stageBuild,
  v,
} from "../../lib/replication/geometry";
import { geometryCheck } from "../../lib/replication/evaluate";
import { jet, smallRamp } from "../../lib/replication/models";
import { validationCodeHash } from "../../lib/replication/provenance";

async function main() {
  const aircraft = jet(),
    ramp = smallRamp();
  const stages = [
    ...aircraft.stages
      .filter((s) =>
        [
          "body-upright-1",
          "body-upright-4",
          "body-horizontal",
          "nose",
        ].includes(s.id),
      )
      .map((s) => ({ replica: aircraft, stage: s })),
    ...ramp.stages.map((stage) => ({ replica: ramp, stage })),
  ];
  const sourceFixtures = [];
  for (const { replica, stage } of stages) {
    const build = stageBuild(replica, stage),
      geometry = geometryCheck(build);
    const result =
      geometry.status === "pass" ? await releaseCandidate(build, 0) : null;
    sourceFixtures.push({
      id: stage.id,
      sourceSupport: stage.support,
      parts: build.tiles.length,
      geometry,
      simulatedWithoutHands: result && {
        stands: result.status === "pass",
        peakDisplacement: result.peakDisplacement,
        settledSteps: result.settledSteps,
        poppedJoints: result.poppedJoints,
      },
      interpretation:
        stage.support === "held"
          ? "Deliberately remove the source's hand support to diagnose the module. Failure is not evidence against the real held stage."
          : "A failure can be reconstruction error, material mismatch or simulator error; it does not identify the cause alone.",
    });
  }
  // Isolate one edge: a clamped vertical panel and a free horizontal panel.
  // The clamp is ONLY in this diagnostic, never added to a source replica.
  const support = square(
    "clamped",
    v(0, 0, 0),
    v(0, 3, 0),
    v(0, 0, 3),
    "#168db3",
    1,
    "fixture",
  );
  const leaf = outside(
    square(
      "leaf",
      v(0, 3.09, 0),
      v(3, 0, 0),
      v(0, 0, 3),
      "#f3bc25",
      1,
      "fixture",
    ),
    v(1, 2, 1),
  );
  const engine = await createEngineWorld(
    assemble(
      "hinge-fixture",
      "Uncalibrated hinge diagnostic",
      [support, leaf],
      "ramp",
    ),
    { drop: false },
  );
  const samples = [];
  try {
    engine.bodies.get("clamped")!.body.setBodyType(RigidBodyType.Fixed, true);
    for (let n = 0; n <= 240; n++) {
      if (n % 30 === 0) {
        const body = engine.bodies.get("leaf")!.body,
          normal = transformLocal(
            leaf.basis!.zAxis,
            v(0, 0, 0),
            quaternionToBasis(body.rotation()),
          );
        samples.push({
          seconds: n / 120,
          normal,
          position: { ...body.translation() },
          poppedJoints: [...engine.poppedJoints],
        });
      }
      engine.step();
    }
    await writeFile(
      "verification/replication/physics-fixtures.json",
      JSON.stringify(
        {
          schema: 1,
          validationCodeHash: await validationCodeHash(),
          sourceFixtures,
          clampedEdgeDiagnostic: {
            parts: 2,
            geometry: geometryCheck(
              assemble("hinge-fixture", "Diagnostic", [support, leaf], "ramp"),
            ),
            samples,
            interpretation:
              "The current revolute joint provides no restoring torque around the shared edge. This diagnostic exposes free angular sag. A calibrated magnet torque curve is needed before attributing source stability failures to geometry or changing the physical model. It is not a measurement of a real tile joint.",
          },
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    engine.dispose();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
