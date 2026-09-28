import { describe, expect, it } from "vitest";
import { assembleBuildGraph } from "@/lib/builder/operations";
import { gateBuild } from "@/lib/engine";
import { scoreRecognition } from "@/lib/recognition/score";
import { JET_RECOGNITION_TARGET } from "@/lib/recognition/targets";
import { buildJetDraft, SEED } from "@/scripts/generate-jet";

describe("parametric jet generator", () => {
  it("passes the generated seed jet's nominal physics gate with resemblance still separate", async () => {
    const graph = assembleBuildGraph(buildJetDraft(SEED), { strict: true });
    const gate = await gateBuild(graph);
    const recognition = scoreRecognition(graph, JET_RECOGNITION_TARGET);

    expect(graph.tiles).toHaveLength(31); // This is not the 40-piece source replica.
    expect(gate.passed).toBe(true);
    expect(gate.reasons.join(" ")).toContain("64 valid magnetic joint(s)");
    expect(gate.reasons.join(" ")).toContain("engine passed: build stands");
    expect(gate.reasons).toContain("recognizable-object resemblance requires human signoff beyond this engine gate");
    // Generator heuristic only; it supplies no source or assembly acceptance.
    expect(recognition.total).toBeGreaterThanOrEqual(0.6);
  });
});
