import { PALETTE_NAMES, type PaletteName, type ProfileOverrides } from "./prompt";
import type { BuildFamily, PromptProfile } from "./types";

/**
 * Optional LLM prompt-parameter mapper.
 *
 * VISION.md rule 2 ("No LLM geometry") allows a language model to do exactly one thing in
 * this pipeline: map free text to DISCRETE template parameters, with the deterministic
 * keyword classifier as the fallback. This module never produces coordinates, tiles, or
 * geometry of any kind -- only enum values that are strictly validated against allow-lists
 * before use. It activates only when ANTHROPIC_API_KEY is present, fails closed (returns
 * null) on any error or timeout, and is never exercised by the test suite without a key.
 */

const FAMILIES: BuildFamily[] = [
  "castle",
  "house",
  "tower",
  "bridge",
  "rocket",
  "animal",
  "aircraft",
  "ramp"
];

const SIZES: Array<PromptProfile["size"]> = ["small", "medium", "tall", "wide"];

const ACCENTS = [
  "rainbow colors",
  "wide door",
  "crown roof",
  "tail and back spikes",
  "shell and antenna",
  "ears and tail",
  "drive-through arch",
  "nose cone and fins"
];

const REQUEST_TIMEOUT_MS = 4000;

export interface LlmProfileOverrides extends ProfileOverrides {
  accent?: string;
}

export async function llmProfileOverrides(prompt: string): Promise<LlmProfileOverrides | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ maxRetries: 0 });

    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 256,
        system:
          "You map a free-text magnetic-tile build request to discrete template parameters. " +
          "You never invent geometry; you only choose the closest enum values. " +
          "Pick the family that best matches what the user wants to build, the size they imply, " +
          "the palette mood that fits, and an optional accent if one clearly applies.",
        messages: [{ role: "user", content: prompt.slice(0, 500) }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                family: { type: "string", enum: FAMILIES },
                size: { type: "string", enum: SIZES },
                palette: { type: "string", enum: PALETTE_NAMES },
                accent: { type: "string", enum: [...ACCENTS, "none"] }
              },
              required: ["family", "size", "palette", "accent"],
              additionalProperties: false
            }
          }
        }
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const text = response.content.find((block) => block.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as {
      family?: unknown;
      size?: unknown;
      palette?: unknown;
      accent?: unknown;
    };

    // Strict allow-list validation: anything outside the enums is dropped, so a
    // misbehaving model can never inject geometry or arbitrary values.
    const overrides: LlmProfileOverrides = {};
    if (FAMILIES.includes(parsed.family as BuildFamily)) {
      overrides.family = parsed.family as BuildFamily;
    }
    if (SIZES.includes(parsed.size as PromptProfile["size"])) {
      overrides.size = parsed.size as PromptProfile["size"];
    }
    if (PALETTE_NAMES.includes(parsed.palette as PaletteName)) {
      overrides.paletteName = parsed.palette as PaletteName;
    }
    if (typeof parsed.accent === "string" && ACCENTS.includes(parsed.accent)) {
      overrides.accent = parsed.accent;
    }

    return Object.keys(overrides).length > 0 ? overrides : null;
  } catch {
    // Fail closed: the deterministic classifier is the source of truth.
    return null;
  }
}
