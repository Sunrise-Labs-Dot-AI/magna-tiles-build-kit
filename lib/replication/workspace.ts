import { connectionId } from "@/lib/engine/build";
import { PHYSICS_MODEL_VERSION } from "@/lib/engine/constants";
import { currentTilePose, type EngineState } from "@/lib/engine/rapier-world";
import type { BuildGraph, Vec3 } from "@/lib/magnetic-tiles/types";
import { samePoses } from "./rotation-clearance";
import type { HandContact } from "./grip";
import { RigidBodyType } from "@/lib/engine/physics-backend";
import { componentContacts } from "./components";

/** A complete terminal world, never a nominal module pose to be merged later. */
export interface PreparedWorkspace {
  id: string;
  stageId: string;
  seed: number;
  predecessorId?: string;
  lineage: string[];
  floorY: number;
  constructionOffset: Vec3;
  build: BuildGraph;
  state: EngineState;
  hands: HandContact[];
  components: string[][];
}

export function workspaceBuild(workspace: PreparedWorkspace, floorY: number): BuildGraph {
  const { state, build } = workspace;
  if (!Number.isFinite(floorY) || !Number.isFinite(workspace.floorY) || state.physicsModel !== PHYSICS_MODEL_VERSION ||
      state.solidFailures.length > 0 ||
      workspace.id !== `${workspace.stageId}:${workspace.seed}` ||
      new Set(state.bodies.map(b => b.referenceTile.id)).size !== state.bodies.length ||
      state.bodies.length !== build.tiles.length || workspace.hands.length > 2 ||
      new Set(workspace.hands.map(h => h.tileId)).size !== workspace.hands.length ||
      workspace.hands.some(h => !build.tiles.some(t => t.id === h.tileId)) ||
      state.bodies.some(b => workspace.hands.some(h => h.tileId === b.referenceTile.id) === (b.bodyType === RigidBodyType.Dynamic)))
    throw new Error("Invalid prepared workspace state or hands.");
  const actual = { ...build, tiles: state.bodies.map(b => currentTilePose(b.referenceTile,b.position,b.rotation,workspace.floorY)) };
  if (!samePoses(build,actual) || componentContacts(build,workspace.components).status !== "pass" ||
      JSON.stringify(build.connections.map(connectionId).sort()) !== JSON.stringify(state.connections.map(connectionId).sort()))
    throw new Error("Prepared workspace does not match its actual terminal state.");
  return { ...build, tiles: build.tiles.map(t => ({ ...t,position: { ...t.position,y: t.position.y + floorY-workspace.floorY } })) };
}

export function selectWorkspace(workspaces: PreparedWorkspace[], stageId: string, seed: number, requiredStages: string[]): PreparedWorkspace {
  const eligible = workspaces.filter(w => w.seed === seed), selected = eligible.find(w => w.stageId === stageId);
  if (!selected) throw new Error("An earlier module has not passed its complete supported assembly.");
  if (requiredStages.some(id => ![...selected.lineage,selected.id].includes(`${id}:${seed}`)))
    throw new Error("Prepared workspace lacks a required installed-stage history.");
  const ids = new Set(selected.build.tiles.map(t => t.id));
  if (eligible.slice(eligible.indexOf(selected)+1).some(w => w.build.tiles.some(t => ids.has(t.id))))
    throw new Error("A later workspace owns these parts; a stale branch cannot be combined.");
  workspaceBuild(selected,selected.floorY);
  return selected;
}
