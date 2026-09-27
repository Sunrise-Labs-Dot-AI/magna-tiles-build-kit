import RAPIER, {
  ColliderDesc,
  JointData,
  RigidBodyDesc,
  type ImpulseJoint,
  type RigidBody,
  type World
} from "@dimforge/rapier3d-compat";
import type { EngineBuild } from "./build";
import {
  GROUND_FRICTION,
  HINGE_MAX_ANGLE,
  HINGE_MIN_ANGLE,
  SIMULATION_TIMESTEP_SECONDS,
  TILE_CONTACT_SKIN,
  TILE_FRICTION
} from "./constants";
import { add, distance, magnitude, quaternionToBasis, transformLocal } from "./math";
import {
  createMagneticPhysicsModel,
  currentWorldEdgeFromBody,
  gravityVector,
  sampleJointBreak,
  type MagneticPhysicsModel,
  type PhysicsBodyModel,
  type PhysicsJointModel
} from "./physics-model";
import type { TileInstance, Vec3 } from "@/lib/magnetic-tiles/types";

interface BodyRecord {
  tile: TileInstance;
  body: RigidBody;
  targetPosition: Vec3;
  hull: Float32Array;
}

interface JointRecord {
  id: string;
  joint: ImpulseJoint;
  model: PhysicsJointModel;
  previousDistance: number;
}

export interface EngineWorld {
  world: World;
  bodies: Map<string, BodyRecord>;
  joints: JointRecord[];
  poppedJoints: string[];
  rejectedReasons: string[];
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

export async function createEngineWorld(input: EngineBuild, options: { drop?: boolean; floorY?: number } = {}): Promise<EngineWorld> {
  await initRapier();

  const model = createMagneticPhysicsModel(input, options);
  const world = new RAPIER.World(gravityVector());
  world.integrationParameters.dt = SIMULATION_TIMESTEP_SECONDS;
  world.integrationParameters.numSolverIterations = 16;

  addGround(world, model);

  const bodies = new Map<string, BodyRecord>();
  for (const bodyModel of model.bodies) {
    const record = addTileBody(world, bodyModel);
    bodies.set(bodyModel.tile.id, record);
  }

  const joints = model.joints.flatMap((jointModel) => {
    const from = bodies.get(jointModel.fromTileId);
    const to = bodies.get(jointModel.toTileId);
    if (!from || !to) return [];
    return [addHingeJoint(world, from, to, jointModel)];
  });

  const engine: EngineWorld = {
    world,
    bodies,
    joints,
    poppedJoints: [],
    rejectedReasons: model.rejectedReasons,
    step() {
      world.step();
      updateBreakableJoints(engine);
    },
    dispose() { world.free(); },
    maxDisplacement() {
      return Math.max(
        0,
        ...Array.from(bodies.values()).map(({ body, hull, targetPosition }) => {
          const basis = quaternionToBasis(body.rotation());
          let maximum = distance(vector(body.translation()), targetPosition);
          for (let i = 0; i < hull.length; i += 3) {
            const vertex = { x: hull[i], y: hull[i + 1], z: hull[i + 2] };
            maximum = Math.max(maximum, distance(transformLocal(vertex, vector(body.translation()), basis), add(targetPosition, vertex)));
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
    hull: model.localHullPoints
  };
}

function addHingeJoint(world: World, from: BodyRecord, to: BodyRecord, model: PhysicsJointModel): JointRecord {
  const joint = world.createImpulseJoint(JointData.revolute(model.fromLocalAnchor, model.toLocalAnchor, model.axis), from.body, to.body, true);

  if ("setLimits" in joint && typeof joint.setLimits === "function") {
    joint.setLimits(HINGE_MIN_ANGLE, HINGE_MAX_ANGLE);
  }
  joint.setContactsEnabled(true);

  return {
    id: model.id,
    joint,
    model,
    previousDistance: 0
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

    if (sample.shouldBreak) {
      engine.world.removeImpulseJoint(record.joint, true);
      engine.poppedJoints.push(record.id);
      engine.joints.splice(engine.joints.indexOf(record), 1);
    }
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
