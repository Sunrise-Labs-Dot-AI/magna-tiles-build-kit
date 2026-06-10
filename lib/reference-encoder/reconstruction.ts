/**
 * From timeline to build: deterministic readiness rules for an accepted
 * reconstruction, and the hard gate that decides whether the app may call it
 * buildable.
 *
 * The rules here are honest-failure rules from VISION.md: a reconstruction is
 * never "buildable" while any measured step is still flagged for human review,
 * and the assembled build must pass gateBuild (the engine gate is law — it is
 * never widened here).
 */
import { assembleBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { gateBuild, type GateBuildResult } from "@/lib/engine/gate";
import { RawOverlapError } from "@/lib/engine/overlap";
import type { ReferenceBuildEncoding } from "./types";

const ATTACH_ACTIONS = new Set(["place", "connect", "build-subassembly"]);

export interface ReconstructionReadiness {
  ready: boolean;
  blockers: string[];
}

export interface ReconstructionGateResult {
  /** True only when readiness passed AND gateBuild passed. */
  buildable: boolean;
  readiness: ReconstructionReadiness;
  /** Null when the build could not even be assembled (raw overlap). */
  gate: GateBuildResult | null;
  reasons: string[];
}

/**
 * Deterministic pre-gate checks on the reviewed timeline itself.
 * These never call a model and never inspect pixels — they only verify the
 * human review actually happened.
 */
export function reconstructionReadiness(
  encoding: ReferenceBuildEncoding
): ReconstructionReadiness {
  const blockers: string[] = [];

  if (!encoding.steps.length) {
    blockers.push("The timeline has no steps; nothing to reconstruct.");
  }

  const unreviewed = encoding.steps.filter(
    (step) => step.measured?.needsHumanReview && !step.measured.humanAccepted
  );
  if (unreviewed.length) {
    blockers.push(
      `${unreviewed.length} measured step(s) are still flagged "needs human review": ${unreviewed
        .map((step) => step.id)
        .join(", ")}. Review each one against its frame evidence first.`
    );
  }

  const hasAttach = encoding.steps.some((step) => ATTACH_ACTIONS.has(step.action));
  if (encoding.steps.length && !hasAttach) {
    blockers.push(
      "No step maps to an attach action (place / connect / build-subassembly), so the timeline cannot produce a build."
    );
  }

  const missingTimestamps = encoding.steps.filter((step) => !step.timestamp.trim());
  if (missingTimestamps.length) {
    blockers.push(
      `${missingTimestamps.length} step(s) have no timestamp, so they cannot be traced back to the video.`
    );
  }

  return { ready: blockers.length === 0, blockers };
}

/**
 * Gate an accepted reconstruction: the timeline must be review-complete and
 * the build authored from it must pass the engine gate. Anything less is an
 * honest failure, never a silent guess.
 */
export async function gateReconstruction(
  draft: AuthoredBuildDraft,
  encoding: ReferenceBuildEncoding
): Promise<ReconstructionGateResult> {
  const readiness = reconstructionReadiness(encoding);
  const reasons: string[] = [...readiness.blockers];

  let gate: GateBuildResult | null = null;
  try {
    const build = assembleBuildGraph(draft, { strict: true });
    gate = await gateBuild(build);
    reasons.push(...gate.reasons);
  } catch (error) {
    if (error instanceof RawOverlapError) {
      reasons.push(`Build assembly refused: ${error.message}`);
    } else {
      reasons.push(
        `Build assembly failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return {
    buildable: readiness.ready && gate !== null && gate.passed,
    readiness,
    gate,
    reasons
  };
}
