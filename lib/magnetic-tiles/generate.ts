import { gateBuild, type GateBuildResult } from "@/lib/engine";
import { generateInstructions } from "./instructions";
import { llmProfileOverrides } from "./llm-profile";
import { classifyPrompt, reviseProfile } from "./prompt";
import { generateTemplate } from "./templates";
import { validateBuild } from "./validation";
import type {
  BuildFamily,
  BuildGraph,
  GeneratedBuildResponse,
  InventoryPreset,
  PromptProfile
} from "./types";

const DEFAULT_PROMPT = "a colorful magnetic tile house";

/** Hard cap on deterministic repair attempts before declaring honest failure. */
export const MAX_GATE_ATTEMPTS = 4;

/**
 * Ungated draft generation (template + advisory validation + instructions). This is the
 * legacy synchronous path used by the builder workbench seed flow and tests; the product
 * path for "prompt -> buildable plan" is generateGatedBuild, which runs the REAL physics
 * gate and never presents a non-gate-valid build as buildable.
 */
export function generateBuild(
  prompt: string,
  inventoryPreset: InventoryPreset = "classic-100"
): GeneratedBuildResponse {
  const cleanPrompt = prompt.trim() || DEFAULT_PROMPT;
  const profile = classifyPrompt(cleanPrompt);
  const build = {
    ...generateTemplate(cleanPrompt, profile),
    inventoryPreset
  };
  const validation = validateBuild(build);
  const instructions = generateInstructions(build);

  return {
    build,
    validation,
    instructions
  };
}

export interface GenerationAttempt {
  label: string;
  family: BuildFamily;
  size: PromptProfile["size"];
  count: number;
  passed: boolean;
  reasons: string[];
}

export interface GatedBuildSuccess extends GeneratedBuildResponse {
  status: "ok";
  gate: GateBuildResult;
  attempts: GenerationAttempt[];
}

export interface GatedBuildFailure {
  status: "failed";
  prompt: string;
  title: string;
  family: BuildFamily;
  message: string;
  attempts: GenerationAttempt[];
}

export type GatedBuildResult = GatedBuildSuccess | GatedBuildFailure;

export interface GenerateGatedBuildOptions {
  /** Skip classification (and the optional LLM mapper) and use this profile directly. */
  profile?: PromptProfile;
  /** Force the deterministic classifier even when ANTHROPIC_API_KEY is present. */
  disableLlm?: boolean;
  /** Test hook: substitute the template assembler to exercise the repair/failure path. */
  templateFor?: (prompt: string, profile: PromptProfile) => BuildGraph;
}

/**
 * The product path for Pillar A: prompt -> physically-buildable plan.
 *
 * Every candidate build must pass the full physics gate (overlap pre-filter, magnetic
 * join validity, Rapier stand test, roll test for ramps) plus the advisory validator's
 * error tier (inventory, duplicates). A bounded deterministic repair ladder lowers or
 * simplifies the template when a variant fails; if no variant passes within
 * MAX_GATE_ATTEMPTS, the result is a structured honest failure -- never a non-standing
 * build presented as buildable. The gate itself is never weakened.
 */
export async function generateGatedBuild(
  prompt: string,
  inventoryPreset: InventoryPreset = "classic-100",
  options: GenerateGatedBuildOptions = {}
): Promise<GatedBuildResult> {
  const cleanPrompt = prompt.trim() || DEFAULT_PROMPT;
  let profile = options.profile ?? classifyPrompt(cleanPrompt);

  if (!options.profile && !options.disableLlm) {
    // Optional LLM mapping of free text to DISCRETE template parameters only
    // (never geometry). Fails closed to the deterministic classifier.
    const overrides = await llmProfileOverrides(cleanPrompt);
    if (overrides) {
      profile = reviseProfile(cleanPrompt, profile, overrides);
      if (overrides.accent && !profile.accents.includes(overrides.accent)) {
        profile = { ...profile, accents: [...profile.accents, overrides.accent] };
      }
    }
  }

  const templateFor = options.templateFor ?? generateTemplate;
  const attempts: GenerationAttempt[] = [];

  for (const candidate of repairLadder(cleanPrompt, profile)) {
    const build: BuildGraph = {
      ...templateFor(cleanPrompt, candidate.profile),
      inventoryPreset
    };

    const validation = validateBuild(build);
    const validationErrors = validation.issues.filter((issue) => issue.severity === "error");
    if (validationErrors.length > 0) {
      attempts.push({
        label: candidate.label,
        family: candidate.profile.family,
        size: candidate.profile.size,
        count: candidate.profile.count,
        passed: false,
        reasons: validationErrors.map((issue) => `validation error: ${issue.message}`)
      });
      continue;
    }

    const gate = await gateBuild(build);
    attempts.push({
      label: candidate.label,
      family: candidate.profile.family,
      size: candidate.profile.size,
      count: candidate.profile.count,
      passed: gate.passed,
      reasons: gate.reasons
    });

    if (gate.passed) {
      return {
        status: "ok",
        build,
        validation,
        instructions: generateInstructions(build),
        gate,
        attempts
      };
    }
  }

  return {
    status: "failed",
    prompt: cleanPrompt,
    title: profile.title,
    family: profile.family,
    message:
      "Could not produce a gate-valid build for this prompt. Every deterministic template " +
      "variant was rejected by the physics gate, so no build is presented as buildable.",
    attempts
  };
}

interface RepairCandidate {
  label: string;
  profile: PromptProfile;
}

/**
 * Bounded, deterministic repair ladder: primary template first, then progressively
 * simpler variants (drop repeated structures, lower the height tier). Candidates that
 * produce identical geometry are deduplicated so the physics sim never re-runs the same
 * failing build.
 */
function repairLadder(prompt: string, profile: PromptProfile): RepairCandidate[] {
  const ladder: RepairCandidate[] = [{ label: "primary template", profile }];
  const seen = new Set([geometrySignature(profile)]);

  const push = (label: string, next: PromptProfile) => {
    if (ladder.length >= MAX_GATE_ATTEMPTS) return;
    const signature = geometrySignature(next);
    if (seen.has(signature)) return;
    seen.add(signature);
    ladder.push({ label, profile: next });
  };

  if (profile.count > 1) {
    push("repair: reduce to a single structure", reviseProfile(prompt, profile, { count: 1 }));
  }
  if (profile.size !== "medium") {
    push(
      "repair: step down to the medium variant",
      reviseProfile(prompt, profile, { size: "medium", count: 1 })
    );
  }
  push(
    "repair: simplify to the small variant",
    reviseProfile(prompt, profile, { size: "small", count: 1 })
  );

  return ladder;
}

/**
 * Two profiles produce identical geometry unless they differ on a parameter the family's
 * template actually uses (ramp and tower vary by size; tower varies by count).
 */
function geometrySignature(profile: PromptProfile): string {
  const sizeMatters = profile.family === "ramp" || profile.family === "tower";
  const size = sizeMatters ? profile.size : "fixed";
  const count = profile.family === "tower" ? profile.count : 1;
  return `${profile.family}:${size}:${count}`;
}
