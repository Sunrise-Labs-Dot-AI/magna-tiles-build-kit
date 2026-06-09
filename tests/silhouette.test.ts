import { describe, expect, it } from "vitest";
import { readBuildDraft } from "@/lib/builder/storage";
import { draftToBuildGraph } from "@/lib/builder/operations";
import { box, type TileMacro } from "@/lib/magnetic-tiles/macros";
import type { AuthoredBuildDraft, BuilderTile } from "@/lib/builder/types";
import type { MagneticConnection } from "@/lib/magnetic-tiles/types";
import { jetSilhouetteMatch } from "@/lib/recognition/silhouette";
import { combinedScore } from "@/lib/recognition/score";

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

describe("geometric silhouette match (un-gameable recognizability)", () => {
  it("rates a jet's outline above a bare box, and the box has no wing/fin spread head-on", async () => {
    const jet = jetSilhouetteMatch(draftToBuildGraph(await readBuildDraft("jet-aircraft")));
    const tube = box({ id: "fuselage", width: 4, height: 1, depth: 1, openFaces: ["left", "right"], subassemblyId: "body" });
    const boxScore = jetSilhouetteMatch(draftToBuildGraph(macroToDraft(tube, "tube")));

    expect(jet.total).toBeGreaterThan(boxScore.total);
    // Front view is the sharpest discriminator: a plain box shows no wings/fin head-on.
    expect(jet.perView.front).toBeGreaterThan(boxScore.perView.front);
    expect(boxScore.perView.front).toBeLessThan(0.1);
  });

  it("produces bounded 0..1 per-view and total scores", async () => {
    const jet = jetSilhouetteMatch(draftToBuildGraph(await readBuildDraft("jet-aircraft")));
    for (const value of [jet.total, jet.perView.top, jet.perView.side, jet.perView.front]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("combinedScore weights silhouette over structural so the structural term can't dominate alone", () => {
    // A structurally-perfect but visually-poor build (the gamed box) must not score near 1.
    expect(combinedScore(1.0, 0.4)).toBeLessThan(0.75);
    // A build strong on both should score high.
    expect(combinedScore(1.0, 0.9)).toBeGreaterThan(0.9);
  });
});
