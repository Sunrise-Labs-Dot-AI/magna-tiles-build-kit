import { createHash } from "node:crypto";
import { PHYSICS_MODEL_VERSION } from "@/lib/engine/constants";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { validateEngineInput } from "@/lib/engine/input";
import { validateMagneticBuild } from "@/lib/engine/build";
import { findRawOverlaps } from "@/lib/engine/overlap";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { countInventory } from "@/lib/magnetic-tiles/validation";
import {
  emptyInventory,
  SHAPE_ORDER,
  TILE_SPECS,
} from "@/lib/magnetic-tiles/catalog";
import { testCars } from "@/lib/planner/car-test";
import { stageBuild } from "./geometry";
import { releaseCandidate } from "./release";
import { compareObservation } from "./projection";
import { planConstructionPaths } from "./construction";
import { evaluateAssembly } from "./assembly";
import { constructionFrameBinding, independentHoldoutCoverage, reservedFrameBinding, type CandidateFreeze, type EvidenceUse } from "./evidence";
import { validationCodeHash, verifyObservationLock } from "./provenance";
import type {
  Check,
  Observation,
  Replica,
  ReplicaReport,
  Verdict,
} from "./types";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import sources from "../../verification/replication/sources.json";
import lockedObservations from "../../verification/replication/observations.json";
import evidenceLedger from "../../verification/replication/evidence-ledger.json";
import candidateFreezes from "../../verification/replication/candidate-freezes.json";

const MODEL = `source-replication-v2-${PHYSICS_MODEL_VERSION}`;
const expectedInventory = {
  jet: {
    ...emptyInventory(),
    "small-square": 16,
    "equilateral-triangle": 9,
    "right-triangle": 10,
    "isosceles-triangle": 5,
  },
  "small-ramp": {
    ...emptyInventory(),
    "small-square": 5,
    "right-triangle": 2,
    "isosceles-triangle": 2,
  },
  "medium-ramp": {
    ...emptyInventory(),
    "small-square": 15,
    "equilateral-triangle": 18,
    "isosceles-triangle": 4,
  },
  "large-ramp": {
    ...emptyInventory(),
    "small-square": 42,
    "equilateral-triangle": 6,
    "xl-square": 3,
  },
};
const bindings = {
  jet: { source: "jet", bom: "jet-bom" },
  "small-ramp": { source: "henry", bom: "small-bom" },
  "medium-ramp": { source: "henry", bom: "medium-bom" },
  "large-ramp": { source: "henry", bom: "large-bom" },
};
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const fingerprint = (replica: Replica, observations: Observation[]) =>
  sha256(JSON.stringify({ model: MODEL, replica, observations, sources }));
const check = (status: Verdict, detail: string): Check => ({ status, detail });

export function geometryCheck(build: BuildGraph): Check {
  const errors = validateEngineInput(build);
  if (errors.length) return check("fail", errors.join("; "));
  const overlaps = findRawOverlaps(build.tiles),
    magnetic = validateMagneticBuild(build);
  const issues = [
    ...overlaps.map(
      (o) =>
        `${o.firstTileId} intersects ${o.secondTileId} by ${o.penetration} in`,
    ),
    ...magnetic.rejectedReasons,
  ];
  return check(
    issues.length ? "fail" : "pass",
    issues.join("; ") ||
      `${build.tiles.length} rigid catalog parts; ${magnetic.validConnections.length} nominal edge connections; zero raw intersections. Magnet spacing and force are not physically calibrated.`,
  );
}

export function sourceInventoryCheck(replica: Replica): Check {
  const expected =
    expectedInventory[replica.id as keyof typeof expectedInventory];
  if (!expected) return check("unverified", "No source BOM for this target.");
  const actual = countInventory(replica.build.tiles),
    differences = SHAPE_ORDER.filter((s) => actual[s] !== expected[s]);
  return check(
    differences.length ? "fail" : "pass",
    differences
      .map((s) => `${s}: source ${expected[s]}, candidate ${actual[s]}`)
      .join("; ") ||
      `${replica.build.tiles.length} parts match the independently transcribed source card. Colors and placements are separate checks.`,
  );
}

export function validateObservationBinding(
  replica: Replica,
  observation: Observation,
): void {
  if (
    !["fit", "holdout"].includes(observation.partition) ||
    observation.landmarks.some((l) => !["camera", "check"].includes(l.use))
  )
    throw new Error(`Invalid observation labels: ${observation.id}`);
  const source = sources.sources.find((s) => s.id === replica.sourceId),
    frame = source?.frames.find((f) => f.id === observation.frameId),
    stage = replica.stages.find((s) => s.id === observation.stageId);
  if (
    !frame ||
    !stage ||
    observation.replicaId !== replica.id ||
    frame.stage !== stage.id ||
    frame.use !== observation.partition ||
    observation.width !== source?.width ||
    observation.height !== source?.height
  )
    throw new Error(`Source, stage or partition mismatch: ${observation.id}`);
  if (observation.landmarks.some((l) => !stage.tileIds.includes(l.tileId)))
    throw new Error(
      `Landmark refers to an absent stage part: ${observation.id}`,
    );
}

export function instructions(replica: Replica): ReplicaReport["instructions"] {
  const labels = new Map(
      replica.build.tiles.map((t, i) => [t.id, `P${i + 1}`]),
    ),
    seen = new Set<string>(),
    seenJoins = new Set<string>();
  return replica.stages.map((stage, i) => {
    const snapshot = stageBuild(replica, stage),
      newParts = snapshot.tiles.filter((t) => !seen.has(t.id));
    newParts.forEach((t) => seen.add(t.id));
    const joins = snapshot.connections.filter((c) => {
      const key = JSON.stringify(c);
      if (seenJoins.has(key)) return false;
      seenJoins.add(key);
      return true;
    });
    return {
      step: i + 1,
      title: stage.title,
      tileIds: stage.tileIds,
      tileCounts: countInventory(newParts),
      instruction: `${stage.instruction} ${newParts.length ? `New parts: ${newParts.map((t) => `${labels.get(t.id)} (${TILE_SPECS[t.shape].label})`).join(", ")}.` : "Reuse the numbered parts already assembled."} ${joins.length ? `Joins: ${joins.map((c) => `${labels.get(c.fromTileId)} edge ${c.fromEdge + 1} to ${labels.get(c.toTileId)} edge ${c.toEdge + 1}`).join("; ")}.` : "No new magnetic joins in this pose change."} Source frame: ${stage.frameId}. ${stage.support === "held" ? "Keep this module in your hand; no unattended release is asserted." : "Release checkpoint: consult the measured result before following this candidate."}`,
    };
  });
}

export async function verifyLocalSource(replica: Replica): Promise<Check> {
  const binding = bindings[replica.id as keyof typeof bindings];
  if (
    !binding ||
    replica.sourceId !== binding.source ||
    replica.bomFrameId !== binding.bom
  )
    return check("fail", "Target is bound to a different source or BOM card.");
  const source = sources.sources.find((s) => s.id === binding.source)!;
  try {
    const bytes = await readFile(source.localPath);
    if (sha256(bytes) !== source.sha256)
      return check(
        "fail",
        "Source video hash changed; extracted observations are stale.",
      );
    const manifest = JSON.parse(
      await readFile("verification/replication/frame-manifest.json", "utf8"),
    ) as {
      frames: {
        id: string;
        sourceId: string;
        seconds: number;
        stage: string;
        partition: string;
        sourceSha256: string;
        sha256: string;
        path: string;
      }[];
    };
    for (const frame of source.frames) {
      const record = manifest.frames.find((f) => f.id === frame.id);
      if (
        !record ||
        record.sourceSha256 !== source.sha256 ||
        record.sourceId !== source.id ||
        record.seconds !== frame.seconds ||
        record.stage !== frame.stage ||
        record.partition !== frame.use ||
        record.path !==
          `public/reference-frames/replication/${source.id}/${frame.id}.png` ||
        sha256(await readFile(record.path)) !== record.sha256
      )
        return check("fail", `Missing or stale source frame ${frame.id}`);
    }
    for (const entry of (evidenceLedger.entries as EvidenceUse[]).filter(e => e.role === "reserved-holdout" && e.replicaId === replica.id)) {
      const binding = reservedFrameBinding(entry, source.sha256, source.frames.find(f => f.id === entry.frameId), manifest.frames.find(f => f.id === entry.frameId));
      if (binding.status !== "pass") return binding;
    }
    for (const stage of replica.stages) for (const claim of stage.constructionEvidence ?? []) {
      if (!claim.claim || !claim.frameIds.length) return check("fail", "Construction claim lacks a specific source frame.");
      for (const id of claim.frameIds) {
        const entries = (evidenceLedger.entries as EvidenceUse[]).filter(e => e.frameId === id), entry = entries[0];
        if (entries.length !== 1) return check("fail", `Construction claim has missing or duplicate fitting evidence: ${id}`);
        const binding = constructionFrameBinding(entry, replica.id, stage.id, source.id, source.sha256,
          source.frames.find(f => f.id === id), manifest.frames.find(f => f.id === id));
        if (binding.status !== "pass") return binding;
      }
    }
    return check(
      "pass",
      `Verified original video SHA-256 ${source.sha256} and ${source.frames.length} extracted frame hashes. Manual annotations remain reviewable measurements.`,
    );
  } catch (error) {
    return check(
      "unverified",
      `Local source verification unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function evaluateReplica(
  input: Replica,
  rawObservations: Observation[],
  options: { deadline?: number } = {},
): Promise<ReplicaReport> {
  await verifyObservationLock();
  const replica = structuredClone(input),
    observations = structuredClone(
      rawObservations.filter((o) => o.replicaId === input.id),
    );
  const pending = () => check("unverified", "Not evaluated.");
  const report: ReplicaReport = {
    id: replica.id,
    fingerprint: fingerprint(replica, observations),
    validationCodeHash: await validationCodeHash(),
    generatedAt: new Date().toISOString(),
    replication: "not-verified",
    checks: {
      source: pending(),
      inventory: pending(),
      fidelity: pending(),
      materials: pending(),
      geometry: pending(),
      release: pending(),
      settledShape: pending(),
      assembly: pending(),
      function: pending(),
    },
    projections: [],
    releases: [],
    stages: [],
    instructions: [],
    constructionPaths: [],
    assemblySimulation: [],
    holdoutCoverage: pending(),
    carTrials: [],
  };
  const deadline = options.deadline ?? Infinity;
  const budget = () => {
    if (Date.now() > deadline) throw new SimulationBudgetExceeded();
  };
  report.checks.source = await verifyLocalSource(replica);
  report.checks.inventory = sourceInventoryCheck(replica);
  report.checks.materials = check(
    "unverified",
    replica.materialQuestions.join("; ") ||
      "Magnet force/torque and vehicle parameters have no physical calibration record.",
  );
  report.checks.geometry = geometryCheck(replica.build);
  if (validateEngineInput(replica.build).length) return report;
  const sourceFrames =
    sources.sources.find((s) => s.id === replica.sourceId)?.frames ?? [];
  if (
    replica.stages.some(
      (stage) =>
        sourceFrames.find((f) => f.id === stage.frameId)?.stage !== stage.id,
    )
  )
    throw new Error(`Construction/source stage mismatch: ${replica.id}`);
  report.instructions = instructions(replica);
  report.constructionPaths = planConstructionPaths(replica, deadline);
  for (const o of observations) {
    validateObservationBinding(replica, o);
    if (
      !isDeepStrictEqual(
        o,
        lockedObservations.observations.find((known) => known.id === o.id),
      )
    )
      throw new Error(
        `Observation differs from the locked source measurement: ${o.id}`,
      );
    report.projections.push(
      compareObservation(
        stageBuild(replica, replica.stages.find((s) => s.id === o.stageId)!),
        o,
      ),
    );
  }
  const held = report.projections.filter((p) => p.partition === "holdout");
  const seen = new Set(
    observations.flatMap((o) =>
      o.landmarks.filter((l) => l.use === "check").map((l) => l.tileId),
    ),
  );
  const missing = replica.build.tiles.filter((t) => !seen.has(t.id)).length;
  const freeze = (candidateFreezes.freezes as Record<string, CandidateFreeze>)[replica.id];
  const requested = [...new Set([...held.map(p => p.frameId), ...(evidenceLedger.entries as EvidenceUse[])
    .filter(e => e.replicaId === replica.id && e.role === "reserved-holdout").map(e => e.frameId)])];
  report.holdoutCoverage = report.checks.source.status === "pass"
    ? independentHoldoutCoverage(evidenceLedger.entries as EvidenceUse[], requested, freeze, sha256(JSON.stringify(replica.build)))
    : check("unverified", "Holdout history cannot pass without locally verified source/frame bytes.");
  report.checks.fidelity = check(
    report.projections.some((p) => p.status === "fail") || report.holdoutCoverage.status === "fail" ? "fail" : "unverified",
    `${report.projections.length} measured views, ${held.length} historically withheld views, ${missing}/${replica.build.tiles.length} parts lack independent scored landmarks. ${report.holdoutCoverage.detail} Need complete visible/occluded part constraints and at least one useful final view reserved from fitting. Historical inspection and fresh reservation remain distinct. ${replica.uncertainties.map((u) => u.detail).join(" ")}`,
  );
  // Stage failures are evaluated even when the final model fails. Nothing is regrouped.
  for (const stage of replica.stages) {
    budget();
    const build = stageBuild(replica, stage),
      geometry = geometryCheck(build);
    if (geometry.status !== "pass") {
      report.stages.push({
        id: stage.id,
        status: "fail",
        detail: geometry.detail,
        displacement: null,
      });
      continue;
    }
    if (stage.support === "held") {
      report.stages.push({
        id: stage.id,
        status: "unverified",
        detail:
          "Explicitly held source module; hand access and unsupported stability are not tested.",
        displacement: null,
      });
      continue;
    }
    const result = await releaseCandidate(build, 0, deadline);
    report.stages.push({
      id: stage.id,
      status: result.status,
      detail: `Released checkpoint: peak ${result.peakDisplacement.toFixed(3)} in; table penetration ${result.peakGroundPenetration.toFixed(3)} in; ${result.poppedJoints.length} broken/rejected joints; ${result.settledSteps} consecutive steps at rest (90 required).`,
      displacement: result.peakDisplacement,
    });
  }
  report.assemblySimulation = await evaluateAssembly(replica, deadline);
  const assemblyFailed = report.stages.some(s => s.status === "fail") || report.assemblySimulation.some(s => s.status === "fail");
  report.checks.assembly = check(assemblyFailed ? "fail" : report.assemblySimulation.length > 0 && report.assemblySimulation.every(s => s.status === "pass") ? "pass" : "unverified",
    `${report.assemblySimulation.filter(s => s.status === "pass").length}/${replica.stages.length} complete stage assemblies pass the grip, insertion, closure and intermediate support simulation. ${report.assemblySimulation.filter(s => s.status !== "pass").map(s => `${s.stageId}: ${s.detail}`).join(" ")} Fingertip geometry and individual-panel clamps are explicit proxies; physical grip and force validation remain separate.`);
  if (report.checks.geometry.status === "pass") {
    for (const seed of [0, 17, 53]) {
      budget();
      const { settled, ...result } = await releaseCandidate(
        replica.build,
        seed,
        deadline,
      );
      const settledProjections = observations
        .filter((o) => o.stageId.endsWith("final") || o.stageId === "final")
        .flatMap((o) => {
          const fitted = report.projections.find((p) => p.id === o.id);
          // No original camera means no settled comparison; never refit after release.
          return fitted?.camera
            ? [compareObservation(settled, o, fitted.camera)]
            : [];
        });
      report.releases.push({ ...result, settledProjections });
    }
    report.checks.release = check(
      report.releases.every((r) => r.status === "pass") ? "pass" : "fail",
      report.releases
        .map(
          (r) =>
            `seed ${r.seed}: ${r.status}, peak ${r.peakDisplacement.toFixed(3)} in, table ${r.peakGroundPenetration.toFixed(3)} in, linear ${r.linearSpeed.toFixed(3)} in/s, angular ${r.angularSpeed.toFixed(3)} rad/s, ${r.settledSteps}/90 rest steps`,
        )
        .join("; ") +
        ". Settled geometry uses the original fitted camera; it is not re-aligned to hide movement.",
    );
    const settled = report.releases.flatMap((r) => r.settledProjections);
    report.checks.settledShape = check(
      settled.some((p) => p.status === "fail") ? "fail" : "unverified",
      `${settled.length} settled point comparisons. ${settled.length ? "Original camera held fixed. Sparse passing landmarks do not cover the full settled shape." : "No source projections cover the final shape; displacement alone cannot certify fidelity."}`,
    );
  } else
    report.checks.release = check(
      "unverified",
      "Final release blocked by invalid geometry; see the independent stage fixtures.",
    );
  if (replica.route) {
    budget();
    if (report.checks.geometry.status === "pass")
      report.carTrials = await testCars(
        replica.build,
        replica.route.lanes,
        replica.route.brief,
      );
    report.checks.function = check(
      report.carTrials.length && report.carTrials.every((t) => t.passed)
        ? "pass"
        : report.carTrials.length
          ? "fail"
          : "unverified",
      replica.route.evidence +
        " " +
        (report.carTrials.length
          ? report.carTrials.map((t) => t.reason).join("; ")
          : "Passive four-wheel car trial blocked by invalid source candidate geometry. A straight ball test is not substituted."),
    );
  } else
    report.checks.function = check(
      "unverified",
      replica.id === "jet"
        ? "Not applicable to the static aircraft; no flight claim."
        : "Source vehicle path has not been reconstructed and tested.",
    );
  return report;
}
