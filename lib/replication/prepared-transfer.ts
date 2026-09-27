import { connectionId, validateMagneticBuild } from "@/lib/engine/build";
import { add, distance, inverseQuaternion, magnitude, multiplyQuaternions, quaternionAngle, quaternionToBasis, scale, subtract, transformLocal } from "@/lib/engine/math";
import type { EngineState } from "@/lib/engine/rapier-world";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import { contactsClosed } from "./contacts";
import { dockToSupports, type DockingPolicy, type DockingResult } from "./docking";
import { checkHandAccess, type HandContact } from "./grip";
import { simulateHeldMotion, type HeldMotionTrial, type HeldWaypoint } from "./held-motion";
import { validateInsertionPath, type InsertionPath } from "./insertion";
import { tileQuaternion } from "./rotation-clearance";
import { simulateSupport, type SupportTrial } from "./support";
import type { Check } from "./types";
import { componentContacts } from "./components";
import { physicalConnectionId } from "./contact-arrival";

export interface TransferEvidence extends Check {
  /** Directed authored engine IDs: these exact definitions are appended later. */
  withheldCrossConnectionIds: string[];
  activeJointIdsBeforeClosure: string[];
  earnedCrossConnectionIds: string[];
  /** Unordered physical edge identities, independently matched at actual arrival. */
  physicalCrossConnectionIds: string[];
  previousHands: HandContact[];
  retainedHands: HandContact[];
}
export interface PreparedTransferTrial extends TransferEvidence {
  settled: BuildGraph;
  state: EngineState;
  handoff?: SupportTrial;
  carry?: HeldMotionTrial;
  docking?: DockingResult;
  path?: InsertionPath;
}

/** Rigid target proposal preserves the module's actual relative deformations.
 * The returned geometry is never installed as physical state. */
export function transferTarget(nominal: BuildGraph, actual: BuildGraph, movingIds: string[], heldId: string): BuildGraph {
  const start = actual.tiles.find(t => t.id === heldId)!, target = nominal.tiles.find(t => t.id === heldId)!;
  const rotation = multiplyQuaternions(tileQuaternion(target),inverseQuaternion(tileQuaternion(start))), basis = quaternionToBasis(rotation);
  return { ...actual, connections: nominal.connections, tiles: actual.tiles.map(t => movingIds.includes(t.id) ? { ...t,
    position: add(target.position,transformLocal(subtract(t.position,start.position),{ x: 0,y: 0,z: 0 },basis)),
    basis: quaternionToBasis(multiplyQuaternions(rotation,tileQuaternion(t))) } : t) };
}

export function transferWaypoints(actual: BuildGraph, target: BuildGraph, heldId: string, path: InsertionPath, floorY: number, transitHeight: number): HeldWaypoint[] {
  const start = actual.tiles.find(t => t.id === heldId)!, end = target.tiles.find(t => t.id === heldId)!;
  const highY = floorY+transitHeight, startQ = tileQuaternion(start), endQ = tileQuaternion(end);
  if (!Number.isFinite(transitHeight) || transitHeight < 3 || transitHeight > 12 || highY < Math.max(start.position.y,end.position.y+path.offsets[0].y))
    throw new Error("Prepared transfer needs a bounded transit height above pickup and approach.");
  const points: HeldWaypoint[] = [{ seconds: 0,position: start.position,rotation: startQ }];
  const push = (position: Vec3,rotation = endQ) => {
    const previous = points.at(-1)!;
    points.push({ position,rotation,seconds: previous.seconds+Math.max(.1,distance(previous.position,position)/1.5,quaternionAngle(previous.rotation,rotation)/.75) });
  };
  push({ ...start.position,y: highY },startQ);
  push({ ...start.position,y: highY });
  push({ ...add(end.position,path.offsets[0]),y: highY });
  for (const [index,offset] of path.offsets.entries()) {
    push(add(end.position,offset));
    if(index===0) push(add(end.position,offset)); // Stationary, actual separation checkpoint before closing.
  }
  return points;
}

/** Continue a prepared world through withdrawal, lift, rotation and insertion.
 * Cross-module connections only enter the returned build after actual closure. */
export async function simulatePreparedTransfer(nominal: BuildGraph, actual: BuildGraph, state: EngineState, movingIds: string[],
  previousHands: HandContact[], hands: HandContact[], transitHeight: number, floorY: number, seed: number, deadline: number, components: string[][], policy: DockingPolicy): Promise<PreparedTransferTrial> {
  const moving = new Set(movingIds), fixed = actual.tiles.filter(t => !moving.has(t.id)).map(t => t.id);
  const cross = nominal.connections.filter(c => moving.has(c.fromTileId) !== moving.has(c.toTileId));
  const expected = cross.map(connectionId).sort();
  const result: PreparedTransferTrial = { status: "fail",detail: "",settled: actual,state,
    withheldCrossConnectionIds: expected,physicalCrossConnectionIds:cross.map(physicalConnectionId).sort(),activeJointIdsBeforeClosure: state.joints.map(j => j.model.id),earnedCrossConnectionIds: [],previousHands,retainedHands: hands };
  const fail = (detail: string) => ({ ...result,detail });
  const retained = hands.length === 1 && previousHands.some(h => JSON.stringify(h) === JSON.stringify(hands[0]));
  if (hands.length !== 1 || !moving.has(hands[0].tileId) || !retained ||
      previousHands.length !== 2 || previousHands.some(h => !moving.has(h.tileId)) || new Set(previousHands.map(h => h.tileId)).size !== previousHands.length)
    return fail("Transfer requires two prior module hands and one unchanged retained grip after explicit withdrawal of the other hand.");
  if (components.length !== 2 || componentContacts(actual,components).status !== "pass" ||
      !components.some(group => group.length === movingIds.length && group.every(id => moving.has(id))))
    return fail("Prepared transfer supports exactly the declared carried module and one installed component; other component partitions require a separate contract.");
  if (!expected.length || new Set(expected).size !== expected.length || actual.connections.some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId)) ||
      state.connections.some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId)) || state.poppedJoints.length ||
      state.joints.some(j => moving.has(j.model.fromTileId) !== moving.has(j.model.toTileId)))
    return fail("Prepared transfer has missing, duplicated, broken or pre-attached cross connections.");
  // Treat the retained pickup panel alone as 'moving' for the stationary two-hand
  // access check so the old side grip is checked as a removable support hand.
  const accessFor = (build: BuildGraph, contacts: HandContact[]) => checkHandAccess(build,{ id: "prepared-handoff",movingTileIds: [contacts[0].tileId],
    fixedTileIds: build.tiles.filter(t => t.id !== contacts[0].tileId).map(t => t.id),offsets: [{ x: 0,y: 0,z: 0 },{ x: 0,y: 0,z: 0 }] },contacts,floorY);
  const access = accessFor(actual,previousHands);
  if (access.status !== "pass") return fail(access.detail);
  const acquisition = accessFor(actual,hands);
  if (acquisition.status !== "pass") return fail(acquisition.detail);
  result.handoff = await simulateSupport(actual,hands.map(h => h.tileId),floorY,seed,deadline,state,hands,components);
  result.settled = result.handoff.settled; result.state = result.handoff.state;
  if (result.handoff.status !== "pass") return fail(result.handoff.detail);
  const withdrawal = accessFor(result.settled,hands);
  if (withdrawal.status !== "pass") return fail(withdrawal.detail);
  const start = result.settled;
  const proposal = transferTarget(nominal,start,movingIds,hands[0].tileId);
  const docking = dockToSupports(nominal,proposal,movingIds,fixed,hands,floorY,policy,deadline);
  result.docking = docking;
  if (docking.status !== "pass" || !docking.path) return fail(docking.detail);
  // The general insertion search starts beyond the entire build's bounding box.
  // A prepared transfer already has its own checked transit. Use a shorter,
  // independently checked final approach, with every intended join separated.
  let path = docking.path;
  for (const separation of [1.5,3,4.5]) {
    const offset = scale(path.offsets[0],Math.min(1,separation/magnitude(path.offsets[0])));
    const candidate = { ...path,offsets: [offset,...path.offsets.slice(1)] };
    const separated = cross.every(c => {
      const pair = [c.fromTileId,c.toTileId].map(id => {
        const tile = docking.build.tiles.find(t => t.id === id)!;
        return moving.has(id) ? { ...tile,position: add(tile.position,offset) } : tile;
      });
      return !findMagneticEdgeMatch(pair[0],pair[1]);
    });
    if (separated && validateInsertionPath(docking.build,candidate,deadline,floorY).status === "pass" && checkHandAccess(docking.build,candidate,hands,floorY).status === "pass") {
      path = candidate; break;
    }
  }
  result.path = path;
  let waypoints: HeldWaypoint[];
  try { waypoints = transferWaypoints(start,docking.build,hands[0].tileId,path,floorY,transitHeight); }
  catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
  result.carry = await simulateHeldMotion(start,result.state,movingIds,hands,waypoints,floorY,seed,deadline,components,
    {connections:cross,separationWaypoint:waypoints.length-path.offsets.length-1});
  result.settled = result.carry.settled; result.state = result.carry.state ?? result.state;
  result.activeJointIdsBeforeClosure = result.state.joints.map(j => j.model.id);
  if (result.carry.status !== "pass"||result.carry.completion!=="contact-arrival") return fail(result.carry.detail);
  if(JSON.stringify(result.carry.arrivalContacts?.sourceConnectionIds)!==JSON.stringify(expected)||
      JSON.stringify(result.carry.arrivalContacts?.physicalConnectionIds)!==JSON.stringify(result.physicalCrossConnectionIds))
    return fail("Actual contact evidence differs from the directed source joins or their physical edge pairs.");
  if (result.state.connections.some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId)) || result.state.joints.some(j => expected.includes(j.model.id)))
    return fail("A withheld cross connection appeared before validated closure.");
  for (const c of cross) {
    const a = start.tiles.find(t => t.id === c.fromTileId)!, b = start.tiles.find(t => t.id === c.toTileId)!;
    if (findMagneticEdgeMatch(a,b)) return fail("Prepared transfer starts already attached to the installed module.");
  }
  const joined = { ...result.settled,connections: [...result.settled.connections,...cross] };
  const closure = contactsClosed(joined);
  if (closure.status !== "pass") return fail(closure.detail);
  const earned = validateMagneticBuild(joined).validConnections.filter(c => moving.has(c.fromTile.id) !== moving.has(c.toTile.id)).map(c => c.id).sort();
  if (JSON.stringify(earned) !== JSON.stringify(expected)) return fail("Actual terminal contacts do not earn the exact required cross connections.");
  result.earnedCrossConnectionIds = earned;
  return { ...result,status: "pass",detail: "Prepared grip withdrawal and continuous rotation/translation passed; actual terminal edges earn exactly the withheld cross connections. Returned build/state still withhold those joins; connected rest and free release remain mandatory." };
}
