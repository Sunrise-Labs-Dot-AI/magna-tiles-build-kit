import RAPIER, {
  ColliderDesc,
  JointData,
  RigidBodyDesc,
  type ImpulseJoint,
  type RigidBody,
  type RigidBodyType,
  type World
} from "@dimforge/rapier3d-compat";
import { connectionId, tilePrismPoints, type EngineBuild } from "./build";
import {
  GROUND_FRICTION,
  HINGE_MAX_ANGLE,
  HINGE_MIN_ANGLE,
  SIMULATION_TIMESTEP_SECONDS,
  TILE_CONTACT_SKIN,
  TILE_FRICTION
} from "./constants";
import { add, distance, magnitude, quaternionToBasis, scale, transformLocal, worldToLocal, type Quat } from "./math";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import {
  createMagneticPhysicsModel,
  currentWorldEdgeFromBody,
  gravityVector,
  sampleJointBreak,
  type MagneticPhysicsModel,
  type PhysicsBodyModel,
  type PhysicsJointModel
} from "./physics-model";
import type { MagneticConnection, TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";

interface BodyRecord {
  tile: TileInstance;
  body: RigidBody;
  targetPosition: Vec3;
  targetRotation: Quat;
  hull: Float32Array;
  releasePerturbed: boolean;
}

interface JointRecord {
  id: string;
  joint: ImpulseJoint;
  companion?: ImpulseJoint;
  model: PhysicsJointModel;
  previousDistance: number;
  companionPreviousDistance: number;
}

/** Internal phase handoff. Coordinates are relative to the fixed table (y=0).
 * Reference geometry is immutable: a settled pose must not become a new hull
 * frame or a new magnetic anchor. Solver warm-start caches are not serialized. */
export interface EngineState {
  bodies: { referenceTile: TileInstance; position: Vec3; rotation: Quat; linearVelocity: Vec3;
    angularVelocity: Vec3; bodyType: RigidBodyType; ccd: boolean; sleeping: boolean; releasePerturbed: boolean }[];
  joints: { model: PhysicsJointModel; previousDistance: number; companionPreviousDistance: number }[];
  connections: MagneticConnection[];
  poppedJoints: string[];
}

export interface EngineWorld {
  world: World;
  bodies: Map<string, BodyRecord>;
  joints: JointRecord[];
  poppedJoints: string[];
  rejectedReasons: string[];
  floorY: number;
  snapshot(): EngineState;
  step(): void;
  maxDisplacement(): number;
  maxSpeed(): number;
  dispose(): void;
}

let rapierReady: Promise<void> | null = null;

export async function initRapier(): Promise<void> {
  rapierReady ??= withRapierInitWarningSuppressed();
  await rapierReady;
}

async function withRapierInitWarningSuppressed(): Promise<void> {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0] ?? "").includes("using deprecated parameters for the initialization function")) return;
    originalWarn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = originalWarn;
  }
}

export async function createEngineWorld(input: EngineBuild, options: { drop?: boolean; floorY?: number; state?: EngineState } = {}): Promise<EngineWorld> {
  await initRapier();
  const state = options.state;
  if (state && (options.drop !== false || options.floorY === undefined)) throw new Error("State continuation requires an explicit fixed floor and no new drop");
  const existingConnections = new Map(state?.joints.map(j => [j.model.id, j.model.connection]));
  const model = createMagneticPhysicsModel(input, { ...options, existingConnections });
  const floorY = options.floorY ?? -(model.bodies[0]?.targetPosition.y - (input.tiles[0]?.position.y ?? 0));
  if (state) validateContinuation(input, state, floorY);
  const world = new RAPIER.World(gravityVector());
  world.integrationParameters.dt = SIMULATION_TIMESTEP_SECONDS;
  world.integrationParameters.numSolverIterations = 16;

  addGround(world, model);

  const bodies = new Map<string, BodyRecord>();
  for (const bodyModel of model.bodies) {
    const saved = state?.bodies.find(b => b.referenceTile.id === bodyModel.tile.id);
    const record = addTileBody(world, saved ? { ...bodyModel, tile: saved.referenceTile,
      localHullPoints: tilePrismPoints(saved.referenceTile), translation: saved.position,
      targetPosition: saved.position, linearVelocity: saved.linearVelocity, angularVelocity: saved.angularVelocity } : bodyModel);
    if (saved) {
      record.body.setRotation(saved.rotation, false);
      record.body.setBodyType(saved.bodyType, false);
      record.body.setLinvel(saved.linearVelocity, false);
      record.body.setAngvel(saved.angularVelocity, false);
      record.body.enableCcd(saved.ccd);
      if (saved.sleeping) record.body.sleep();
      record.targetRotation = { ...saved.rotation };
      record.releasePerturbed = saved.releasePerturbed;
    }
    bodies.set(bodyModel.tile.id, record);
  }

  const savedJointIds = new Set(state?.joints.map(j => j.model.id));
  const joints = [...(state?.joints.map(j => j.model) ?? []), ...model.joints.filter(j => !savedJointIds.has(j.id) && !state?.poppedJoints.includes(j.id))].flatMap((jointModel) => {
    const from = bodies.get(jointModel.fromTileId);
    const to = bodies.get(jointModel.toTileId);
    if (!from || !to) return [];
    const saved = state?.joints.find(j => j.model.id === jointModel.id);
    const record = addHingeJoint(world, from, to, saved ? jointModel : localizeNewJoint(jointModel, from, to));
    record.previousDistance = saved?.previousDistance ?? 0;
    record.companionPreviousDistance = saved?.companionPreviousDistance ?? 0;
    return [record];
  });

  const engine: EngineWorld = {
    world,
    bodies,
    joints,
    poppedJoints: [...(state?.poppedJoints ?? [])],
    rejectedReasons: model.rejectedReasons,
    floorY,
    snapshot() {
      return structuredClone({ bodies: [...bodies.values()].map(({ tile, body, releasePerturbed }) => ({ referenceTile: tile,
        position: vector(body.translation()), rotation: { ...body.rotation() }, linearVelocity: vector(body.linvel()),
        angularVelocity: vector(body.angvel()), bodyType: body.bodyType(), ccd: body.isCcdEnabled(), sleeping: body.isSleeping(), releasePerturbed })),
      joints: engine.joints.map(j => ({ model: j.model, previousDistance: j.previousDistance, companionPreviousDistance: j.companionPreviousDistance })),
      connections: input.connections, poppedJoints: engine.poppedJoints });
    },
    step() {
      world.step();
      updateBreakableJoints(engine);
    },
    dispose() { world.free(); },
    maxDisplacement() {
      return Math.max(
        0,
        ...Array.from(bodies.values()).map(({ body, hull, targetPosition, targetRotation }) => {
          const basis = quaternionToBasis(body.rotation());
          const targetBasis = quaternionToBasis(targetRotation);
          let maximum = distance(vector(body.translation()), targetPosition);
          for (let i = 0; i < hull.length; i += 3) {
            const vertex = { x: hull[i], y: hull[i + 1], z: hull[i + 2] };
            maximum = Math.max(maximum, distance(transformLocal(vertex, vector(body.translation()), basis), transformLocal(vertex, targetPosition, targetBasis)));
          }
          return maximum;
        })
      );
    },
    maxSpeed() {
      return Math.max(
        0,
        ...Array.from(bodies.values()).map(({ body }) => Math.max(magnitude(vector(body.linvel())), magnitude(vector(body.angvel()))))
      );
    }
  };
  return engine;
}

function addTileBody(world: World, model: PhysicsBodyModel): BodyRecord {
  const body = world.createRigidBody(
    RigidBodyDesc.dynamic()
      .setTranslation(model.translation.x, model.translation.y, model.translation.z)
      .setLinvel(model.linearVelocity.x, model.linearVelocity.y, model.linearVelocity.z)
      .setAngvel(model.angularVelocity)
      .setAdditionalSolverIterations(8)
  );
  body.userData = { tileId: model.tile.id };

  const hull = ColliderDesc.convexHull(model.localHullPoints);
  if (!hull) throw new Error(`Unable to create convex hull for tile ${model.tile.id}`);
  world.createCollider(
    hull
      .setMass(model.mass)
      .setFriction(TILE_FRICTION)
      .setRestitution(0.02)
      .setContactSkin(TILE_CONTACT_SKIN),
    body
  );

  return {
    tile: model.tile,
    body,
    targetPosition: model.targetPosition,
    targetRotation: { x: 0, y: 0, z: 0, w: 1 },
    hull: model.localHullPoints,
    releasePerturbed: false
  };
}

/** Apply the declared release uncertainty once per panel, adding to its actual
 * momentum. The marker follows state handoffs, so later trials cannot reseed it. */
export function perturbFirstRelease(record: BodyRecord, index: number, seed: number): void {
  if (record.releasePerturbed) return;
  const noise = (n: number) => Math.sin((index+1)*13.13+(seed+1)*n);
  record.body.setLinvel(add(vector(record.body.linvel()), { x: noise(1.7)*.03, y: 0, z: noise(2.9)*.03 }), true);
  record.body.setAngvel(add(vector(record.body.angvel()), { x: noise(3.1)*.015, y: noise(4.7)*.015, z: noise(6.3)*.015 }), true);
  record.releasePerturbed = true;
}

function addHingeJoint(world: World, from: BodyRecord, to: BodyRecord, model: PhysicsJointModel): JointRecord {
  const joint = world.createImpulseJoint(model.secondAnchors ? JointData.spherical(model.fromLocalAnchor, model.toLocalAnchor)
    : JointData.revolute(model.fromLocalAnchor, model.toLocalAnchor, model.axis), from.body, to.body, true);
  const companion = model.secondAnchors ? world.createImpulseJoint(JointData.spherical(model.secondAnchors.from, model.secondAnchors.to), from.body, to.body, true) : undefined;

  if ("setLimits" in joint && typeof joint.setLimits === "function") {
    joint.setLimits(HINGE_MIN_ANGLE, HINGE_MAX_ANGLE);
  }
  joint.setContactsEnabled(true);
  companion?.setContactsEnabled(true);

  return {
    id: model.id,
    joint,
    companion,
    model,
    previousDistance: 0,
    companionPreviousDistance: 0
  };
}

function updateBreakableJoints(engine: EngineWorld): void {
  for (const record of [...engine.joints]) {
    if (!record.joint.isValid()) continue;
    const fromBody = engine.bodies.get(record.model.fromTileId)?.body;
    const toBody = engine.bodies.get(record.model.toTileId)?.body;
    if (!fromBody || !toBody) continue;

    const fromEdge = currentWorldEdgeFromBody(vector(fromBody.translation()), fromBody.rotation(), record.model.fromLocal);
    const toEdge = currentWorldEdgeFromBody(vector(toBody.translation()), toBody.rotation(), record.model.toLocal);
    const sample = sampleJointBreak(fromEdge, toEdge, record.previousDistance, engine.world.integrationParameters.dt);
    record.previousDistance = sample.midpointDistance;

    let companionBreak = false;
    if (record.model.secondAnchors) {
      const point = (p: Vec3) => ({ start: p,end: p,midpoint: p,direction: { x: 0,y: 0,z: 0 },length: 0 });
      const a = currentWorldEdgeFromBody(vector(fromBody.translation()),fromBody.rotation(),point(record.model.secondAnchors.from));
      const b = currentWorldEdgeFromBody(vector(toBody.translation()),toBody.rotation(),point(record.model.secondAnchors.to));
      const secondary = sampleJointBreak(a,b,record.companionPreviousDistance,engine.world.integrationParameters.dt);
      record.companionPreviousDistance = secondary.midpointDistance;
      companionBreak = secondary.shouldBreak;
    }
    if (sample.shouldBreak || companionBreak) {
      engine.world.removeImpulseJoint(record.joint, true);
      if (record.companion?.isValid()) engine.world.removeImpulseJoint(record.companion, true);
      engine.poppedJoints.push(record.id);
      engine.joints.splice(engine.joints.indexOf(record), 1);
    }
  }
}

/** A new seam is expressed in the current body frames, never the authored
 * reference orientation. Two spaced points leave only rotation about the seam. */
function localizeNewJoint(model: PhysicsJointModel, from: BodyRecord, to: BodyRecord): PhysicsJointModel {
  const a = quaternionToBasis(from.body.rotation()), b = quaternionToBasis(to.body.rotation());
  const zero = { x: 0, y: 0, z: 0 };
  const convertA = (p: Vec3) => worldToLocal(p, zero, a), convertB = (p: Vec3) => worldToLocal(p, zero, b);
  const axisA = convertA(model.axis), axisB = convertB(model.axis);
  const pointEdge = (p: Vec3) => ({ start: p, end: p, midpoint: p, direction: zero, length: 0 });
  const fromAnchor = convertA(model.fromLocalAnchor), toAnchor = convertB(model.toLocalAnchor);
  const result = { ...model, fromLocalAnchor: fromAnchor, toLocalAnchor: toAnchor, axis: axisA,
    fromLocal: pointEdge(fromAnchor), toLocal: pointEdge(toAnchor) };
  if (distance(axisA, axisB) < 1e-6) return result;
  return { ...result, secondAnchors: { from: add(fromAnchor, scale(axisA, 1)), to: add(toAnchor, scale(axisB, 1)) } };
}

export function currentTilePose(reference: TileInstance, position: Vec3, rotation: Quat, floorY: number): TileInstance {
  const basis = reference.basis ?? basisFromEuler(reference.rotation.x, reference.rotation.y, reference.rotation.z);
  const q = quaternionToBasis(rotation), zero = { x: 0, y: 0, z: 0 };
  return { ...reference, position: { ...position, y: position.y + floorY }, basis: {
    xAxis: transformLocal(basis.xAxis, zero, q), yAxis: transformLocal(basis.yAxis, zero, q), zAxis: transformLocal(basis.zAxis, zero, q) } };
}

function validateContinuation(input: EngineBuild, state: EngineState, floorY: number): void {
  const ids = new Set(input.connections.map(connectionId));
  if (state.connections.some(c => !ids.has(connectionId(c)))) throw new Error("State continuation cannot omit an existing or broken connection");
  for (const saved of state.bodies) {
    const tile = input.tiles.find(t => t.id === saved.referenceTile.id);
    const actual = currentTilePose(saved.referenceTile, saved.position, saved.rotation, floorY);
    const basis = tile?.basis ?? (tile && basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z));
    if (!tile || !basis || tile.shape !== saved.referenceTile.shape || distance(tile.position, actual.position) > 1e-5 ||
      (['xAxis', 'yAxis', 'zAxis'] as const).some(axis => distance(basis[axis], actual.basis![axis]) > 1e-5))
      throw new Error(`State continuation would reset or omit tile ${saved.referenceTile.id}`);
  }
}

function addGround(world: World, model: MagneticPhysicsModel): void {
  const ground = world.createRigidBody(
    RigidBodyDesc.fixed().setTranslation(model.ground.position.x, model.ground.position.y, model.ground.position.z)
  );
  world.createCollider(
    ColliderDesc.cuboid(model.ground.halfExtents.x, model.ground.halfExtents.y, model.ground.halfExtents.z)
      .setFriction(GROUND_FRICTION)
      .setRestitution(0),
    ground
  );
}

function vector(input: { x: number; y: number; z: number }): Vec3 {
  return { x: input.x, y: input.y, z: input.z };
}
