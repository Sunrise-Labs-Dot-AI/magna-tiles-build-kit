import { connectionId, validateMagneticBuild } from "@/lib/engine/build";
import { add, distance, inverseQuaternion, magnitude, multiplyQuaternions, quaternionAngle, quaternionToBasis, scale, subtract, transformLocal } from "@/lib/engine/math";
import type { EngineState } from "@/lib/engine/rapier-world";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import { dockToSupports, type DockingPolicy, type DockingResult } from "./docking";
import { checkHandAccess, checkHandTransition, sameHandContact, type HandContact, type HandTransition } from "./grip";
import { simulateHeldMotion, type HeldMotionTrial, type HeldWaypoint } from "./held-motion";
import { validateInsertionPath, type InsertionPath } from "./insertion";
import { tileQuaternion } from "./rotation-clearance";
import { simulateSupport, type SupportTrial } from "./support";
import type { Check } from "./types";
import { componentContacts, joinComponentGroups } from "./components";
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
  acquiredHands: HandContact[];
  handTransition?: HandTransition;
  componentGroupsBefore: string[][];
  earnedComponentGroups: string[][];
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
    withheldCrossConnectionIds: expected,physicalCrossConnectionIds:cross.map(physicalConnectionId).sort(),activeJointIdsBeforeClosure: state.joints.map(j => j.model.id),earnedCrossConnectionIds: [],
    previousHands: structuredClone(previousHands),retainedHands: hands.filter(h => previousHands.some(old => sameHandContact(old,h))),
    acquiredHands: hands.filter(h => !previousHands.some(old => sameHandContact(old,h))),componentGroupsBefore: structuredClone(components),earnedComponentGroups: [] };
  const fail = (detail: string) => ({ ...result,detail });
  const movingHands = hands.filter(h => moving.has(h.tileId)), movingHand = movingHands[0];
  const retained = movingHand && previousHands.some(h => sameHandContact(h,movingHand));
  if (hands.length < 1 || hands.length > 2 || movingHands.length !== 1 || new Set(hands.map(h => h.tileId)).size !== hands.length || (previousHands.length > 0 && !retained) ||
      previousHands.length > 2 || previousHands.some(h => !moving.has(h.tileId)) || new Set(previousHands.map(h => h.tileId)).size !== previousHands.length)
    return fail("Transfer needs exactly one acquired or unchanged retained moving-panel grip, optionally one receiving-panel grip, with at most two prior module hands.");
  const partition = joinComponentGroups(actual,components,movingIds,cross);
  if (partition.status !== "pass") return fail(partition.detail);
  const receivingIds = partition.groups.find(group => group.includes(movingHand.tileId))!.filter(id => !moving.has(id));
  if (hands.some(h => !moving.has(h.tileId) && !receivingIds.includes(h.tileId)))
    return fail("The optional support hand must grip the receiving component named by the declared cross connections.");
  if (!expected.length || new Set(expected).size !== expected.length || actual.connections.some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId)) ||
      state.connections.some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId)) || state.poppedJoints.length ||
      state.joints.some(j => moving.has(j.model.fromTileId) !== moving.has(j.model.toTileId)))
    return fail("Prepared transfer has missing, duplicated, broken or pre-attached cross connections.");
  // Stationary grip access remains required even for an unchanged retained hand.
  const accessFor = (build: BuildGraph, contacts: HandContact[]) => checkHandAccess(build,{ id: "prepared-handoff",movingTileIds: [movingHand.tileId],
    fixedTileIds: build.tiles.filter(t => t.id !== movingHand.tileId).map(t => t.id),offsets: [{ x: 0,y: 0,z: 0 },{ x: 0,y: 0,z: 0 }] },contacts,floorY,deadline);
  result.handTransition = checkHandTransition(actual,previousHands,hands,floorY,deadline);
  if (result.handTransition.status !== "pass") return fail(result.handTransition.detail);
  const acquisition = accessFor(actual,hands);
  if (acquisition.status !== "pass") return fail(acquisition.detail);
  result.handoff = await simulateSupport(actual,hands.map(h => h.tileId),floorY,seed,deadline,state,hands,components);
  result.settled = result.handoff.settled; result.state = result.handoff.state;
  if (result.handoff.status !== "pass") return fail(result.handoff.detail);
  const withdrawal = accessFor(result.settled,hands);
  if (withdrawal.status !== "pass") return fail(withdrawal.detail);
  const start = result.settled;
  const target = {...nominal,connections: [...start.connections,...cross]};
  const proposal = transferTarget(target,start,movingIds,movingHand.tileId);
  const docking = dockToSupports(target,proposal,movingIds,fixed,hands,floorY,policy,deadline,partition.groups);
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
    if (separated && validateInsertionPath(docking.build,candidate,deadline,floorY).status === "pass" && checkHandAccess(docking.build,candidate,hands,floorY,deadline).status === "pass") {
      path = candidate; break;
    }
  }
  result.path = path;
  let waypoints: HeldWaypoint[];
  try { waypoints = transferWaypoints(start,docking.build,movingHand.tileId,path,floorY,transitHeight); }
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
  const closure = componentContacts(joined,partition.groups);
  if (closure.status !== "pass") return fail(closure.detail);
  const earned = validateMagneticBuild(joined).validConnections.filter(c => moving.has(c.fromTile.id) !== moving.has(c.toTile.id)).map(c => c.id).sort();
  if (JSON.stringify(earned) !== JSON.stringify(expected)) return fail("Actual terminal contacts do not earn the exact required cross connections.");
  result.earnedCrossConnectionIds = earned;
  result.earnedComponentGroups = partition.groups;
  return { ...result,status: "pass",detail: "Checked pickup support and continuous rotation/translation passed; actual terminal edges earn exactly the withheld cross connections while untouched components remain independent. Returned build/state still withhold those joins; connected rest and free release remain mandatory." };
}
