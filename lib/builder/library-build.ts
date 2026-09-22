import { gateBuild } from "@/lib/engine/gate";
import { generateStepInstructions } from "@/lib/magnetic-tiles/instructions";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type { GeneratedBuildResponse } from "@/lib/magnetic-tiles/types";
import { draftToBuildGraph } from "./operations";
import { readBuildDraft } from "./storage";

/**
 * Replay a hand-authored build draft as a guided library build.
 *
 * This is the "author once, replay as guided" path. Instead of regenerating geometry from a
 * prompt (which cannot produce recognizable shapes blind), the guided experience loads the
 * stored tiles a human placed and signed off on, validates them with the real (strict) oracle,
 * and derives step-by-step instructions from the actual tiles/steps.
 */
export async function loadAuthoredLibraryBuild(
  id: string,
  root = process.cwd()
): Promise<GeneratedBuildResponse> {
  const draft = await readBuildDraft(id, root);
  const build = draftToBuildGraph(draft);
  const validation = validateBuild(build);
  const instructions = generateStepInstructions(build);
  return { build, validation, instructions, physics: await gateBuild(build) };
}
