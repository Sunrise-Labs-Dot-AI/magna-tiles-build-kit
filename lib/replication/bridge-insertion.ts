import { connectionId } from "@/lib/engine/build";
import { validateEngineInput } from "@/lib/engine/input";
import { add, distance } from "@/lib/engine/math";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { createEngineWorld, type EngineState } from "@/lib/engine/rapier-world";
import type { BuildGraph, MagneticConnection, TileInstance } from "@/lib/magnetic-tiles/types";
import { componentContacts } from "./components";
import { physicalConnectionId } from "./contact-arrival";
import { dockToSupports, type DockingPolicy, type DockingResult } from "./docking";
import { checkHandTransition, type HandContact, type HandTransition } from "./grip";
import { simulateHeldMotion, type HeldMotionTrial, type HeldWaypoint } from "./held-motion";
import type { InsertionPath } from "./insertion";
import { tileQuaternion } from "./rotation-clearance";
import { simulateSupport, type SupportTrial } from "./support";
import type { Check } from "./types";
import { checkPreparedContinuation } from "./workspace";

export interface BridgeEvidence extends Check {
  introducedTileId: string;
  requestedConnectionIds: string[];
  physicalConnectionIds: string[];
  activeJointIdsBeforeClosure: string[];
  earnedConnectionIds: string[];
  componentGroupsBefore: string[][];
  earnedComponentGroups: string[][];
  handTransition?: HandTransition;
  introduction?: Check & { bodyIdsBefore: string[]; bodyIdsAfter: string[]; activeJointIds: string[] };
}
export interface BridgeTrial extends BridgeEvidence {
  settled: BuildGraph;
  state: EngineState;
  handoff?: SupportTrial;
  carry?: HeldMotionTrial;
  connected?: SupportTrial;
  docking?: DockingResult;
  path?: InsertionPath;
}

/** This new-panel merge is deliberately separate from prepared transfer's
 * one-neighbor contract. It proposes membership, never earns physical contact. */
export function bridgeComponentGroups(actual: BuildGraph, groups: string[][], incoming: TileInstance,
  edges: MagneticConnection[]): Check & { groups: string[][] } {
  const fail=(detail:string)=>({status:"fail" as const,detail,groups:[]});
  const existing=componentContacts(actual,groups);
  if(existing.status!=="pass")return fail(existing.detail);
  if(actual.tiles.some(t=>t.id===incoming.id)||validateEngineInput({...actual,tiles:[...actual.tiles,incoming],connections:[...actual.connections,...edges]}).length)
    return fail("Bridge insertion needs exactly one new catalog panel and valid named edge endpoints.");
  const byTile=new Map(groups.flatMap((g,index)=>g.map(id=>[id,index] as const))),neighbors=new Set<number>(),endpoints=new Set<string>();
  if(!edges.length||new Set(edges.map(physicalConnectionId)).size!==edges.length)
    return fail("Bridge edges must have distinct physical pair identities.");
  for(const edge of edges){
    const from=edge.fromTileId===incoming.id,to=edge.toTileId===incoming.id;
    if(edge.kind!=="edge"||from===to)return fail("Every bridge edge must join the new panel to an existing component.");
    const neighbor=byTile.get(from?edge.toTileId:edge.fromTileId);
    if(neighbor===undefined)return fail("A bridge edge names a missing component.");
    neighbors.add(neighbor);
    for(const endpoint of [`${edge.fromTileId}:${edge.fromEdge}`,`${edge.toTileId}:${edge.toEdge}`]){
      if(endpoints.has(endpoint))return fail("Bridge connections cannot reuse a physical edge endpoint.");
      endpoints.add(endpoint);
    }
  }
  if(neighbors.size<2)return fail("A bridge panel must join at least two distinct existing components.");
  const first=Math.min(...neighbors),merged=[...groups.filter((_,i)=>neighbors.has(i)).flat(),incoming.id];
  return {status:"pass",detail:"Proposed bridge preserves unrelated components; all new joins remain unearned.",
    groups:groups.flatMap((g,i)=>i===first?[merged]:neighbors.has(i)?[]:[[...g]])};
}

/** Introduce only the named panel at its separated, checked pickup pose. No
 * physics step occurs here; the old state must survive construction exactly. */
async function introducePanel(actual: BuildGraph, state: EngineState, incoming: TileInstance, floorY: number): Promise<EngineState> {
  const expanded={...actual,tiles:[...actual.tiles,incoming]};
  const engine=await createEngineWorld(expanded,{drop:false,floorY,state});
  try {
    const restored=engine.snapshot();
    const beforeIds=state.bodies.map(b=>b.referenceTile.id).sort(),afterIds=restored.bodies.map(b=>b.referenceTile.id).sort();
    if(JSON.stringify(afterIds)!==JSON.stringify([...beforeIds,incoming.id].sort())||
      state.bodies.some(b=>JSON.stringify(b)!==JSON.stringify(restored.bodies.find(n=>n.referenceTile.id===b.referenceTile.id)))||
      JSON.stringify(restored.joints)!==JSON.stringify(state.joints)||JSON.stringify(restored.connections)!==JSON.stringify(state.connections)||
      JSON.stringify(restored.poppedJoints)!==JSON.stringify(state.poppedJoints)||JSON.stringify(restored.solidFailures)!==JSON.stringify(state.solidFailures)||
      restored.peakSolidOverlap!==state.peakSolidOverlap||JSON.stringify(restored.peakSolidPair)!==JSON.stringify(state.peakSolidPair))
      throw new Error("Bridge introduction changed an existing body, joint or physical history before motion.");
    // Only this new, gripped panel becomes kinematic. Existing body modes are retained.
    engine.bodies.get(incoming.id)!.body.setBodyType(RigidBodyType.KinematicPositionBased,true);
    return engine.snapshot();
  } finally {engine.dispose();}
}

/** Add one gripped panel to a released workspace, earn exact contact to at
 * least two components, and stabilize only the earned joints. Free release is
 * performed by the stage runner before any terminal evidence is published. */
export async function simulateBridgeInsertion(nominal: BuildGraph, actual: BuildGraph, state: EngineState, incomingId: string,
  edges: MagneticConnection[],previousHands: HandContact[],hands: HandContact[],floorY: number,seed: number,deadline: number,
  components: string[][],policy: DockingPolicy): Promise<BridgeTrial> {
  const expected=edges.map(connectionId).sort(),physical=edges.map(physicalConnectionId).sort();
  const result:BridgeTrial={status:"fail",detail:"",settled:actual,state,introducedTileId:incomingId,
    requestedConnectionIds:expected,physicalConnectionIds:physical,activeJointIdsBeforeClosure:state.joints.map(j=>j.model.id).sort(),
    earnedConnectionIds:[],componentGroupsBefore:structuredClone(components),earnedComponentGroups:[]};
  const fail=(detail:string)=>({...result,detail});
  const continuity=checkPreparedContinuation(actual,state,floorY);
  if(continuity.status!=="pass")return fail(continuity.detail);
  const incoming=nominal.tiles.find(t=>t.id===incomingId),oldIds=actual.tiles.map(t=>t.id).sort();
  if(!incoming||validateEngineInput(nominal).length||JSON.stringify(nominal.tiles.map(t=>t.id).sort())!==JSON.stringify([...oldIds,incomingId].sort())||
    actual.tiles.some(t=>t.shape!==nominal.tiles.find(n=>n.id===t.id)?.shape))
    return fail("Bridge target must contain exactly the existing panels and its one named new panel.");
  const partition=bridgeComponentGroups(actual,components,incoming,edges);
  if(partition.status!=="pass")return fail(partition.detail);
  if(previousHands.length||state.bodies.some(b=>b.bodyType!==RigidBodyType.Dynamic)||hands.length<1||hands.length>2||
    new Set(hands.map(h=>h.tileId)).size!==hands.length||hands.filter(h=>h.tileId===incomingId).length!==1||
    hands.some(h=>h.tileId!==incomingId&&!oldIds.includes(h.tileId)))
    return fail("Bridge insertion starts released with one incoming-panel grip and at most one existing support grip.");
  const supportHands=hands.filter(h=>h.tileId!==incomingId);
  result.handTransition=checkHandTransition(actual,previousHands,supportHands,floorY,deadline);
  if(result.handTransition.status!=="pass")return fail(result.handTransition.detail);
  if(supportHands.length){
    result.handoff=await simulateSupport(actual,supportHands.map(h=>h.tileId),floorY,seed,deadline,state,supportHands,components);
    result.settled=result.handoff.settled;result.state=result.handoff.state;
    if(result.handoff.status!=="pass")return fail(result.handoff.detail);
  }
  const beforeIntroduction=checkPreparedContinuation(result.settled,result.state,floorY);
  if(beforeIntroduction.status!=="pass")return fail(beforeIntroduction.detail);
  const start=result.settled,target={...nominal,connections:[...start.connections,...edges]};
  const proposal={...start,tiles:[...start.tiles,incoming],connections:target.connections};
  const docking=dockToSupports(target,proposal,[incomingId],oldIds,hands,floorY,policy,deadline,partition.groups);
  result.docking=docking;result.path=docking.path;
  if(docking.status!=="pass"||!docking.path)return fail(docking.detail);
  const tile=docking.build.tiles.find(t=>t.id===incomingId)!,path=docking.path;
  const pickup={...tile,position:add(tile.position,path.offsets[0])};
  const airborne={...start,tiles:[...start.tiles,pickup]},beforeGroups=[...components,[incomingId]];
  const separate=componentContacts(airborne,beforeGroups);
  if(separate.status!=="pass")return fail(separate.detail);
  try{result.state=await introducePanel(start,result.state,pickup,floorY);}
  catch(error){return fail(error instanceof Error?error.message:String(error));}
  result.introduction={status:"pass",detail:"Exactly one held incoming body was added; every old body and joint was restored unchanged before motion.",
    bodyIdsBefore:oldIds,bodyIdsAfter:result.state.bodies.map(b=>b.referenceTile.id).sort(),activeJointIds:result.state.joints.map(j=>j.model.id).sort()};
  const introduced=checkPreparedContinuation(airborne,result.state,floorY);
  if(introduced.status!=="pass")return fail(introduced.detail);
  const q=tileQuaternion(pickup),waypoints:HeldWaypoint[]=[{seconds:0,position:pickup.position,rotation:q},{seconds:.1,position:pickup.position,rotation:q}];
  for(const offset of path.offsets.slice(1)){
    const previous=waypoints.at(-1)!,position=add(tile.position,offset);
    waypoints.push({seconds:previous.seconds+Math.max(.1,distance(previous.position,position)/1.5),position,rotation:q});
  }
  result.carry=await simulateHeldMotion(airborne,result.state,[incomingId],hands,waypoints,floorY,seed,deadline,beforeGroups,{connections:edges,separationWaypoint:0});
  result.settled=result.carry.settled;result.state=result.carry.state??result.state;
  result.activeJointIdsBeforeClosure=result.state.joints.map(j=>j.model.id).sort();
  if(result.carry.status!=="pass"||result.carry.completion!=="contact-arrival")return fail(result.carry.detail);
  if(JSON.stringify(result.carry.arrivalContacts?.sourceConnectionIds)!==JSON.stringify(expected)||
    JSON.stringify(result.carry.arrivalContacts?.physicalConnectionIds)!==JSON.stringify(physical))return fail("Actual bridge contact differs from its named edge set.");
  const arrived=checkPreparedContinuation(result.settled,result.state,floorY);
  if(arrived.status!=="pass")return fail(arrived.detail);
  if(JSON.stringify(result.activeJointIdsBeforeClosure)!==JSON.stringify(state.joints.map(j=>j.model.id).sort()))return fail("A bridge joint appeared or an old joint disappeared before contact closure.");
  const joined={...result.settled,connections:[...result.settled.connections,...edges]};
  const closure=componentContacts(joined,partition.groups);
  if(closure.status!=="pass")return fail(closure.detail);
  result.connected=await simulateSupport(joined,hands.map(h=>h.tileId),floorY,seed,deadline,result.state,hands,partition.groups);
  result.settled=result.connected.settled;result.state=result.connected.state;
  if(result.connected.status!=="pass")return fail(result.connected.detail);
  const afterClosure=checkPreparedContinuation(result.settled,result.state,floorY);
  if(afterClosure.status!=="pass")return fail(afterClosure.detail);
  const allExpected=[...result.activeJointIdsBeforeClosure,...expected].sort();
  if(JSON.stringify(result.state.joints.map(j=>j.model.id).sort())!==JSON.stringify(allExpected))return fail("Connected bridge stabilization changed more than its exact earned joint set.");
  result.earnedConnectionIds=expected;result.earnedComponentGroups=partition.groups;
  return {...result,status:"pass",detail:"One new gripped panel reached exactly the named contacts and stabilized the earned joins between existing components. All other bodies and joints remain present; checked withdrawal and free release remain mandatory."};
}
