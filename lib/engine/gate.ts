import { validateEngineInput } from "./input";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import {
  normalizeBuild,
  validateMagneticBuild,
  type EngineBuild,
} from "./build";
import { findRawOverlaps, RAW_OVERLAP_TOLERANCE } from "./overlap";
import { isFunctionalRamp } from "./physics-model";
import { rollTest, simulate } from "./simulate";

export interface GateBuildResult {
  passed: boolean;
  reasons: string[];
}

export async function gateBuild(
  input: EngineBuild | BuildGraph,
  options: { unlimitedPieces?: boolean; deadline?: number } = {},
): Promise<GateBuildResult> {
  const inputErrors = validateEngineInput(input);
  if (inputErrors.length) return { passed: false, reasons: inputErrors };
  const build = normalizeBuild(input);
  const reasons: string[] = [];
  if (isBuildGraph(input) && !options.unlimitedPieces) {
    const inventoryErrors = validateBuild(input).issues.filter(
      (issue) => issue.code === "inventory-overrun",
    );
    if (inventoryErrors.length)
      return {
        passed: false,
        reasons: inventoryErrors.map((issue) => issue.detail),
      };
  }

  const rawOverlaps = findRawOverlaps(build.tiles);
  if (rawOverlaps.length > 0) {
    reasons.push(
      `pre-filter failed: ${rawOverlaps.length} raw tile overlap(s) exceed ${RAW_OVERLAP_TOLERANCE}`,
    );
    reasons.push(
      ...rawOverlaps
        .slice(0, 8)
        .map(
          (overlap) =>
            `raw-overlap:${overlap.firstTileId}<->${overlap.secondTileId}:${overlap.penetration}`,
        ),
    );
  } else {
    reasons.push("pre-filter passed: no raw tile overlaps");
  }

  const magnetic = validateMagneticBuild(build);
  if (magnetic.rejectedReasons.length > 0) {
    reasons.push(
      `pre-filter failed: ${magnetic.rejectedReasons.length} invalid magnetic connection/support issue(s)`,
    );
    reasons.push(...magnetic.rejectedReasons.slice(0, 12));
  } else {
    reasons.push(
      `pre-filter passed: ${magnetic.validConnections.length} valid magnetic joint(s)`,
    );
  }

  if (rawOverlaps.length > 0 || magnetic.rejectedReasons.length > 0) {
    return { passed: false, reasons };
  }

  if (isBuildGraph(input)) {
    const proxyValidation = validateBuild(input);
    if (proxyValidation.status !== "pass") {
      reasons.push(`advisory validateBuild status: ${proxyValidation.status}`);
    }
  }

  const simulation = await simulate(build, options);
  if (!simulation.stands) {
    return {
      passed: false,
      reasons: [
        ...reasons,
        `engine failed: build does not stand (peak displacement ${simulation.maxDisplacement.toFixed(3)} in; table penetration ${simulation.peakGroundPenetration.toFixed(3)} in; ${simulation.settledSteps}/90 rest steps)`,
        ...simulation.poppedJoints
          .slice(0, 12)
          .map((joint) => `popped-joint:${joint}`),
      ],
    };
  }
  reasons.push(
    `engine passed: build stands (peak displacement ${simulation.maxDisplacement.toFixed(3)} in; table penetration ${simulation.peakGroundPenetration.toFixed(3)} in; ${simulation.settledSteps} rest steps)`,
  );

  if (isFunctionalRamp(build)) {
    const roll = await rollTest(build);
    if (!roll.reachedBottom || roll.fellOff) {
      return {
        passed: false,
        reasons: [
          ...reasons,
          `engine failed: roll test reachedBottom=${roll.reachedBottom} fellOff=${roll.fellOff}; table penetration ${roll.peakGroundPenetration.toFixed(3)} in`,
        ],
      };
    }
    reasons.push(
      "engine passed: roll test reached the bottom without falling off",
    );
  } else {
    reasons.push(
      "recognizable-object resemblance requires human signoff beyond this engine gate",
    );
  }

  return { passed: true, reasons };
}

function isBuildGraph(input: EngineBuild | BuildGraph): input is BuildGraph {
  return "prompt" in input && "bounds" in input;
}
