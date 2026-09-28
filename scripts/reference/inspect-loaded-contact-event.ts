/** Reproduce one predeclared baseline cell and inspect its first failure.
 * This is diagnostic only; no settings, material properties or limits change. */
import { writeFile } from "node:fs/promises";
import { createEngineWorld, currentTilePose } from "../../lib/engine/rapier-world";
import { tilePrismVertices } from "../../lib/magnetic-tiles/prism-geometry";
import { artifactHashes, validationCodeHash } from "../../lib/replication/provenance";
import { loadedShellContactFixture } from "../../tests/fixtures/loaded-contact";
import { assertContactFixture, simulateContactCell } from "./contact-matrix";

async function main() {
  const build = loadedShellContactFixture(6);
  assertContactFixture(build);
  const engine = await createEngineWorld(build, { drop: true, floorY: 0 });
  try {
    const trial = simulateContactCell(engine, { fixture: build.id, frequency: 120, hz: 960, solver: 16, seed: 0 });
    const bodyIds = new Map([...engine.bodies.values()].map(r => [r.body.handle, r.tile.id]));
    const seen = new Set<string>(), contacts: unknown[] = [];
    for (const { body } of engine.bodies.values()) {
      const collider = body.collider(0);
      engine.world.contactPairsWith(collider, other => {
        const handles = [collider.handle, other.handle].sort((a, b) => a-b).join("/");
        if (seen.has(handles)) return;
        seen.add(handles);
        engine.world.contactPair(collider, other, (m, flipped) => {
          contacts.push({ first: bodyIds.get(body.handle), second: bodyIds.get(other.parent()!.handle) ?? "table", flipped,
            normal: { ...m.normal() },
            contacts: Array.from({ length: m.numContacts() }, (_, i) => ({
              localPoint1: m.localContactPoint1(i), localPoint2: m.localContactPoint2(i),
              distance: m.contactDist(i), impulse: m.contactImpulse(i),
              tangentImpulseX: m.contactTangentImpulseX(i), tangentImpulseY: m.contactTangentImpulseY(i),
            })),
            solverContacts: Array.from({ length: m.numSolverContacts() }, (_, i) => ({
              point: { ...m.solverContactPoint(i) }, distance: m.solverContactDist(i),
              friction: m.solverContactFriction(i), restitution: m.solverContactRestitution(i),
            })),
          });
        });
      });
    }
    const bodies = trial.terminal.bodies.map(b => ({ tileId: b.referenceTile.id,
      mass: engine.bodies.get(b.referenceTile.id)!.body.mass(), bodyType: b.bodyType,
      minimumY: Math.min(...tilePrismVertices(currentTilePose(b.referenceTile, b.position, b.rotation, 0)).map(v => v.y)),
      linearVelocity: b.linearVelocity, angularVelocity: b.angularVelocity,
    }));
    const output = { scope: "First failure in the unchanged 25-panel/120Hz/960Hz/16-solver/seed-0 baseline. Native manifolds are those of the last solver step; current solid guard poses are recorded separately. No source or acceptance credit.",
      validationCodeHash: await validationCodeHash(), scriptHashes: await artifactHashes([
        "scripts/reference/inspect-loaded-contact-event.ts", "scripts/reference/contact-matrix.ts", "tests/fixtures/loaded-contact.ts"]),
      build, trial, bodies, contacts };
    await writeFile("/tmp/magnatiles-loaded-contact-event.json", JSON.stringify(output, null, 2) + "\n");
    console.log(JSON.stringify({ failure: trial.firstFailure, solidFailures: trial.terminal.solidFailures,
      peak: trial.peakPenetration, popped: trial.terminal.poppedJoints, bodies: bodies.length, contactPairs: seen.size }));
  } finally { engine.dispose(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
