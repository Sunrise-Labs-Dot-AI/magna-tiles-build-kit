import { buildBounds, connectionId, validateMagneticBuild } from "@/lib/engine/build";
import { add, magnitude, scale } from "@/lib/engine/math";
import type { EngineState } from "@/lib/engine/rapier-world";
import { findMagneticEdgeMatch } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildGraph, TileInstance } from "@/lib/magnetic-tiles/types";
import { stageBuild } from "./geometry";
import { planConstructionPaths } from "./construction";
import type { InsertionPath } from "./insertion";
import { checkHandAccess, checkHandTransition, findHandInsertionPath, sameHandContact, type HandContact, type HandTransition } from "./grip";
import { simulateSupport, type SupportTrial } from "./support";
import { simulateGravitySeat, type SeatingTrial } from "./seating";
import { simulateHeldMotion, type HeldMotionTrial } from "./held-motion";
import { tileQuaternion } from "./rotation-clearance";
import { dockToSupports, type DockingPolicy } from "./docking";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { selectWorkspace, workspaceBuild, type PreparedWorkspace } from "./workspace";
import { simulatePreparedTransfer, type TransferEvidence } from "./prepared-transfer";
import { componentContacts, movingComponent } from "./components";
import { closedMagneticConnection } from "./contacts";
import type { Check, Replica, StagePose } from "./types";

export interface AssemblyOperationResult extends Check {
  index: number;
  seed: number;
  tileIds: string[];
  path?: InsertionPath;
  approachTiles?: TileInstance[];
  grip?: Check;
  closure?: Check;
  seating?: Omit<SeatingTrial, "settled" | "state">;
  carry?: Omit<HeldMotionTrial, "settled" | "state">;
  pickup?: Omit<HeldMotionTrial, "settled" | "state">;
  pickupHandoff?: Check & { previousHands: HandContact[]; retainedHands: HandContact[] };
  handTransitions?: (HandTransition & { beforeTrial: number })[];
  lowering?: Omit<HeldMotionTrial, "settled" | "state">;
  docking?: Check & { offset: { x: number; y: number; z: number }; targetPenetration: number | null };
  transfer?: TransferEvidence;
  timeline?: (({ phase: "pickup" | "carry" | "seating" | "lowering" } | { phase: "support"; index: number }) & { activeConnectionIds?: string[] })[];
  trials: Omit<SupportTrial, "settled" | "state">[];
}
export interface AssemblyAttempt extends Check {
  policy: DockingPolicy;
  operations: AssemblyOperationResult[];
  checkpoints: Omit<SupportTrial,"settled"|"state">[];
  checkpointHandTransitions?: (HandTransition & { seed: number })[];
}
export interface AssemblyResult extends Check {
  stageId: string;
  dockingPolicy: DockingPolicy | null;
  attemptedPolicies: DockingPolicy[];
  rejectedAttempts: AssemblyAttempt[];
  operations: AssemblyOperationResult[];
  checkpoints: Omit<SupportTrial, "settled" | "state">[];
  checkpointHandTransitions?: (HandTransition & { seed: number })[];
}
const subset = (build: BuildGraph, ids: Set<string>): BuildGraph => ({ ...build,
  tiles: build.tiles.filter(t => ids.has(t.id)),
  connections: build.connections.filter(c => ids.has(c.fromTileId) && ids.has(c.toTileId)) });
const mergePoses = (build: BuildGraph, state: BuildGraph): BuildGraph => ({ ...build,
  tiles: build.tiles.map(t => state.tiles.find(actual => actual.id === t.id) ?? t) });
const supportSummary = (trial: SupportTrial): Omit<SupportTrial,"settled"|"state"> => {
  const result: Partial<SupportTrial> = { ...trial }; delete result.settled; delete result.state;
  return result as Omit<SupportTrial,"settled"|"state">;
};
const motionSummary = (trial: HeldMotionTrial): Omit<HeldMotionTrial,"settled"|"state"> => {
  const result: Partial<HeldMotionTrial> = { ...trial }; delete result.settled; delete result.state;
  return result as Omit<HeldMotionTrial,"settled"|"state">;
};

/** A path with empty air at both ends is not a magnetic assembly operation. */
export function checkClosure(build: BuildGraph, path: InsertionPath, components?: string[][]): Check {
  const present = subset(build, new Set([...path.movingTileIds, ...path.fixedTileIds]));
  const closure = componentContacts(present,components);
  if (closure.status !== "pass") return closure;
  const component = components?.find(group => path.movingTileIds.every(id => group.includes(id)));
  if (components && (!path.movingTileIds.length || !component))
    return { status: "fail",detail: "An insertion must belong to one declared workspace component." };
  // Independent groups must also be magnetically separate, even when the graph
  // omits a cross-group edge. Neither endpoint may start or finish snapped to an obstacle.
  if (component) for (const a of present.tiles.filter(t => path.movingTileIds.includes(t.id)))
    for (const b of present.tiles.filter(t => !component.includes(t.id)))
      if (closedMagneticConnection(present,a,b) || closedMagneticConnection(present,{ ...a,position: add(a.position,path.offsets[0]) },b))
        return { status: "fail",detail: "Independent insertion touches a magnetic edge of another workspace component." };
  const fixed = path.fixedTileIds.filter(id => !component || component.includes(id));
  const validation = validateMagneticBuild(present);
  if (!fixed.length) return { status: "pass", detail: "First part/module placed in its component; no pre-existing join required." };
  const cross = validation.validConnections.filter(c => path.movingTileIds.includes(c.fromTile.id) !== path.movingTileIds.includes(c.toTile.id));
  if (!cross.length) return { status: "fail", detail: "Inserted module has no validated magnetic edge contact to installed parts." };
  for (const c of cross) {
    const a = path.movingTileIds.includes(c.fromTile.id) ? c.fromTile : c.toTile;
    const b = a === c.fromTile ? c.toTile : c.fromTile;
    if (findMagneticEdgeMatch({ ...a, position: add(a.position, path.offsets[0]) }, b))
      return { status: "fail", detail: "Insertion begins already attached; a separated pre-snap pose is required." };
  }
  return { status: "pass", detail: `${cross.length} new edge contacts close after a separated, clear approach. Gap ≤ thickness + 0.03 in, alignment within 5 degrees and overlap within 0.21 in of the shorter edge. Magnetic force remains a model assumption.` };
}

/** Bounded assembly: retain actual poses, velocities, local hinge frames and
 * break history across support, insertion, seating and release. */
export async function evaluateAssembly(replica: Replica, deadline = Infinity): Promise<AssemblyResult[]> {
  const coverage = planConstructionPaths(replica, deadline), results: AssemblyResult[] = [];
  const prepared: PreparedWorkspace[] = [];
  for (const stage of replica.stages) {
    const result: AssemblyResult = { stageId: stage.id, status: "unverified", detail: "No complete supported construction contract.", dockingPolicy: null, attemptedPolicies: [], rejectedAttempts: [], operations: [], checkpoints: [] };
    results.push(result);
    const paths = coverage.find(p => p.stageId === stage.id)!;
    if (paths.status !== "pass") { result.status = paths.status; result.detail = paths.detail; continue; }
    const plan = replica.construction!.find(p => p.stageId === stage.id)!;
    if (plan.operations.some(op => !op.hands?.length)) continue;
    const transfers = plan.operations.filter(op => op.preparedStageId);
    const dependency = transfers[0]?.transfer?.afterStageId ?? transfers[0]?.preparedStageId ?? plan.workspace?.afterStageId ?? stage.installedStageIds?.[0];
    if (dependency && !prepared.some(w => w.stageId === dependency)) { result.detail = "An earlier module has not passed its complete supported assembly."; continue; }
    if (!plan.workspace && !transfers.length && dependency && (stage.transform || replica.stages.find(s => s.id === dependency)?.transform)) {
      result.detail = "A stage rotation/transfer needs a continuous validated orientation trajectory."; continue;
    }
    if (((stage.installedStageIds?.length ?? 0) > 1 && !transfers.length) || plan.operations.some(op => op.transfer && !op.preparedStageId) ||
        plan.operations.some(op => op.transfer?.afterStageId !== undefined && (typeof op.transfer.afterStageId !== "string" || !op.transfer.afterStageId.trim())) ||
        transfers.length && (transfers.length !== 1 || plan.operations.length !== 1 || !transfers[0].transfer || !transfers[0].releaseAfter || plan.workspace || stage.transform || transfers[0].gravitySeat || transfers[0].pickup || transfers[0].lowerBeforeRelease !== undefined) ||
        plan.workspace && (stage.installedStageIds?.length || !Object.values(plan.workspace.offset).every(n => Number.isFinite(n) && Math.abs(n) <= 12) || plan.workspace.offset.y !== 0)) {
      result.detail = "Prepared worlds need one explicit predecessor, workspace placement and continuous transfer contract."; continue;
    }
    for (const policy of ["clear-first","support-aligned"] as const) {
      if (Date.now() > deadline) throw new SimulationBudgetExceeded();
      result.attemptedPolicies.push(policy);
      const { states,...attempt } = await runAssemblyStage(replica,stage,prepared,policy,deadline);
      if (attempt.status === "pass") {
        result.status = "pass"; result.detail = attempt.detail;
        result.dockingPolicy = policy;
        result.operations = attempt.operations; result.checkpoints = attempt.checkpoints;
        result.checkpointHandTransitions = attempt.checkpointHandTransitions;
        prepared.push(...states);
        break;
      }
      result.rejectedAttempts.push(attempt);
      result.status = "fail";
      result.detail = result.rejectedAttempts.map(a => `${a.policy}: ${a.detail}`).join(" ");
    }
  }
  return results;
}

/** Each attempt owns its rows and terminal workspaces. A failed attempt cannot
 * contribute even successful seeds to a later stage. */
async function runAssemblyStage(replica: Replica, stage: StagePose, prepared: PreparedWorkspace[],
  policy: DockingPolicy, deadline: number): Promise<AssemblyAttempt & { states: PreparedWorkspace[] }> {
  const plan = replica.construction!.find(p => p.stageId === stage.id)!;
  const transfers = plan.operations.filter(op => op.preparedStageId);
  const dependency = transfers[0]?.transfer?.afterStageId ?? transfers[0]?.preparedStageId ?? plan.workspace?.afterStageId ?? stage.installedStageIds?.[0];
  const installedIds = (stage.installedStageIds ?? []).flatMap(id => replica.stages.find(s => s.id === id)?.tileIds ?? []);
  const offset = plan.workspace?.offset ?? { x: 0,y: 0,z: 0 };
  const nominal = stageBuild(replica, stage);
  nominal.tiles = nominal.tiles.map(t => ({ ...t,position: add(t.position,offset) }));
  const floorY = buildBounds(nominal.tiles).min.y;
  const result: AssemblyAttempt = { policy,status: "fail",detail: "",operations: [],checkpoints: [] };
  const states: PreparedWorkspace[] = [];
  const failures: string[] = [];
  for (const seed of [0, 17, 53]) {
    let failure = "";
    let current = structuredClone(nominal);
    let physicalState: EngineState | undefined;
    let heldHands: HandContact[] = [];
    let predecessor: PreparedWorkspace | undefined;
    let inheritedComponents: string[][] | undefined;
    const placed = new Set<string>();
    if (dependency) {
      try {
        predecessor = structuredClone(selectWorkspace(prepared,dependency,seed,[...(stage.installedStageIds ?? []),...transfers.map(op => op.preparedStageId!)]));
      } catch (error) { failures.push(`Seed ${seed}: ${error instanceof Error ? error.message : String(error)}`); continue; }
      const aligned = workspaceBuild(predecessor,floorY), previousIds = aligned.tiles.map(t => t.id);
      if (plan.workspace && predecessor.hands.length) { failures.push(`Seed ${seed}: New workspace construction requires an already released obstacle module.`); continue; }
      const expected = transfers.length ? stage.tileIds : plan.workspace ? previousIds : installedIds;
      if (previousIds.length !== expected.length || previousIds.some(id => !expected.includes(id)) || new Set(installedIds).size !== installedIds.length ||
          plan.workspace && previousIds.some(id => stage.tileIds.includes(id)) ||
          transfers.length && (transfers[0].tileIds.some(id => installedIds.includes(id)) || stage.tileIds.some(id => ![...installedIds,...transfers[0].tileIds].includes(id)))) {
        failures.push(`Seed ${seed}: Prepared workspace has missing, extra or duplicated stage parts.`); continue;
      }
      const inherited = aligned.tiles.filter(t => !current.tiles.some(n => n.id === t.id));
      current.tiles.push(...inherited);
      for (const c of aligned.connections) if (!current.connections.some(n => connectionId(n) === connectionId(c))) current.connections.push(c);
      current = mergePoses(current, aligned);
      if (transfers.length || (!plan.workspace && predecessor.components.length > 1)) {
        if (!transfers.length && plan.operations.length) {
          failures.push(`Seed ${seed}: Joining independent predecessor components needs an explicit transfer contract.`); continue;
        }
        // Existing physical connections own the world. A nominal target must
        // never inject a future fixed-to-fixed join before its actual arrival.
        current.connections = structuredClone(aligned.connections);
        inheritedComponents = structuredClone(predecessor.components);
      }
      physicalState = predecessor.state;
      heldHands = predecessor.hands;
      aligned.tiles.filter(t => !transfers.length || installedIds.includes(t.id)).forEach(t => placed.add(t.id));
    }
    const components = (build: BuildGraph) => plan.workspace ? [
      ...(predecessor?.components ?? []),build.tiles.filter(t => stage.tileIds.includes(t.id)).map(t => t.id),
    ].filter(g => g.length) : inheritedComponents;
    for (const [index, operation] of plan.operations.entries()) {
      const row: AssemblyOperationResult = { index, seed, tileIds: operation.tileIds, status: "fail", detail: "", trials: [], timeline: [] };
      result.operations.push(row);
      const record = async (build: BuildGraph, holds: string[]) => {
        const gripDefinitions = [...(operation.hands ?? []), ...(operation.pickup ? [operation.pickup.hand] : [])];
        const supportHands = holds.map(id => gripDefinitions.find(h => h.tileId === id)!);
        const transition = checkHandTransition(build,heldHands,supportHands,floorY,deadline);
        if (transition.changed) (row.handTransitions ??= []).push({ ...transition,beforeTrial:row.trials.length });
        if (transition.status !== "pass") { failure = transition.detail; return build; }
        const trial = await simulateSupport(build, holds, floorY, seed, deadline, physicalState, supportHands,components(build));
        const { settled, state, ...summary } = trial;
        physicalState = state;
        heldHands = supportHands;
        row.trials.push(summary);
        row.timeline!.push({ phase: "support",index: row.trials.length-1,activeConnectionIds: state.joints.map(j=>j.model.id) });
        if (trial.status !== "pass") failure = trial.detail;
        if (!failure) {
          const closure = componentContacts(settled,components(settled));
          if (closure.status !== "pass") failure = closure.detail;
        }
        return settled;
      };
      const hands = operation.hands!, moving = new Set(operation.tileIds);
      if (hands.length > 2 || new Set(hands.map(h => h.tileId)).size !== hands.length ||
          hands.some(h => !moving.has(h.tileId) && !placed.has(h.tileId)) || hands.filter(h => moving.has(h.tileId)).length !== 1) {
        failure = row.detail = "Need one insertion hand and at most one distinct installed-panel support hand."; break;
      }
      const support = hands.filter(h => placed.has(h.tileId)).map(h => h.tileId);
      if (operation.preparedStageId) {
        if (!physicalState || !operation.transfer) { failure = row.detail = "Missing actual prepared transfer state."; break; }
        const transfer = await simulatePreparedTransfer(nominal,current,physicalState,operation.tileIds,heldHands,hands,operation.transfer.transitHeight,floorY,seed,deadline,predecessor!.components,policy);
        const { settled,state,handoff,carry,docking,path,...evidence } = transfer;
        row.transfer = evidence;
        if (handoff) {
          const summary = supportSummary(handoff);
          row.trials.push(summary); row.timeline!.push({ phase: "support",index: row.trials.length-1,activeConnectionIds: handoff.state.joints.map(j=>j.model.id) });
        }
        if (carry) { row.carry = motionSummary(carry); row.timeline!.push({ phase: "carry",activeConnectionIds: carry.state?.joints.map(j=>j.model.id) }); }
        if (docking) row.docking = { status: docking.status,detail: docking.detail,offset: docking.offset,targetPenetration: docking.targetPenetration };
        row.path = path;
        row.approachTiles = handoff?.motion[0]?.tiles ?? carry?.motion[0]?.tiles;
        row.closure = { status: transfer.status,detail: transfer.detail };
        if (transfer.status !== "pass") { failure = row.detail = transfer.detail; break; }
        // The arrival result is internally consistent and still unjoined.
        // Only the validated authored definitions enter the next live world.
        current = {...settled,connections:[...settled.connections,...nominal.connections.filter(c=>transfer.earnedCrossConnectionIds.includes(connectionId(c)))]};
        inheritedComponents = structuredClone(transfer.earnedComponentGroups);
        physicalState = state; heldHands = hands;
        moving.forEach(id => placed.add(id));
        current = mergePoses(current,await record(current,hands.map(h => h.tileId)));
        const attached = physicalState.joints.filter(j => moving.has(j.model.fromTileId) !== moving.has(j.model.toTileId)).map(j => j.model.id).sort();
        if (JSON.stringify(attached) !== JSON.stringify(transfer.earnedCrossConnectionIds)) failure ||= "Connected stabilization did not retain exactly the earned cross connections.";
        if (!failure) current = mergePoses(current,await record(current,[]));
        if (failure) { row.detail = failure; break; }
        row.status = "pass"; row.detail = transfer.detail;
        continue;
      }
      if (operation.pickup) {
        const { height, hand } = operation.pickup;
        const retained = support[0] === hand.tileId;
        if (!Number.isFinite(height) || height <= 0 || height > .9 || !placed.has(hand.tileId) || support.length !== 1) {
          failure = row.detail = "Pickup needs a bounded lift and one installed-panel support hand."; break;
        }
        if (retained && !sameHandContact(hand,hands.find(h => h.tileId === support[0])!)) {
          failure = row.detail = "Retained pickup requires the same grip and approach; a regrasp needs its own transition."; break;
        }
        let prefix = subset(current,placed);
        const component = movingComponent(prefix,hand.tileId,components(prefix));
        if (component.status !== "pass") { failure = row.detail = component.detail; break; }
        const declared = components(current);
        if (declared && !declared.some(group => [hand.tileId,...support,...operation.tileIds].every(id => group.includes(id)))) {
          failure = row.detail = "Pickup and insertion must belong to the same declared component."; break;
        }
        // A held neighbor cannot disappear from the hand contract as motion
        // starts. Check withdrawal at the actual pose and settle on the pickup
        // grip alone before lifting; the resulting state is the motion input.
        {
          const previousHands=structuredClone(heldHands), old=heldHands.find(h => h.tileId === hand.tileId);
          row.pickupHandoff={status:"fail",detail:"",previousHands,retainedHands:[hand]};
          if (old && !sameHandContact(old,hand)) {
            failure = row.detail = row.pickupHandoff.detail = "Pickup changes an existing grip without a checked regrasp."; break;
          }
          const acquisition = old ? [hand,...heldHands.filter(h => h.tileId !== hand.tileId)] : [hand,...heldHands];
          const access = checkHandAccess(prefix,{id:"pickup-withdrawal",movingTileIds:[hand.tileId],
            fixedTileIds:prefix.tiles.filter(t => t.id !== hand.tileId).map(t => t.id),
            offsets:[{x:0,y:0,z:0},{x:0,y:0,z:0}]},acquisition,floorY,deadline);
          row.pickupHandoff.detail=access.detail;
          if (access.status !== "pass") { failure=row.detail=access.detail; break; }
          if (heldHands.length !== 1 || !sameHandContact(heldHands[0],hand)) {
            current=mergePoses(current,await record(prefix,[hand.tileId]));
            if (failure) { row.detail=row.pickupHandoff.detail=failure; break; }
            prefix=subset(current,placed);
          }
          row.pickupHandoff.status="pass";
          row.pickupHandoff.detail="Grip acquisition and previous-hand withdrawal clear; the single pickup grip supports the actual prefix before lifting.";
        }
        const tile = prefix.tiles.find(t => t.id === hand.tileId)!, q = tileQuaternion(tile);
        const lifted = await simulateHeldMotion(prefix,physicalState,component.tileIds,[hand], [
          { seconds: 0,position: tile.position,rotation: q }, { seconds: 1,position: add(tile.position,{ x: 0,y: height,z: 0 }),rotation: q }],floorY,seed,deadline,components(prefix));
        const { settled,state,...summary } = lifted;
        row.pickup = summary;
        row.timeline!.push({ phase: "pickup",activeConnectionIds: state?.joints.map(j=>j.model.id) });
        if (lifted.status !== "pass") { failure = row.detail = lifted.detail; break; }
        current = mergePoses(current,settled); physicalState = state; heldHands=[hand];
        if (!retained) {
          const handoff = checkHandAccess(subset(current,placed), { id: "handoff", movingTileIds: [hand.tileId], fixedTileIds: [...placed].filter(id => id !== hand.tileId),
            offsets: [{ x: 0,y: 0,z: 0 },{ x: 0,y: 0,z: 0 }] },[hand,...hands.filter(h => placed.has(h.tileId))],floorY,deadline);
          if (handoff.status !== "pass") { failure = row.detail = handoff.detail; break; }
          current = mergePoses(current, await record(subset(current,placed),[hand.tileId,...support]));
          if (failure) { row.detail = failure; break; }
        }
      }
      // Remove the previous insertion hand before using it for another tile.
      if (placed.size) {
        current = mergePoses(current, await record(subset(current, placed), support));
        if (failure) { row.detail = failure; break; }
      }
      if (!operation.gravitySeat && placed.size) {
        const present = subset(current,new Set([...operation.tileIds,...placed]));
        const docking = dockToSupports(nominal, current, operation.tileIds, [...placed], hands, floorY, policy, deadline,components(present));
        row.docking = { status: docking.status, detail: docking.detail, offset: docking.offset,targetPenetration: docking.targetPenetration };
        if (docking.status !== "pass") { failure = row.detail = docking.detail; break; }
        current = docking.build;
      }
      const releaseOffset = { x: 0, y: operation.gravitySeat?.releaseHeight ?? 0, z: 0 };
      const approachPose = () => ({ ...current, tiles: current.tiles.map(t => moving.has(t.id)
        ? { ...t, position: add(t.position, releaseOffset) } : t) });
      let approach = approachPose();
      const path = findHandInsertionPath(approach, operation.tileIds, [...placed], hands, floorY, deadline);
      if (!path) { failure = row.detail = "No insertion clears settled predecessors and fingertips."; break; }
      row.path = path;
      row.grip = checkHandAccess(approach, path, hands, floorY,deadline);
      if (row.grip.status !== "pass") { failure = row.detail = row.grip.detail; break; }
      const airborne = subset(approach, new Set([...moving, ...placed]));
      airborne.tiles = airborne.tiles.map(t => moving.has(t.id) ? { ...t, position: add(t.position, path!.offsets[0]) } : t);
      airborne.connections = airborne.connections.filter(c => moving.has(c.fromTileId) === moving.has(c.toTileId));
      const pickup = approach.tiles.find(t => t.id === hands.find(h => moving.has(h.tileId))!.tileId)!;
      let seconds = 0;
      const waypoints = path.offsets.map((offset, i) => {
        if (i) seconds += Math.max(.1, magnitude(add(offset, scale(path!.offsets[i-1],-1))) / 1.5);
        return { seconds, position: add(pickup.position, offset), rotation: tileQuaternion(pickup) };
      });
      const carried = await simulateHeldMotion(airborne, physicalState, operation.tileIds, hands, waypoints, floorY, seed, deadline,components(airborne));
      const { settled: carriedPose, state: carriedState, ...carrySummary } = carried;
      row.carry = carrySummary;
      row.timeline!.push({ phase: "carry",activeConnectionIds: carriedState?.joints.map(j=>j.model.id) });
      if (carried.status !== "pass") { failure = row.detail = carried.detail; break; }
      physicalState = carriedState;
      heldHands = hands;
      approach = mergePoses(approach, carriedPose);
      row.approachTiles = approach.tiles.filter(t => moving.has(t.id) || placed.has(t.id));
      current = mergePoses(current, { ...carriedPose, tiles: carriedPose.tiles.map(t => moving.has(t.id)
        ? { ...t, position: add(t.position, scale(releaseOffset,-1)) } : t) });
      if (operation.gravitySeat) {
        const present = subset(current,new Set([...placed,...moving]));
        const seated = await simulateGravitySeat(present, operation.tileIds, hands,
          operation.gravitySeat.releaseHeight, floorY, seed, deadline, physicalState,operation.gravitySeat.placement,components(present));
        const { settled, state, ...summary } = seated;
        row.seating = summary;
        row.timeline!.push({ phase: "seating",activeConnectionIds: seated.activeJointIds.filter(id=>!seated.poppedJoints.includes(id)) });
        if (seated.path) row.path = seated.path;
        if (seated.motion.length) row.approachTiles = seated.motion[0].tiles;
        row.closure = { status: seated.status, detail: seated.detail };
        if (seated.status !== "pass") { failure = row.detail = seated.detail; break; }
        current = mergePoses(current, settled);
        physicalState = state;
        heldHands = hands.filter(h => support.includes(h.tileId));
      } else {
        row.closure = checkClosure(current, path,components(subset(current,new Set([...placed,...moving]))));
        if (row.closure.status !== "pass") { failure = row.detail = row.closure.detail; break; }
      }
      moving.forEach(id => placed.add(id));
      current = mergePoses(current, await record(subset(current, placed), operation.gravitySeat ? support : hands.map(h => h.tileId)));
      if (!failure && operation.lowerBeforeRelease !== undefined) {
        const height = operation.lowerBeforeRelease, hand = hands.find(h => support.includes(h.tileId));
        if (!operation.releaseAfter || !hand || support.length !== 1 || !Number.isFinite(height) || height <= 0 || height > .9) {
          failure = row.detail = "Controlled descent needs one support panel, a bounded distance and a following release."; break;
        }
        const component = movingComponent(subset(current,placed),hand.tileId,components(subset(current,placed)));
        if (component.status !== "pass") { failure = row.detail = component.detail; break; }
        if (operation.tileIds.some(id => !component.tileIds.includes(id))) {
          failure = row.detail = "Lowering and insertion must belong to the same declared component."; break;
        }
        current = mergePoses(current,await record(subset(current,placed),[hand.tileId]));
        if (failure) { row.detail = failure; break; }
        const prefix = subset(current,placed), tile = prefix.tiles.find(t => t.id === hand.tileId)!, q = tileQuaternion(tile);
        const lowered = await simulateHeldMotion(prefix,physicalState,component.tileIds,[hand], [
          { seconds: 0,position: tile.position,rotation: q }, { seconds: 1,position: add(tile.position,{ x: 0,y: -height,z: 0 }),rotation: q }],floorY,seed,deadline,components(prefix));
        const { settled,state,...summary } = lowered;
        row.lowering = summary;
        row.timeline!.push({ phase: "lowering",activeConnectionIds: state?.joints.map(j=>j.model.id) });
        if (lowered.status !== "pass") { failure = row.detail = lowered.detail; break; }
        current = mergePoses(current,settled); physicalState = state;
        heldHands = [hand];
      }
      if (!failure && operation.releaseAfter)
        current = mergePoses(current, await record(subset(current, placed), []));
      if (failure) { row.detail = failure; break; }
      row.status = "pass";
      row.detail = operation.gravitySeat ? "Clear release grip, gravity-seated contacts and stable connected prefix; actual motion retained."
        : "Clear grip and insertion, connected closure and stable supported prefix; actual settled poses retained.";
    }
    if (failure) { failures.push(`Seed ${seed}: ${failure}`); continue; }
    // Includes release-only checkpoints which add no new parts. Reusing a held
    // module must never skip its first unsupported release.
    if (stage.support === "released") {
      const present = subset(current,placed);
      const transition = checkHandTransition(present,heldHands,[],floorY,deadline);
      if (transition.changed) (result.checkpointHandTransitions ??= []).push({ ...transition,seed });
      if (transition.status !== "pass") { failures.push(`Seed ${seed}: ${transition.detail}`); continue; }
      const { settled, state, ...checkpoint } = await simulateSupport(present, [], floorY, seed, deadline, physicalState, [],components(present));
      result.checkpoints.push(checkpoint);
      const closure = componentContacts(settled,components(settled));
      if (checkpoint.status !== "pass" || closure.status !== "pass") {
        failures.push(`Seed ${seed}: ${checkpoint.status !== "pass" ? checkpoint.detail : closure.detail}`); continue;
      }
      current = mergePoses(current, settled);
      physicalState = state;
      heldHands = [];
    }
    if (!physicalState) { failures.push(`Seed ${seed}: No terminal physical state.`); continue; }
    states.push({ id: `${stage.id}:${seed}`,stageId: stage.id,seed,predecessorId: predecessor?.id,
      lineage: predecessor ? [...predecessor.lineage,predecessor.id] : [],floorY,constructionOffset: offset,
      build: subset(current,placed),state: physicalState,hands: heldHands,components: components(subset(current,placed)) ?? [[...placed]] });
  }
  result.status = failures.length ? "fail" : "pass";
  result.detail = failures.join(" ") || "All operations passed with three perturbation seeds, at most two panel grips and mandatory free checkpoints. Fingertip-proxy simulation only; measured human grip and physical magnetic forces remain unverified.";
  return { ...result,states: failures.length ? [] : states };
}
