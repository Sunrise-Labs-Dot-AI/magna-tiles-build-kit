import { describe, expect, it } from "vitest";
import { gateBuild } from "@/lib/engine";
import { generateGatedBuild, MAX_GATE_ATTEMPTS } from "@/lib/magnetic-tiles/generate";
import { classifyPrompt } from "@/lib/magnetic-tiles/prompt";
import type { BuildFamily } from "@/lib/magnetic-tiles/types";

interface CorpusPrompt {
  id: string;
  prompt: string;
  expectedFamily: BuildFamily;
}

/**
 * Pillar A acceptance corpus (VISION.md): a fixed corpus of >=20 varied prompts must all
 * yield gate-valid builds. Every build the generator presents as buildable has to pass the
 * REAL physics gate (overlap pre-filter + magnetic-join validity + Rapier stand test +
 * roll test for ramps) -- not just the advisory validateBuild proxy. The gate is re-run
 * here on the exact returned build so the pipeline cannot vouch for itself.
 *
 * These tests run with the deterministic classifier only (no ANTHROPIC_API_KEY needed);
 * the optional LLM parameter mapper is explicitly disabled.
 */
export const PROMPT_CORPUS: CorpusPrompt[] = [
  // castle family
  { id: "castle-plain", prompt: "a castle", expectedFamily: "castle" },
  { id: "castle-tall-rainbow", prompt: "a tall rainbow castle", expectedFamily: "castle" },
  { id: "castle-princess-odd", prompt: "PRINCESS PALACE!!!", expectedFamily: "castle" },
  { id: "castle-fort", prompt: "a fort for knights", expectedFamily: "castle" },

  // house family
  { id: "house-plain", prompt: "a house", expectedFamily: "house" },
  { id: "house-small-cabin", prompt: "a cozy little cabin", expectedFamily: "house" },
  { id: "house-garage", prompt: "a garage", expectedFamily: "house" },
  { id: "house-red-roof", prompt: "a house with a red roof", expectedFamily: "house" },

  // tower family
  { id: "tower-plain", prompt: "a tower", expectedFamily: "tower" },
  { id: "tower-skyscraper", prompt: "a giant skyscraper", expectedFamily: "tower" },
  { id: "tower-lighthouse", prompt: "lighthouse", expectedFamily: "tower" },
  { id: "tower-two", prompt: "two towers", expectedFamily: "tower" },

  // bridge family
  { id: "bridge-cars", prompt: "a bridge for toy cars", expectedFamily: "bridge" },
  { id: "bridge-arch", prompt: "a long arch bridge", expectedFamily: "bridge" },

  // rocket family
  { id: "rocket-ship", prompt: "a rocket ship", expectedFamily: "rocket" },
  { id: "rocket-spaceship", prompt: "a spaceship to the moon", expectedFamily: "rocket" },

  // animal family
  { id: "animal-dog", prompt: "a small dog", expectedFamily: "animal" },
  { id: "animal-dinosaur", prompt: "a dinosaur", expectedFamily: "animal" },
  { id: "animal-snail", prompt: "a snail", expectedFamily: "animal" },

  // aircraft family
  { id: "aircraft-jet", prompt: "a jet aircraft", expectedFamily: "aircraft" },
  { id: "aircraft-airplane", prompt: "fast airplane with wings", expectedFamily: "aircraft" },

  // ramp family (all three size tiers, so the roll test runs on each)
  { id: "ramp-small", prompt: "small car ramp", expectedFamily: "ramp" },
  { id: "ramp-medium", prompt: "a ramp for toy cars", expectedFamily: "ramp" },
  { id: "ramp-large", prompt: "a big ramp", expectedFamily: "ramp" },

  // odd phrasings and defaults
  { id: "default-empty", prompt: "", expectedFamily: "house" },
  { id: "default-no-keywords", prompt: "somethin fun for a four year old", expectedFamily: "house" },
  { id: "odd-whitespace", prompt: "   a   TOWER   ", expectedFamily: "tower" }
];

describe("prompt corpus passes the full physics gate", () => {
  it("covers all 8 build families with at least 20 prompts", () => {
    const families = new Set(PROMPT_CORPUS.map((entry) => entry.expectedFamily));
    expect(PROMPT_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(families).toEqual(
      new Set(["castle", "house", "tower", "bridge", "rocket", "animal", "aircraft", "ramp"])
    );
  });

  it.each(PROMPT_CORPUS)(
    "$id ('$prompt') yields a gate-valid build",
    async ({ prompt, expectedFamily }) => {
      const result = await generateGatedBuild(prompt, "classic-100", { disableLlm: true });

      expect(result.status, result.status === "failed" ? result.message : "").toBe("ok");
      if (result.status !== "ok") return;

      expect(result.build.family).toBe(expectedFamily);
      expect(result.build.tiles.length).toBeGreaterThan(0);
      expect(result.instructions.length).toBeGreaterThan(0);
      expect(result.gate.passed).toBe(true);
      expect(result.attempts.length).toBeLessThanOrEqual(MAX_GATE_ATTEMPTS);

      // The build must fit the Classic-100 inventory (no negative remainder).
      for (const remaining of Object.values(result.validation.remainingInventory)) {
        expect(remaining).toBeGreaterThanOrEqual(0);
      }

      // Re-run the REAL gate on the exact returned build: the pipeline's own verdict
      // is not trusted.
      const verdict = await gateBuild(result.build);
      expect(verdict, `gate failed: ${verdict.reasons.join(" | ")}`).toMatchObject({
        passed: true
      });
    },
    30000
  );
});

describe("deterministic prompt enrichment", () => {
  it("parses counts for tower compositions", () => {
    expect(classifyPrompt("two towers").count).toBe(2);
    expect(classifyPrompt("three towers").count).toBe(3);
    expect(classifyPrompt("twin towers").count).toBe(2);
    expect(classifyPrompt("a tower").count).toBe(1);
    // counts clamp to the supported range
    expect(classifyPrompt("five towers").count).toBe(3);
    // counts only apply where templates support them
    expect(classifyPrompt("two castles and a castle").count).toBe(1);
  });

  it("parses explicit part colors", () => {
    const profile = classifyPrompt("a house with a red roof");
    expect(profile.partColors).toEqual([{ part: "roof", color: "#ef476f", colorName: "red" }]);
  });

  it("applies part colors to matching tiles only", async () => {
    const result = await generateGatedBuild("a house with a red roof", "classic-100", {
      disableLlm: true
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const roofTiles = result.build.tiles.filter((tile) => /roof|gable/i.test(tile.role));
    expect(roofTiles.length).toBeGreaterThan(0);
    expect(roofTiles.every((tile) => tile.color === "#ef476f")).toBe(true);
  });

  it("uses a standalone color as the dominant palette color", () => {
    const profile = classifyPrompt("a blue castle");
    expect(profile.dominantColor).toBe("#118ab2");
    expect(profile.palette[0]).toBe("#118ab2");
  });

  it("composes two connected towers for 'two towers'", async () => {
    const result = await generateGatedBuild("two towers", "classic-100", { disableLlm: true });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.build.title).toBe("Twin Towers");
    const shafts = new Set(
      result.build.tiles
        .map((tile) => tile.id.match(/^tower-(\d)-shaft/)?.[1])
        .filter(Boolean)
    );
    expect(shafts).toEqual(new Set(["1", "2"]));
    // physically linked: link wall tiles exist
    expect(result.build.tiles.some((tile) => tile.id.startsWith("tower-link-"))).toBe(true);
  });
});

describe("honest failure", () => {
  it("returns a structured failure instead of shipping a non-standing build", async () => {
    // Inject a known non-standing template: the recipe-compiled medium ramp passes the
    // overlap and magnetic pre-filters but fails the Rapier stand test (this is the very
    // build the draft-replay templates replaced). The repair ladder must exhaust its
    // bounded attempts and report a structured failure, never a "buildable" result.
    const { compileBuildRecipe } = await import("@/lib/magnetic-tiles/recipe-compiler");
    const { MEDIUM_CAR_RAMP_RECIPE } = await import("@/lib/magnetic-tiles/recipes/small-car-ramp");
    const compiled = compileBuildRecipe(MEDIUM_CAR_RAMP_RECIPE);

    const result = await generateGatedBuild("a ramp", "classic-100", {
      disableLlm: true,
      templateFor: (prompt, profile) => ({
        id: "non-standing-fixture",
        prompt,
        title: profile.title,
        family: profile.family,
        seed: profile.seed,
        summary: "An intentionally non-standing fixture.",
        tiles: compiled.tiles,
        connections: compiled.connections,
        bounds: { width: 24, height: 12, depth: 4 }
      })
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;

    expect(result.message).toMatch(/could not produce a gate-valid build/i);
    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.attempts.length).toBeLessThanOrEqual(MAX_GATE_ATTEMPTS);
    expect(result.attempts.every((attempt) => attempt.passed === false)).toBe(true);
    expect(result.attempts[0].reasons.length).toBeGreaterThan(0);
    // an honest failure carries no build payload presented as buildable
    expect("build" in result).toBe(false);
  }, 60000);
});
