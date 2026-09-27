import { ColliderDesc, RigidBodyDesc } from "@dimforge/rapier3d-compat";
import { driveSurfaceTiles, normalizeBuild, type EngineBuild } from "./build";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import {
  BALL_FRICTION,
  COLLAPSE_DISPLACEMENT,
  MAX_STANDING_DISPLACEMENT,
  ROLL_TEST_MAX_STEPS,
  ROLL_TEST_OFF_SURFACE_MARGIN,
  ROLL_TEST_SETTLE_STEPS,
  SETTLED_ANGULAR_SPEED,
  SETTLED_LINEAR_SPEED,
  SETTLED_REQUIRED_STEPS,
  SIMULATION_MAX_STEPS,
} from "./constants";
import { createEngineWorld } from "./rapier-world";
import { dot, magnitude, scale, subtract } from "./math";
import { createRollTestPlan } from "./physics-model";
import { RAW_OVERLAP_TOLERANCE } from "./overlap";

export interface SimulationResult {
  stands: boolean;
  maxDisplacement: number;
  peakGroundPenetration: number;
  settledSteps: number;
  poppedJoints: string[];
}

export interface RollTestResult {
  reachedBottom: boolean;
  fellOff: boolean;
  peakGroundPenetration: number;
}

export class SimulationBudgetExceeded extends Error {
  constructor() {
    super("Analysis time budget exceeded.");
    this.name = "SimulationBudgetExceeded";
  }
}

export async function simulate(
  input: EngineBuild,
  options: { deadline?: number } = {},
): Promise<SimulationResult> {
  const engine = await createEngineWorld(normalizeBuild(input), { drop: true });
  try {
    let settledSteps = 0;

    for (let step = 0; step < SIMULATION_MAX_STEPS; step += 1) {
      if (step % 32 === 0 && Date.now() > (options.deadline ?? Infinity))
        throw new SimulationBudgetExceeded();
      engine.step();
      if (engine.peakDisplacement > COLLAPSE_DISPLACEMENT || engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE) break;
      if (
        engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED &&
        engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED
      ) {
        settledSteps += 1;
      } else {
        settledSteps = 0;
      }
    }

    const maxDisplacement = engine.peakDisplacement;
    const result = {
      stands:
        engine.rejectedReasons.length === 0 &&
        engine.poppedJoints.length === 0 &&
        engine.peakGroundPenetration <= RAW_OVERLAP_TOLERANCE &&
        settledSteps >= SETTLED_REQUIRED_STEPS &&
        maxDisplacement <= MAX_STANDING_DISPLACEMENT,
      maxDisplacement,
      peakGroundPenetration: engine.peakGroundPenetration,
      settledSteps,
      poppedJoints: [...engine.rejectedReasons, ...engine.poppedJoints],
    };
    return result;
  } finally {
    engine.dispose();
  }
}

export async function rollTest(input: EngineBuild): Promise<RollTestResult> {
  const build = normalizeBuild(input);
  const engine = await createEngineWorld(build, { drop: true });
  try {
    const path = createRollTestPlan(build);
    if (!path || engine.rejectedReasons.length > 0) {
      return { reachedBottom: false, fellOff: true, peakGroundPenetration: engine.peakGroundPenetration };
    }
    if (hasPathObstruction(build, path)) {
      return { reachedBottom: false, fellOff: true, peakGroundPenetration: engine.peakGroundPenetration };
    }

    for (let index = 0; index < ROLL_TEST_SETTLE_STEPS; index += 1) {
      engine.step();
    }

    if (
      engine.poppedJoints.length > 0 ||
      engine.peakDisplacement > MAX_STANDING_DISPLACEMENT || engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE
    ) {
      return { reachedBottom: false, fellOff: true, peakGroundPenetration: engine.peakGroundPenetration };
    }

    const ball = engine.world.createRigidBody(
      RigidBodyDesc.dynamic()
        .setTranslation(
          path.start.x,
          path.start.y + path.radius + 0.08,
          path.start.z,
        )
        .setLinvel(path.downhill.x * 0.25, -0.02, path.downhill.z * 0.25)
        .setAdditionalSolverIterations(12),
    );
    ball.enableCcd(true);
    engine.world.createCollider(
      ColliderDesc.ball(path.radius)
        .setMass(0.045)
        .setFriction(BALL_FRICTION)
        .setRestitution(0.03),
      ball,
    );

    let reachedBottom = false;
    let fellOff = false;
    let bestProgress = Number.NEGATIVE_INFINITY;
    let lastProgressStep = 0;
    const requiredProgress = 1 + (path.radius + 0.35) / path.length;
    for (let step = 0; step < ROLL_TEST_MAX_STEPS; step += 1) {
      engine.step();
      if (engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE || engine.peakDisplacement > MAX_STANDING_DISPLACEMENT || engine.poppedJoints.length) {
        fellOff = true;
        break;
      }
      const position = ball.translation();
      const progress =
        dot(subtract(position, path.start), path.axis) / path.length;
      const lateral = lateralDistance(position, path.start, path.axis);
      const speed = magnitude(ball.linvel());

      if (progress > bestProgress + 0.015) {
        bestProgress = progress;
        lastProgressStep = step;
      }

      if (
        progress >= requiredProgress &&
        distance2d(position, path.bottom) >= path.radius
      ) {
        reachedBottom = true;
        break;
      }
      if (
        position.y < -0.4 ||
        lateral > path.halfWidth + ROLL_TEST_OFF_SURFACE_MARGIN
      ) {
        fellOff = true;
        break;
      }
      if (
        step - lastProgressStep > 180 &&
        speed < SETTLED_LINEAR_SPEED * 2 &&
        progress < requiredProgress
      ) {
        fellOff = true;
        break;
      }
    }

    return {
      reachedBottom,
      fellOff: fellOff || !reachedBottom || engine.poppedJoints.length > 0,
      peakGroundPenetration: engine.peakGroundPenetration,
    };
  } finally {
    engine.dispose();
  }
}

function distance2d(
  first: { x: number; z: number },
  second: { x: number; z: number },
): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function lateralDistance(
  position: { x: number; z: number },
  start: { x: number; z: number },
  axis: { x: number; z: number },
): number {
  const offset = subtract(
    { x: position.x, y: 0, z: position.z },
    { x: start.x, y: 0, z: start.z },
  );
  return magnitude(
    subtract(
      offset,
      scale(
        { x: axis.x, y: 0, z: axis.z },
        dot(offset, { x: axis.x, y: 0, z: axis.z }),
      ),
    ),
  );
}

function hasPathObstruction(
  build: EngineBuild,
  path: NonNullable<ReturnType<typeof createRollTestPlan>>,
): boolean {
  const driveTileIds = new Set(driveSurfaceTiles(build).map((tile) => tile.id));
  const corridorStart = path.clearanceStart;
  const corridorLength = dot(subtract(path.bottom, corridorStart), path.axis);
  const lateralAxis = { x: -path.axis.z, y: 0, z: path.axis.x };
  const corridorHalfWidth = path.radius + 0.18;
  const minPathY = Math.min(path.start.y, path.bottom.y);

  return build.tiles.some((tile) => {
    if (driveTileIds.has(tile.id)) return false;
    const points = tileWorldVertices(tile);
    const progress = points.map((point) =>
      dot(subtract(point, corridorStart), path.axis),
    );
    if (
      Math.max(...progress) < -path.radius ||
      Math.min(...progress) > corridorLength + path.radius
    )
      return false;

    const lateral = points.map((point) =>
      dot(subtract(point, corridorStart), lateralAxis),
    );
    if (
      Math.max(...lateral) < -corridorHalfWidth ||
      Math.min(...lateral) > corridorHalfWidth
    )
      return false;

    return (
      Math.max(...points.map((point) => point.y)) >=
      minPathY + path.radius * 0.5
    );
  });
}
