import { mkdir, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { judgeBuild, type VisualJudgeResult } from "@/lib/verification/visual-judge";

const ROOT = process.cwd();
const TEMP_ROOT = join(ROOT, ".tmp-visual-judge-test");

// Owned fixture used as a stand-in reference photo. The real reference frames are
// extracted from a third-party YouTube build video and are NOT redistributed in this
// public archive (see ATTRIBUTION in the README), so these tests seed a temporary
// project root from an image we own. The judge HTTP call is mocked, so pixel content
// is irrelevant to what is under test: the structured judge path and the contract that
// at least the reference photo plus one render are sent to the model.
const OWNED_FIXTURE = join(ROOT, "tests", "fixtures", "visual-judge", "small-car-ramp-known-bad.png");

const APPROVED_SMALL_RAMP: VisualJudgeResult = {
  verdict: "match",
  score: 94,
  differences: [],
  summary: "The rendered ramp matches the approved reference structure."
};

const REJECTED_SMALL_RAMP: VisualJudgeResult = {
  verdict: "revise",
  score: 52,
  differences: [
    {
      part: "landing support",
      observed: "The rendered support uses a boxy extra wall arrangement.",
      expected: "The support should be a compact red landing with green right-triangle bracing.",
      suggestedFix: "Remove the extra wall and attach the red support to the right-triangle leg."
    }
  ],
  summary: "The rejected render does not match the final approved small-ramp structure."
};

afterEach(async () => {
  await rm(TEMP_ROOT, { recursive: true, force: true });
});

describe("visual judge calibration", () => {
  it("fails closed when the model is unavailable", async () => {
    const result = await judgeBuild("small-car-ramp", {
      apiKey: "",
      rootDir: ROOT
    });

    expect(result).toMatchObject({
      verdict: "wrong",
      score: 0,
      summary: "judge unavailable"
    });
  });

  it("reproduces the approved small-ramp label through the structured judge path", async () => {
    const root = await seedJudgeRoot();

    const result = await judgeBuild("small-car-ramp", {
      apiKey: "test-key",
      fetchImpl: mockJudge(APPROVED_SMALL_RAMP),
      rootDir: root
    });

    expect(result.verdict).toBe("match");
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.differences).toEqual([]);
  });

  it("reproduces a known rejected small-ramp label through the structured judge path", async () => {
    const root = await seedJudgeRoot();

    const result = await judgeBuild("small-car-ramp", {
      apiKey: "test-key",
      fetchImpl: mockJudge(REJECTED_SMALL_RAMP),
      rootDir: root
    });

    expect(result.verdict).not.toBe("match");
    expect(result.score).toBeLessThan(90);
    expect(result.differences[0]).toMatchObject({
      part: "landing support"
    });
  });

  // The live-model calibration judged the render against the real third-party reference
  // photo, which is not redistributed in this public archive. Permanently skipped here;
  // restore the frame locally to exercise the live vision model.
  it.skip("reproduces labels with the live vision model", async () => {});
});

function mockJudge(result: VisualJudgeResult): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const content = body.input?.[0]?.content ?? [];
    const imageCount = content.filter((item: { type?: string }) => item.type === "input_image").length;
    expect(imageCount).toBeGreaterThanOrEqual(2);

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify(result)
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  };
}

async function seedJudgeRoot(): Promise<string> {
  await rm(TEMP_ROOT, { recursive: true, force: true });
  await mkdir(join(TEMP_ROOT, "public", "reference-frames", "small-car-ramp"), { recursive: true });
  await mkdir(join(TEMP_ROOT, "verification", "small-car-ramp"), { recursive: true });
  await cp(OWNED_FIXTURE, join(TEMP_ROOT, "public", "reference-frames", "small-car-ramp", "reference.png"));
  await cp(OWNED_FIXTURE, join(TEMP_ROOT, "verification", "small-car-ramp", "final-default.png"));
  return TEMP_ROOT;
}
