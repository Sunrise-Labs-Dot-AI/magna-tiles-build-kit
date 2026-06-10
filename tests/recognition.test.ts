import { describe, expect, it } from "vitest";
import { readBuildDraft } from "@/lib/builder/storage";
import { draftToBuildGraph } from "@/lib/builder/operations";
import { box, type TileMacro } from "@/lib/magnetic-tiles/macros";
import type { AuthoredBuildDraft, BuilderTile } from "@/lib/builder/types";
import type { MagneticConnection } from "@/lib/magnetic-tiles/types";
import { scoreRecognition } from "@/lib/recognition/score";
import { JET_RECOGNITION_TARGET } from "@/lib/recognition/targets";

function macroToDraft(macro: TileMacro, id: string): AuthoredBuildDraft {
  const now = "2026-06-03T00:00:00.000Z";
  return {
    id,
    title: id,
    prompt: id,
    family: "aircraft",
    inventoryPreset: "classic-100",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    referenceFrameSrcs: [],
    visualSignoff: false,
    tiles: macro.tiles.map((tile): BuilderTile => ({ ...tile, authoredMode: "edge-snap", confirmed: true })),
    connections: macro.connections as MagneticConnection[]
  };
}

describe("recognizability scorer", () => {
  it("ranks a complete jet above a bare fuselage tube", async () => {
    const jetGraph = draftToBuildGraph(await readBuildDraft("jet-aircraft"));
    const tube = box({
      id: "fuselage",
      width: 4,
      height: 1,
      depth: 1,
      openFaces: ["left", "right"],
      subassemblyId: "body"
    });
    const tubeGraph = draftToBuildGraph(macroToDraft(tube, "tube-only"));

    const jet = scoreRecognition(jetGraph, JET_RECOGNITION_TARGET);
    const tubeOnly = scoreRecognition(tubeGraph, JET_RECOGNITION_TARGET);

    // The keystone property: the scorer must reward the recognizable build over the boxy impostor.
    expect(jet.total).toBeGreaterThan(tubeOnly.total);
    expect(jet.subassemblyCoverage).toBeGreaterThan(tubeOnly.subassemblyCoverage);
    expect(jet.passedSilhouetteRules.length).toBeGreaterThan(tubeOnly.passedSilhouetteRules.length);
  });

  it("produces bounded 0..1 scores", async () => {
    const jetGraph = draftToBuildGraph(await readBuildDraft("jet-aircraft"));
    const jet = scoreRecognition(jetGraph, JET_RECOGNITION_TARGET);
    for (const value of [
      jet.total,
      jet.subassemblyCoverage,
      jet.roleCoverage,
      jet.foldCoverage,
      jet.silhouette,
      jet.connectivity
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("zeroes the score for a build with raw overlaps (not a physical build)", () => {
    const tube = box({ id: "fuselage", width: 4, height: 1, depth: 1, openFaces: ["left", "right"], subassemblyId: "body" });
    const draft = macroToDraft(tube, "overlap-case");
    // Duplicate a tile in place to force a raw overlap.
    draft.tiles.push({ ...draft.tiles[0], id: "overlap-dupe" });
    const graph = draftToBuildGraph(draft);
    const score = scoreRecognition(graph, JET_RECOGNITION_TARGET);
    expect(score.overlapFree).toBe(false);
    expect(score.total).toBe(0);
  });
});
