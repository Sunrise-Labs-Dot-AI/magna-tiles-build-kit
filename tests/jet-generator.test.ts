import { describe, expect, it } from "vitest";
import { assembleBuildGraph } from "@/lib/builder/operations";
import { gateBuild } from "@/lib/engine";
import { scoreRecognition } from "@/lib/recognition/score";
import { JET_RECOGNITION_TARGET } from "@/lib/recognition/targets";
import { buildJetDraft, SEED } from "@/scripts/generate-jet";

describe("parametric jet generator", () => {
  it("builds a connected, standing, recognizable seed jet", async () => {
    const graph = assembleBuildGraph(buildJetDraft(SEED), { strict: true });
    const gate = await gateBuild(graph);
    const recognition = scoreRecognition(graph, JET_RECOGNITION_TARGET);

    expect(gate.passed, gate.reasons.join("\n")).toBe(true);
    expect(recognition.total).toBeGreaterThanOrEqual(0.6);
  });
});
