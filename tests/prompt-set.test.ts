import { describe, expect, it } from "vitest";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { VERIFICATION_PROMPTS } from "@/verification/prompt-set";

describe("verification prompt set", () => {
  it.each(VERIFICATION_PROMPTS)("$id maps to an in-scope experimental build", ({ prompt, expectedFamily }) => {
    const result = generateBuild(prompt);

    expect(result.build.family).toBe(expectedFamily);
    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.instructions).toHaveLength(Math.max(...result.build.tiles.map((tile) => tile.step)));
    expect(result.instructions.map((step) => step.step)).toEqual(
      Array.from({ length: result.instructions.length }, (_, index) => index + 1)
    );
    expect(result.instructions.flatMap((step) => step.tileIds)).toHaveLength(result.build.tiles.length);
    expect(result.instructions.map((step) => step.title)).not.toContain("Build the next layer");
    expect(result.instructions.map((step) => step.instruction).join(" ")).not.toMatch(/Build the next layer/i);
  });
});
