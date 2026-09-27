import { createHash } from "node:crypto";
import { validateEngineInput } from "@/lib/engine/input";
import { gateBuild } from "@/lib/engine/gate";
import { createEngineWorld } from "@/lib/engine/rapier-world";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { cachedSimulation, physicsKey } from "./cache";
import { quaternionToBasis, transformLocal } from "@/lib/engine/math";
import {
  MAX_STANDING_DISPLACEMENT,
  SIMULATION_MAX_STEPS,
  PHYSICS_MODEL_VERSION,
  SETTLED_ANGULAR_SPEED,
  SETTLED_LINEAR_SPEED,
  SETTLED_REQUIRED_STEPS,
} from "@/lib/engine/constants";
import { RAW_OVERLAP_TOLERANCE } from "@/lib/engine/overlap";
import { countInventory } from "@/lib/magnetic-tiles/validation";
import { inventoryForPreset } from "@/lib/magnetic-tiles/catalog";
import { basisFromEuler } from "@/lib/magnetic-tiles/edge-attachment";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import { measureIntent } from "./measure";
import { validateContract } from "./contract";
import type {
  Evaluation,
  Evidence,
  IntentContract,
  ReleaseTrial,
} from "./types";

export const HARNESS_MODEL = `intent-harness-v3-${PHYSICS_MODEL_VERSION}`;
export const RELEASE_SEEDS = [0, 17, 53] as const;
const releases = new Map<
  string,
  { evidence: Evidence[]; trials: ReleaseTrial[] }
>();
/** Independent acceptance function. No program fields or cached pass flags are trusted. */
export async function evaluateCandidate(
  build: BuildGraph,
  contract: IntentContract,
  options: { deadline?: number } = {},
): Promise<Evaluation> {
  validateContract(contract);
  // Freeze the evidence inputs at the boundary, before any asynchronous WASM work.
  build = structuredClone(build);
  contract = structuredClone(contract);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ model: HARNESS_MODEL, contract, build }))
    .digest("hex");
  const evidence: Evidence[] = [],
    trials: ReleaseTrial[] = [],
    stages: Evaluation["stages"] = [];
  const finish = () => ({
    passed: evidence.length > 0 && evidence.every((e) => e.passed),
    evidence,
    trials,
    stages,
    fingerprint,
  });
  const errors = validateEngineInput(build);
  evidence.push({
    id: "input",
    label: "Valid catalog geometry",
    passed: !errors.length,
    expected: "Finite rigid tiles, unique IDs and valid references",
    actual: errors.join("; ") || "valid",
  });
  if (errors.length) return finish();
  evidence.push({
    id: "resolved-intent",
    label: "Complete intent contract",
    passed: contract.unresolved.length === 0,
    expected: "No unresolved clauses",
    actual: contract.unresolved.join("; ") || "resolved",
    repair: "intent",
  });
  evidence.push(...measureIntent(build, contract));
  const used = countInventory(build.tiles),
    available = inventoryForPreset(contract.inventoryPreset);
  const inventoryOk = Object.keys(used).every(
    (key) =>
      used[key as keyof typeof used] <= available[key as keyof typeof used],
  );
  evidence.push({
    id: "inventory",
    label: "Piece and inventory budget",
    passed:
      contract.unlimitedPieces ||
      (inventoryOk &&
        (contract.maxPieces === null ||
          build.tiles.length <= contract.maxPieces)),
    expected: contract.unlimitedPieces
      ? "Unlimited pieces"
      : `${contract.maxPieces === null ? "No requested piece cap" : `≤${contract.maxPieces} pieces`}; ${contract.inventoryPreset}`,
    actual: `${build.tiles.length} pieces; ${contract.unlimitedPieces ? "inventory limits disabled" : `inventory ${inventoryOk ? "within limits" : "overrun"}`}`,
    repair: "budget",
  });
  if (evidence.some((e) => !e.passed)) return finish();
  const releaseKey = physicsKey(build) + JSON.stringify(contract),
    cached = releases.get(releaseKey);
  if (cached) {
    evidence.push(...structuredClone(cached.evidence));
    trials.push(...structuredClone(cached.trials));
  } else {
    const evidenceStart = evidence.length;
    const gate = await gateBuild(
      { ...build, inventoryPreset: contract.inventoryPreset },
      { unlimitedPieces: contract.unlimitedPieces, deadline: options.deadline },
    );
    evidence.push({
      id: "structure",
      label: "Geometry, joins and nominal structure",
      passed: gate.passed,
      expected: "No intersections or unsupported joints; stands under gravity",
      actual: gate.reasons.join("\n"),
      repair: "reinforce",
    });
    if (!gate.passed) return finish();
    for (const seed of RELEASE_SEEDS) {
      const engine = await createEngineWorld(build, { drop: true });
      let peak = 0, settledSteps = 0;
      try {
        // Deterministic release perturbations by geometric order, not arbitrary tile IDs.
        const ordered = [...engine.bodies.values()].sort(
          (a, b) =>
            a.targetPosition.y - b.targetPosition.y ||
            a.targetPosition.x - b.targetPosition.x ||
            a.targetPosition.z - b.targetPosition.z,
        );
        ordered.forEach(({ body }, i) => {
          const noise = (k: number) =>
            Math.sin((i + 1) * 13.13 + (seed + 1) * k);
          body.setLinvel(
            { x: noise(1.7) * 0.03, y: 0, z: noise(2.9) * 0.03 },
            true,
          );
          body.setAngvel(
            {
              x: noise(3.1) * 0.015,
              y: noise(4.7) * 0.015,
              z: noise(6.3) * 0.015,
            },
            true,
          );
        });
        for (let step = 0; step < SIMULATION_MAX_STEPS; step++) {
          if (step % 32 === 0 && Date.now() > (options.deadline ?? Infinity))
            throw new SimulationBudgetExceeded();
          engine.step();
          peak = engine.peakDisplacement;
          settledSteps = engine.stepSpeeds.linear < SETTLED_LINEAR_SPEED && engine.stepSpeeds.angular < SETTLED_ANGULAR_SPEED ? settledSteps + 1 : 0;
          if (peak > MAX_STANDING_DISPLACEMENT || engine.poppedJoints.length || engine.peakGroundPenetration > RAW_OVERLAP_TOLERANCE)
            break;
        }
        const final = engine.maxDisplacement();
        peak = Math.max(peak, final);
        const settled: BuildGraph = {
          ...build,
          tiles: build.tiles.map((tile) => {
            const record = engine.bodies.get(tile.id)!,
              rotation = quaternionToBasis(record.body.rotation()),
              p = record.body.translation();
            const basis =
              tile.basis ??
              basisFromEuler(tile.rotation.x, tile.rotation.y, tile.rotation.z);
            const rotate = (v: typeof p) =>
              transformLocal(v, { x: 0, y: 0, z: 0 }, rotation);
            return {
              ...tile,
              position: {
                x: p.x,
                y: p.y - (record.targetPosition.y - tile.position.y),
                z: p.z,
              },
              basis: {
                xAxis: rotate(basis.xAxis),
                yAxis: rotate(basis.yAxis),
                zAxis: rotate(basis.zAxis),
              },
            };
          }),
        };
        const intentEvidence = measureIntent(settled, contract, "settled");
        const failedRequirements = intentEvidence
          .filter((e) => !e.passed)
          .map((e) => e.id);
        trials.push({
          seed,
          passed:
            peak <= MAX_STANDING_DISPLACEMENT &&
            engine.peakGroundPenetration <= RAW_OVERLAP_TOLERANCE &&
            settledSteps >= SETTLED_REQUIRED_STEPS &&
            !engine.poppedJoints.length &&
            failedRequirements.length === 0,
          peakDisplacement: peak,
          finalDisplacement: final,
          peakGroundPenetration: engine.peakGroundPenetration,
          settledSteps,
          failedRequirements,
          intentEvidence,
        });
      } finally {
        engine.dispose();
      }
      if (!trials.at(-1)!.passed) break;
    }
    evidence.push({
      id: "release-sweep",
      label: "Release robustness",
      passed:
        trials.length === RELEASE_SEEDS.length && trials.every((t) => t.passed),
      expected: `All ${RELEASE_SEEDS.length} releases; peak corner displacement ≤${MAX_STANDING_DISPLACEMENT} in; table penetration ≤${RAW_OVERLAP_TOLERANCE} in; ${SETTLED_REQUIRED_STEPS} consecutive rest steps`,
      actual: trials
        .map(
          (t) =>
            `seed ${t.seed}: ${t.peakDisplacement.toFixed(3)} in; table ${t.peakGroundPenetration.toFixed(3)} in; ${t.settledSteps} rest steps; settled intent ${t.failedRequirements.length ? t.failedRequirements.join(", ") : "passed"}`,
        )
        .join("; "),
      repair: "reinforce",
    });
    if (releases.size >= 32) releases.delete(releases.keys().next().value!);
    releases.set(releaseKey, {
      evidence: structuredClone(evidence.slice(evidenceStart)),
      trials: structuredClone(trials),
    });
  }
  if (evidence.some((e) => !e.passed)) return finish();
  const steps = [...new Set(build.tiles.map((t) => t.step))].sort(
    (a, b) => a - b,
  );
  if (steps.some((s, i) => !Number.isInteger(s) || s !== i + 1)) {
    evidence.push({
      id: "assembly",
      label: "Assembly sequence",
      passed: false,
      expected: "Contiguous positive steps",
      actual: "Invalid step numbering",
      repair: "sequence",
    });
    return finish();
  }
  for (const step of steps) {
    const tiles = build.tiles.filter((t) => t.step <= step),
      ids = new Set(tiles.map((t) => t.id));
    const added = tiles.filter((t) => t.step === step).length;
    const result = await cachedSimulation(
      {
        ...build,
        tiles,
        connections: build.connections.filter(
          (c) => ids.has(c.fromTileId) && ids.has(c.toTileId),
        ),
      },
      options.deadline,
    );
    stages.push({ step, tileCount: added, passed: result.stands });
  }
  evidence.push({
    id: "assembly",
    label: "Stable completed assembly stages",
    passed: stages.every((s) => s.passed),
    expected:
      "Every completed geometry-derived stage stands; hand access and within-stage stability are not modeled",
    actual: stages
      .map(
        (s) =>
          `step ${s.step}: ${s.tileCount} pieces, ${s.passed ? "stands" : "needs repair"}`,
      )
      .join("; "),
    repair: "sequence",
  });
  return finish();
}
