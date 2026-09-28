/** Geometric diagnostic only: can the current shared-edge hinge axis fold two
 * finite catalog prisms through the canonical triangular-ring link turn?
 * No native dynamics, material calibration, source pose fit or acceptance. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createMagneticPhysicsModel } from "../../lib/engine/physics-model";
import { add, cross, distance, dot, normalize, scale, subtract } from "../../lib/engine/math";
import { RAW_OVERLAP_TOLERANCE, findRawOverlaps } from "../../lib/engine/overlap";
import { checkSolidSweep, prismPose } from "../../lib/magnetic-tiles/swept-prisms";
import type { Vec3 } from "../../lib/magnetic-tiles/types";
import { assemble, square, v } from "../../lib/replication/geometry";
import { contactsClosed } from "../../lib/replication/contacts";
import { checkSweptPoses } from "../../lib/replication/rotation-clearance";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";

async function main() {
  const context = { validationCodeHash: await validationCodeHash(), scriptHashes: await artifactHashes([
    "scripts/reference/probe-fold-clearance.ts",
  ]) };
  const rows = [];
  // .36 is an explicitly separated control, not an allowed initial contact.
  for (const gap of [0, .03, .09, .18, .21, .36]) for (const direction of [-1, 1]) {
    const fixed = square("fixed", v(-3, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip");
    const moving = square("moving", v(gap, 0, 0), v(3, 0, 0), v(0, 3, 0), "blue", 1, "strip");
    const build = assemble(`gap-${gap}`, "Two-panel fold diagnostic", [fixed, moving], "tower");
    const model = createMagneticPhysicsModel(build, { drop: false, floorY: 0 });
    assert.equal(model.joints.length, 1, "Expected the actual model's one proposed hinge");
    const joint = model.joints[0];
    assert.equal(joint.fromTileId, fixed.id); assert.equal(joint.toTileId, moving.id);
    const anchor = add(fixed.position, joint.fromLocalAnchor), axis = normalize(joint.axis);
    const anchorRoundtripGap = distance(anchor, add(moving.position, joint.toLocalAnchor));
    // Adding back independently subtracted world coordinates can differ by an
    // IEEE-754 rounding unit. This checks diagnostic setup, not physical clearance.
    assert(anchorRoundtripGap < 1e-12);
    const pose = (degrees: number) => {
      const angle = direction * degrees * Math.PI / 180;
      const rotate = (p: Vec3) => add(add(scale(p, Math.cos(angle)), scale(cross(axis, p), Math.sin(angle))),
        scale(axis, dot(axis, p) * (1 - Math.cos(angle))));
      return { ...build, tiles: [fixed, { ...moving,
        position: add(anchor, rotate(subtract(moving.position, anchor))),
        basis: { xAxis: rotate(moving.basis!.xAxis), yAxis: rotate(moving.basis!.yAxis), zAxis: rotate(moving.basis!.zAxis) },
      }] };
    };
    let previous = build;
    const segments = [];
    for (let degrees = 5; degrees <= 120; degrees += 5) {
      const actual = pose(degrees);
      const engine = checkSolidSweep(previous.tiles.map(prismPose), actual.tiles.map(prismPose), 0, RAW_OVERLAP_TOLERANCE);
      const caller = checkSweptPoses(previous, actual, 0);
      segments.push({ fromDegrees: degrees - 5, toDegrees: degrees, engine, caller,
        endpointOverlaps: findRawOverlaps(actual.tiles), endpoint: actual.tiles });
      previous = actual;
    }
    rows.push({ gap, direction, initialClosure: contactsClosed(build), build, joint, anchor, axis, anchorRoundtripGap,
      firstEngineFailure: segments.find(s => s.engine.failure)?.toDegrees ?? null,
      firstCallerFailure: segments.find(s => s.caller.status !== "pass")?.toDegrees ?? null, segments });
  }
  assert.equal(await validationCodeHash(), context.validationCodeHash, "Runtime changed during probe");
  assert.deepEqual(await artifactHashes(Object.keys(context.scriptHashes)), context.scriptHashes);
  await writeFile("/tmp/magnatiles-fold-clearance.json", JSON.stringify({
    scope: "Geometric hinge-axis diagnostic only. The 120-degree turn is the canonical equal-panel triangular-ring geometry, not a measured source angle. No dynamics or source acceptance.",
    context, rows,
  }, null, 2) + "\n");
  console.log(JSON.stringify(rows.map(({ gap, direction, initialClosure, firstEngineFailure, firstCallerFailure }) =>
    ({ gap, direction, initialClosure: initialClosure.status, firstEngineFailure, firstCallerFailure })), null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
