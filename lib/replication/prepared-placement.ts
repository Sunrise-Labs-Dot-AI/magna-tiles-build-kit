import { buildBounds } from "@/lib/engine/build";
import { validateEngineInput } from "@/lib/engine/input";
import { add, distance, quaternionAngle } from "@/lib/engine/math";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import type { EngineState } from "@/lib/engine/rapier-world";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { componentContacts, movingComponent } from "./components";
import { checkHandAccess, checkHandTransition, type HandContact, type HandTransition } from "./grip";
import { simulateHeldMotion, type HeldMotionTrial, type HeldWaypoint } from "./held-motion";
import { transferTarget } from "./prepared-transfer";
import { tileQuaternion } from "./rotation-clearance";
import { simulatePreparedTableRelease, type SeatingTrial } from "./seating";
import { simulateSupport, type SupportTrial } from "./support";
import type { Check } from "./types";
import { checkPreparedContinuation } from "./workspace";

export interface TablePlacementEvidence extends Check {
  componentGroups: string[][];
  activeJointIds: string[];
  horizontalDisplacement: number;
  acquisition?: HandTransition;
  withdrawal?: HandTransition;
}
export interface PreparedTablePlacementTrial extends TablePlacementEvidence {
  settled: BuildGraph;
  state: EngineState;
  handoff?: SupportTrial;
  carry?: HeldMotionTrial;
  seating?: SeatingTrial;
}

const centroid = (build: BuildGraph, moving: Set<string>): Vec3 => {
  const tiles = build.tiles.filter(t => moving.has(t.id));
  return tiles.reduce((sum,t) => add(sum,{x:t.position.x/tiles.length,y:t.position.y/tiles.length,z:t.position.z/tiles.length}),{x:0,y:0,z:0});
};

/** A prepared table placement preserves the component partition and earns no
 * magnetic joins. Every physical phase continues the complete existing world. */
export async function simulatePreparedTablePlacement(nominal: BuildGraph, actual: BuildGraph, state: EngineState, movingIds: string[],
  previousHands: HandContact[], hands: HandContact[], transitHeight: number, releaseHeight: number,
  floorY: number, seed: number, deadline: number, components: string[][]): Promise<PreparedTablePlacementTrial> {
  const moving = new Set(movingIds), jointIds = state.joints.map(j => j.model.id).sort();
  const result: PreparedTablePlacementTrial = { status: "fail",detail: "",settled: actual,state,
    componentGroups: structuredClone(components),activeJointIds: jointIds,horizontalDisplacement: 0 };
  const fail = (detail: string) => ({...result,detail});
  const continuity = checkPreparedContinuation(actual,state,floorY);
  if (continuity.status !== "pass") return fail(continuity.detail);
  if (validateEngineInput(nominal).length || JSON.stringify(nominal.tiles.map(t=>t.id).sort()) !== JSON.stringify(actual.tiles.map(t=>t.id).sort()) ||
      nominal.tiles.some(t => t.shape !== actual.tiles.find(a=>a.id===t.id)?.shape))
    return fail("Prepared placement target must contain exactly the existing tile identities and shapes.");
  if (previousHands.length || hands.length !== 1 || !moving.has(hands[0].tileId) || state.bodies.some(b=>b.bodyType!==RigidBodyType.Dynamic))
    return fail("Table relocation starts with a released workspace and acquires exactly one moving-panel grip.");
  const component = movingComponent(actual,hands[0].tileId,components);
  if (component.status !== "pass") return fail(component.detail);
  if (!moving.size || moving.size !== movingIds.length || component.tileIds.length !== moving.size || component.tileIds.some(id=>!moving.has(id)))
    return fail("Table relocation must move exactly one complete declared component.");
  if ([...actual.connections,...nominal.connections].some(c => moving.has(c.fromTileId) !== moving.has(c.toTileId)))
    return fail("Table relocation cannot detach a joined component or earn a new cross connection.");
  if (!Number.isFinite(releaseHeight) || releaseHeight < .05 || releaseHeight > .75 ||
      !Number.isFinite(transitHeight) || transitHeight < 3 || transitHeight > 12)
    return fail("Table relocation needs a bounded transit height and 0.05–0.75 in release clearance.");
  if (Math.abs(buildBounds(nominal.tiles.filter(t=>moving.has(t.id))).min.y-floorY) > RAW_OVERLAP_TOLERANCE)
    return fail("The intended table destination is underground or lacks table bearing geometry.");
  result.acquisition = checkHandTransition(actual,previousHands,hands,floorY,deadline);
  if (result.acquisition.status !== "pass") return fail(result.acquisition.detail);
  const grip = checkHandAccess(actual,{id:"table-pickup",movingTileIds:movingIds,
    fixedTileIds:actual.tiles.filter(t=>!moving.has(t.id)).map(t=>t.id),offsets:[{x:0,y:0,z:0},{x:0,y:0,z:0}]},hands,floorY,deadline);
  if (grip.status !== "pass") return fail(grip.detail);
  result.handoff = await simulateSupport(actual,[hands[0].tileId],floorY,seed,deadline,state,hands,components);
  result.settled=result.handoff.settled; result.state=result.handoff.state;
  if (result.handoff.status !== "pass") return fail(result.handoff.detail);
  const afterPickup = checkPreparedContinuation(result.settled,result.state,floorY);
  if (afterPickup.status !== "pass") return fail(afterPickup.detail);
  const start=result.settled, proposal=transferTarget({...nominal,connections:start.connections},start,movingIds,hands[0].tileId);
  const lift=floorY+releaseHeight-buildBounds(proposal.tiles.filter(t=>moving.has(t.id))).min.y;
  const target={...proposal,tiles:proposal.tiles.map(t=>moving.has(t.id)?{...t,position:add(t.position,{x:0,y:lift,z:0})}:t)};
  const held=start.tiles.find(t=>t.id===hands[0].tileId)!, end=target.tiles.find(t=>t.id===hands[0].tileId)!;
  const startQ=tileQuaternion(held),endQ=tileQuaternion(end),highY=floorY+transitHeight;
  if (highY < Math.max(held.position.y,end.position.y)) return fail("Transit height is below the pickup or release pose.");
  const waypoints:HeldWaypoint[]=[{seconds:0,position:held.position,rotation:startQ}];
  const push=(position:Vec3,rotation=endQ)=>{
    const previous=waypoints.at(-1)!;
    waypoints.push({position,rotation,seconds:previous.seconds+Math.max(.1,distance(previous.position,position)/1.5,quaternionAngle(previous.rotation,rotation)/.75)});
  };
  push({...held.position,y:highY},startQ);push({...held.position,y:highY});
  push({...end.position,y:highY});push(end.position);
  result.carry=await simulateHeldMotion(start,result.state,movingIds,hands,waypoints,floorY,seed,deadline,components);
  result.settled=result.carry.settled; result.state=result.carry.state ?? result.state;
  if (result.carry.status !== "pass" || result.carry.completion !== "rested") return fail(result.carry.detail);
  const afterCarry=checkPreparedContinuation(result.settled,result.state,floorY);
  if (afterCarry.status !== "pass") return fail(afterCarry.detail);
  const separate=componentContacts(result.settled,components);
  if (separate.status !== "pass") return fail(separate.detail);
  result.withdrawal=checkHandTransition(result.settled,hands,[],floorY,deadline);
  if (result.withdrawal.status !== "pass") return fail(result.withdrawal.detail);
  result.seating=await simulatePreparedTableRelease(result.settled,movingIds,hands,releaseHeight,floorY,seed,deadline,result.state,components);
  result.settled=result.seating.settled; result.state=result.seating.state ?? result.state;
  if (result.seating.status !== "pass") return fail(result.seating.detail);
  const afterSeat=checkPreparedContinuation(result.settled,result.state,floorY);
  if (afterSeat.status !== "pass") return fail(afterSeat.detail);
  if (result.seating.earnedJointIds.length || JSON.stringify(result.state.joints.map(j=>j.model.id).sort()) !== JSON.stringify(jointIds))
    return fail("Table relocation changed the existing magnetic joint set.");
  const before=centroid(actual,moving),after=centroid(result.settled,moving);
  result.horizontalDisplacement=Math.hypot(after.x-before.x,after.z-before.z);
  return {...result,status:"pass",detail:"One complete component was acquired, carried and gravity-seated on the fixed table. All bodies and existing joints remain present; no component merge or new magnetic join is claimed. Final free checkpoint remains mandatory."};
}
