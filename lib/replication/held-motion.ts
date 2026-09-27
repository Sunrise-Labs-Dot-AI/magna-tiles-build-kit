import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { createEngineWorld, perturbFirstRelease, type EngineState } from "@/lib/engine/rapier-world";
import { MAX_STANDING_DISPLACEMENT, SETTLED_ANGULAR_SPEED, SETTLED_LINEAR_SPEED, SETTLED_REQUIRED_STEPS, SIMULATION_MAX_STEPS, SIMULATION_TIMESTEP_SECONDS } from "@/lib/engine/constants";
import { add, distance, inverseQuaternion, magnitude, multiplyQuaternions, quaternionAngle, quaternionToBasis, scale, slerp, subtract, transformLocal, type Quat } from "@/lib/engine/math";
import { validateEngineInput } from "@/lib/engine/input";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { tilePrismVertices } from "@/lib/magnetic-tiles/prism-geometry";
import type { BuildGraph, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";
import { contactsClosed } from "./contacts";
import { checkHandAccess, checkMotionFingerClearance, type HandContact } from "./grip";
import { checkSweptPoses, tileQuaternion } from "./rotation-clearance";
import { supportSnapshot } from "./support";
import type { Check } from "./types";
import { compactMotion } from "./motion-recording";

export interface HeldWaypoint { seconds: number; position: Vec3; rotation: Quat }
export interface HeldMotionTrial extends Check {
  heldTileIds: string[];
  dynamicTileCount: number;
  peakDeformation: number;
  settledSteps: number;
  poppedJoints: string[];
  motion: { seconds: number; tiles: TileInstance[] }[];
  settled: BuildGraph;
  state?: EngineState;
}

/** Only the named pickup panel follows the commanded rigid motion. Its neighbors
 * remain dynamic on their original magnetic hinges; installed obstacles remain
 * present. A nominal rigid transform is a measurement baseline, never a force. */
export async function simulateHeldMotion(build: BuildGraph, state: EngineState | undefined, movingTileIds: string[], hands: HandContact[],
  waypoints: HeldWaypoint[], floorY: number, seed: number, deadline = Infinity): Promise<HeldMotionTrial> {
  const result: HeldMotionTrial = { status: "fail", detail: "", heldTileIds: hands.map(h => h.tileId), dynamicTileCount: build.tiles.length-hands.length,
    peakDeformation: 0, settledSteps: 0, poppedJoints: [], motion: [], settled: build };
  const fail = (detail: string): HeldMotionTrial => ({ ...result, motion: compactMotion(result.motion), detail });
  const moving = new Set(movingTileIds), held = hands.find(h => moving.has(h.tileId));
  if (validateEngineInput(build).length || !Number.isFinite(floorY) || !moving.size || moving.size !== movingTileIds.length ||
    movingTileIds.some(id => !build.tiles.some(t => t.id === id)) || !held || hands.length > 2 ||
    new Set(hands.map(h => h.tileId)).size !== hands.length || hands.filter(h => moving.has(h.tileId)).length !== 1 ||
    hands.some(h => !build.tiles.some(t => t.id === h.tileId))) return fail("Motion needs one pickup-panel grip and at most one installed-panel support.");
  if (waypoints.length < 2 || waypoints.length > 16 || waypoints[0].seconds !== 0 || waypoints.at(-1)!.seconds > 30 ||
    waypoints.some(p => !p.position || !p.rotation || ![p.seconds, ...Object.values(p.position), ...Object.values(p.rotation)].every(Number.isFinite) ||
      Math.abs(Math.hypot(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w)-1) > 1e-6)) return fail("Motion needs 2–16 finite unit-rotation waypoints over at most 30 seconds.");
  const start = build.tiles.find(t => t.id === held.tileId)!, startQ = tileQuaternion(start);
  if (distance(start.position, waypoints[0].position) > 1e-5 || quaternionAngle(startQ, waypoints[0].rotation) > 1e-5) return fail("Motion would jump from the actual pickup pose.");
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i-1], b = waypoints[i], dt = b.seconds-a.seconds;
    if (dt <= 0 || distance(a.position,b.position)/dt > 2+1e-6 || quaternionAngle(a.rotation,b.rotation)/dt > 1+1e-6)
      return fail("Motion exceeds bounded translation/angular speed or has unordered waypoints.");
  }
  if (build.connections.some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId))) return fail("Transfer must not pre-attach a new module to installed parts.");
  for (const inside of [true, false]) {
    const part = { ...build, tiles: build.tiles.filter(t => moving.has(t.id) === inside),
      connections: build.connections.filter(c => moving.has(c.fromTileId) === inside) };
    if (part.tiles.length && contactsClosed(part).status !== "pass") return fail("A carried or installed component has missing/invalid internal contacts.");
  }
  const access = (actual: BuildGraph) => checkHandAccess(actual, { id: "pickup", movingTileIds, fixedTileIds: build.tiles.filter(t => !moving.has(t.id)).map(t => t.id),
    offsets: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] }, hands, floorY);
  const grip = access(build);
  if (grip.status !== "pass") return fail(grip.detail);
  const initialClearance = checkSweptPoses(build, build, floorY, deadline);
  if (initialClearance.status !== "pass") return fail(initialClearance.detail);
  const engine = await createEngineWorld(build, { drop: false, floorY, state });
  const dt = SIMULATION_TIMESTEP_SECONDS/4, duration = waypoints.at(-1)!.seconds;
  const heldBody = engine.bodies.get(held.tileId)!, referenceQ = tileQuaternion(heldBody.tile);
  const command = (seconds: number) => {
    const index = Math.max(1, waypoints.findIndex(p => p.seconds >= seconds));
    if (seconds >= duration) return waypoints.at(-1)!;
    const a = waypoints[index-1], b = waypoints[index], t = (seconds-a.seconds)/(b.seconds-a.seconds);
    return { seconds, position: add(scale(a.position,1-t),scale(b.position,t)), rotation: slerp(a.rotation,b.rotation,t) };
  };
  try {
    engine.world.integrationParameters.dt = dt;
    for (const [i, [id, { body }]] of [...engine.bodies.entries()].entries()) {
      body.enableCcd(true);
      body.setBodyType(id === held.tileId ? RigidBodyType.KinematicPositionBased : hands.some(h => h.tileId === id) ? RigidBodyType.Fixed : RigidBodyType.Dynamic, true);
      if (!hands.some(h => h.tileId === id)) perturbFirstRelease(engine.bodies.get(id)!, i, seed);
    }
    let previous = build, rest = 0;
    result.motion.push({ seconds: 0, tiles: build.tiles });
    const steps = Math.ceil(duration/dt) + SIMULATION_MAX_STEPS*4;
    for (let i = 0; i < steps; i++) {
      if (i % 32 === 0 && Date.now() > deadline) throw new SimulationBudgetExceeded();
      const seconds = (i+1)*dt, desired = command(Math.min(seconds, duration));
      heldBody.body.setNextKinematicTranslation({ ...desired.position, y: desired.position.y-floorY });
      heldBody.body.setNextKinematicRotation(multiplyQuaternions(desired.rotation, inverseQuaternion(referenceQ)));
      engine.step();
      const actual = supportSnapshot(build, engine);
      result.settled = actual;
      const rotation = multiplyQuaternions(desired.rotation, inverseQuaternion(startQ));
      const expected = build.tiles.map(t => moving.has(t.id) ? { ...t,
        position: add(desired.position, transformLocal(subtract(t.position,start.position), { x: 0,y: 0,z: 0 }, quaternionToBasis(rotation))),
        basis: quaternionToBasis(multiplyQuaternions(rotation,tileQuaternion(t))) } : t);
      for (const [j,tile] of actual.tiles.entries()) {
        const target = tilePrismVertices(expected[j]);
        result.peakDeformation = Math.max(result.peakDeformation, ...tilePrismVertices(tile).map((p,k) => distance(p,target[k])));
      }
      result.poppedJoints = [...engine.poppedJoints];
      const solids = checkSweptPoses(previous, actual, floorY, deadline), fingers = checkMotionFingerClearance(previous, actual, hands, floorY);
      const dynamic = [...engine.bodies].filter(([id]) => !hands.some(h => h.tileId === id));
      rest = seconds >= duration && dynamic.every(([,r]) => magnitude(r.body.linvel()) < SETTLED_LINEAR_SPEED && magnitude(r.body.angvel()) < SETTLED_ANGULAR_SPEED) ? rest+1 : 0;
      result.settledSteps = Math.floor(rest/4);
      const error = !Number.isFinite(result.peakDeformation) || result.peakDeformation > MAX_STANDING_DISPLACEMENT || result.poppedJoints.length
        ? "A dynamic panel deforms beyond the unchanged limit or breaks a magnetic join during carry."
        : solids.status !== "pass" ? solids.detail : fingers.status !== "pass" ? fingers.detail : null;
      if (i % 32 === 0 || i === steps-1 || error) result.motion.push({ seconds, tiles: actual.tiles });
      previous = actual;
      if (error) { result.state = engine.snapshot(); return fail(error); }
    }
    result.state = engine.snapshot();
    if (result.settledSteps < SETTLED_REQUIRED_STEPS) return fail(`Carried module did not settle: ${result.settledSteps}/90 rest steps.`);
    const finalGrip = access(result.settled);
    if (finalGrip.status !== "pass") return fail(finalGrip.detail);
    return { ...result, motion: compactMotion(result.motion), status: "pass", detail: "One pickup panel completed the continuous held trajectory; every other panel remained dynamic, with swept solid/fingertip clearance and sustained rest." };
  } finally { engine.dispose(); }
}
