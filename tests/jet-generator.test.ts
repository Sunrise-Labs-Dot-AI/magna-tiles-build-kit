import { describe, expect, it } from "vitest";
import { assembleBuildGraph } from "@/lib/builder/operations";
import { gateBuild } from "@/lib/engine";
import { scoreRecognition } from "@/lib/recognition/score";
import { JET_RECOGNITION_TARGET } from "@/lib/recognition/targets";
import { buildJetDraft, SEED } from "@/scripts/generate-jet";

describe("parametric jet generator", () => {
  it("rejects the recognizable seed jet when its wings move too far under inch-scale gravity", async () => {
    const graph = assembleBuildGraph(buildJetDraft(SEED), { strict: true });
    const gate = await gateBuild(graph);
    const recognition = scoreRecognition(graph, JET_RECOGNITION_TARGET);

    expect(gate.passed).toBe(false);
    expect(gate.reasons.join(" ")).toContain("engine failed: build does not stand");
    expect(recognition.total).toBeGreaterThanOrEqual(0.6);
  });
});
