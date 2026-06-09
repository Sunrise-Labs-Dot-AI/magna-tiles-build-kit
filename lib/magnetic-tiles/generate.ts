import { classifyPrompt } from "./prompt";
import { generateInstructions } from "./instructions";
import { generateTemplate } from "./templates";
import { validateBuild } from "./validation";
import type { GeneratedBuildResponse, InventoryPreset } from "./types";

export function generateBuild(
  prompt: string,
  inventoryPreset: InventoryPreset = "classic-100"
): GeneratedBuildResponse {
  const cleanPrompt = prompt.trim() || "a colorful magnetic tile house";
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
