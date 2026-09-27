import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { createEngineWorld, perturbFirstRelease, type EngineState } from "@/lib/engine/rapier-world";
import { buildBounds, connectionId, validateMagneticBuild } from "@/lib/engine/build";
import { validateEngineInput } from "@/lib/engine/input";
import { MAX_STANDING_DISPLACEMENT, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SETTLED_REQUIRED_STEPS, SIMULATION_MAX_STEPS, SIMULATION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { add, distance, magnitude } from "@/lib/engine/math";
import { findRawOverlaps, RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import { contactsClosed } from "./contacts";
import { checkHandAccess, checkSupportFingerClearance, type HandContact } from "./grip";
import { findInsertionPath, type InsertionPath } from "./insertion";
import { supportSnapshot } from "./support";
import type { Check } from "./types";

// Resolve a falling panel's contact at 960 Hz. This refines collision integration;
// duration, rest time, forces, friction and geometric tolerances stay unchanged.
const SEATING_SUBSTEPS = 8;

export interface SeatingTrial extends Check {
  placement: "table" | "magnetic";
  seed: number;
  path: InsertionPath | null;
  releaseHeight: number;
  heldTileIds: string[];
  withheldJointIds: string[];
  activeJointIds: string[];
  earnedJointIds: string[];
  tableBearingTileIds: string[];
  peakTargetDisplacement: number;
  settledSteps: number;
  elapsedSeconds: number;
  poppedJoints: string[];
  /** Actual physics snapshots, never authored poses interpolated toward a target. */
  motion: { seconds: number; tiles: TileInstance[] }[];
  settled: BuildGraph;
  state?: EngineState;
}

/** An intentionally bounded operation, not a generic drop-to-fit solver. New
 * hinges are absent for the entire run. Only actual rested contacts may earn a
 * subsequent connected trial. A miss, slide or unstable impact must fail. */
export async function simulateGravitySeat(target: BuildGraph, movingTileIds: string[], hands: HandContact[], releaseHeight: number,
  floorY: number, seed: number, deadline = Infinity, state?: EngineState): Promise<SeatingTrial> {
  const moving = new Set(movingTileIds), fixed = target.tiles.filter(t => !moving.has(t.id)).map(t => t.id);
  const cross = target.connections.filter(c => moving.has(c.fromTileId) !== moving.has(c.toTileId));
  const result: SeatingTrial = { status: "fail", detail: "", placement: fixed.length ? "magnetic" : "table", seed, path: null, releaseHeight, heldTileIds: [],
    withheldJointIds: cross.map(connectionId), activeJointIds: [], earnedJointIds: [], tableBearingTileIds: [], peakTargetDisplacement: 0, settledSteps: 0, elapsedSeconds: 0, poppedJoints: [], motion: [], settled: target };
  const fail = (detail: string) => {
    if (result.motion.length && result.motion.at(-1)!.seconds !== result.elapsedSeconds)
      result.motion.push({ seconds: result.elapsedSeconds, tiles: result.settled.tiles });
    return { ...result, status: "fail" as const, detail };
  };
  if (validateEngineInput(target).length || !moving.size || moving.size !== movingTileIds.length ||
      movingTileIds.some(id => !target.tiles.some(t => t.id === id)) || !Number.isFinite(floorY) ||
      !Number.isFinite(releaseHeight) || releaseHeight < 0.05 || releaseHeight > 0.75)
    return fail("Invalid seating contract: release height must be 0.05–0.75 in, with known distinct moving parts.");
  if (fixed.length && !cross.length) return fail("No intended moving-to-installed magnetic contact.");
  const released = { ...target, tiles: target.tiles.map(t => moving.has(t.id) ? { ...t, position: add(t.position, { x: 0, y: releaseHeight, z: 0 }) } : t),
    connections: target.connections.filter(c => moving.has(c.fromTileId) === moving.has(c.toTileId)) };
  // Validate both components independently. Only this deliberate split is allowed;
  // absent internal joins and malformed references are never ignored.
  for (const isMoving of [false, true]) {
    const part = { ...released, tiles: released.tiles.filter(t => moving.has(t.id) === isMoving),
      connections: released.connections.filter(c => moving.has(c.fromTileId) === isMoving) };
    if (part.tiles.length && contactsClosed(part).status !== "pass") return fail("Installed or moving component has invalid internal contacts.");
  }
  if (findRawOverlaps(released.tiles).length || buildBounds(released.tiles).min.y < floorY - RAW_OVERLAP_TOLERANCE)
    return fail("Release pose intersects a present solid or the fixed table.");
  for (const c of cross) {
    const pair = { ...released, tiles: released.tiles.filter(t => t.id === c.fromTileId || t.id === c.toTileId), connections: [c] };
    if (contactsClosed(pair).status === "pass") return fail("Release begins already connected; seating must earn separated contacts.");
  }
  const path = findInsertionPath(released, movingTileIds, fixed, deadline, floorY);
  result.path = path;
  if (!path) return fail("No clear approach to the release pose.");
  const grip = checkHandAccess(released, path, hands, floorY);
  if (grip.status !== "pass") return fail(grip.detail);
  const supportHands = hands.filter(h => !moving.has(h.tileId));
  result.heldTileIds = supportHands.map(h => h.tileId);
  const engine = await createEngineWorld(released, { drop: false, floorY, state });
  try {
    engine.world.integrationParameters.dt = SIMULATION_TIMESTEP_SECONDS / SEATING_SUBSTEPS;
    // Graph disconnection is expected only between the two independently validated
    // components. There is no relaxed engine-wide validation mode.
    const expected = validateMagneticBuild(released).rejectedReasons;
    if (expected.some(reason => !reason.startsWith("disconnected-tile:") && reason !== "no-valid-magnetic-joints"))
      return fail(`Invalid seating graph: ${expected.join("; ")}`);
    result.activeJointIds = engine.joints.map(j => j.id);
    for (const [i, [id, { body }]] of [...engine.bodies.entries()].entries()) {
      body.enableCcd(true);
      if (result.heldTileIds.includes(id)) body.setBodyType(RigidBodyType.Fixed, true);
      else {
        body.setBodyType(RigidBodyType.Dynamic, true);
        perturbFirstRelease(engine.bodies.get(id)!, i, seed);
      }
    }
    const targetVertices = new Map(target.tiles.map(t => [t.id, tilePrismVertices(t)]));
    result.motion.push({ seconds: 0, tiles: released.tiles });
    let previous = released;
    let settledSubsteps = 0;
    for (let step = 0; step < SIMULATION_MAX_STEPS * SEATING_SUBSTEPS; step++) {
      if (step % 32 === 0 && Date.now() > deadline) throw new SimulationBudgetExceeded();
      engine.step();
      const actual = supportSnapshot(released, engine);
      result.elapsedSeconds = (step + 1) * SIMULATION_TIMESTEP_SECONDS / SEATING_SUBSTEPS;
      result.settled = { ...actual, connections: target.connections };
      result.peakTargetDisplacement = Math.max(result.peakTargetDisplacement, ...actual.tiles.flatMap(t =>
        tilePrismVertices(t).map((p, i) => distance(p, targetVertices.get(t.id)![i]))));
      const dynamic = [...engine.bodies.entries()].filter(([id]) => !result.heldTileIds.includes(id));
      const linear = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.linvel())));
      const angular = Math.max(0, ...dynamic.map(([, r]) => magnitude(r.body.angvel())));
      settledSubsteps = linear < SETTLED_LINEAR_SPEED && angular < SETTLED_ANGULAR_SPEED ? settledSubsteps + 1 : 0;
      result.settledSteps = Math.floor(settledSubsteps / SEATING_SUBSTEPS);
      result.poppedJoints = [...engine.poppedJoints];
      if (buildBounds(actual.tiles).min.y < floorY - RAW_OVERLAP_TOLERANCE)
        return fail("A seated panel penetrates the fixed table beyond the unchanged solid-overlap tolerance.");
      if (findRawOverlaps(actual.tiles).length) return fail("An impact exceeds the unchanged solid-overlap tolerance.");
      const clearance = checkSupportFingerClearance(actual, supportHands, floorY, previous);
      previous = actual;
      if (step % (8 * SEATING_SUBSTEPS) === 0 || step === SIMULATION_MAX_STEPS * SEATING_SUBSTEPS - 1)
        result.motion.push({ seconds: result.elapsedSeconds, tiles: actual.tiles });
      if (!Number.isFinite(result.peakTargetDisplacement) || result.peakTargetDisplacement > MAX_STANDING_DISPLACEMENT || result.poppedJoints.length)
        return fail("Released parts leave the unchanged target displacement limit or break an existing join.");
      if (clearance.status !== "pass") return fail(clearance.detail);
    }
    if (result.settledSteps < SETTLED_REQUIRED_STEPS) return fail(`Seating did not reach sustained rest: ${result.settledSteps}/90 steps.`);
    const closure = contactsClosed(result.settled);
    if (closure.status !== "pass") return fail(`Rested seating did not earn the intended contacts: ${closure.detail}`);
    const valid = validateMagneticBuild(result.settled).validConnections;
    result.earnedJointIds = valid.filter(c => moving.has(c.fromTile.id) !== moving.has(c.toTile.id)).map(c => c.id);
    if (new Set(result.withheldJointIds).size !== cross.length || result.earnedJointIds.length !== cross.length ||
        result.withheldJointIds.some(id => !result.earnedJointIds.includes(id)))
      return fail("The actual closed cross-module contacts do not match every withheld target edge.");
    if (result.placement === "table") {
      const tileBodies = new Set([...engine.bodies.values()].map(r => r.body.handle));
      for (const [id, { body }] of engine.bodies) {
        const collider = body.collider(0);
        engine.world.contactPairsWith(collider, other => {
          if (other.parent() && tileBodies.has(other.parent()!.handle)) return;
          engine.world.contactPair(collider, other, manifold => {
            if (Array.from({ length: manifold.numSolverContacts() }, (_, i) => manifold.solverContactDist(i))
              .some(d => Math.abs(d) <= RAW_OVERLAP_TOLERANCE) && !result.tableBearingTileIds.includes(id)) result.tableBearingTileIds.push(id);
          });
        });
      }
      if (!result.tableBearingTileIds.length) return fail("First placement has no actual supporting contact with the fixed table.");
    }
    result.state = engine.snapshot();
    return { ...result, status: "pass", detail: result.placement === "table"
      ? `Placed on the fixed table with ${result.tableBearingTileIds.length} measured bearing contact(s) and ${result.settledSteps} rest steps. No new magnetic contact is claimed.`
      : `Gravity seating earned all ${cross.length} named cross-module contacts after ${result.settledSteps} rest steps; all new joints were absent throughout the fall. Connected support/release is checked separately.` };
  } finally { engine.dispose(); }
}
