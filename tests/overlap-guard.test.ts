import { describe, expect, it } from "vitest";
import {
  addEdgeSnappedTile,
  addRootTile,
  assembleBuildGraph,
  createEmptyDraft
} from "@/lib/builder/operations";
import { readBuildDraft } from "@/lib/builder/storage";
import { RawOverlapError } from "@/lib/engine";
import { RAW_GEOMETRY_LIBRARY_BUILD_IDS } from "@/verification/engine-valid-builds";

describe("overlap is systematically impossible, not just flagged", () => {
  it("strict assembly throws on a draft whose tiles interpenetrate", () => {
    let draft = createEmptyDraft("overlap fixture");
    draft = addRootTile(draft, { shape: "small-square", position: { x: 0, y: 1.5, z: 0 } });
    draft = addRootTile(draft, { shape: "small-square", position: { x: 0, y: 1.5, z: 0 } });

    expect(() => assembleBuildGraph(draft, { strict: true })).toThrow(RawOverlapError);
  });

  it.each(RAW_GEOMETRY_LIBRARY_BUILD_IDS)(
    "strict assembly accepts engine-valid library build %s",
    async (id) => {
      const draft = await readBuildDraft(id);
      expect(() => assembleBuildGraph(draft, { strict: true })).not.toThrow();
    }
  );

  it("the relational add-path refuses a placement that would interpenetrate an existing tile", () => {
    let draft = createEmptyDraft("snap overlap fixture");
    draft = addRootTile(draft, { shape: "small-square", position: { x: 0, y: 1.5, z: 0 } });
    const rootId = draft.tiles[0].id;

    const snap = {
      parentTileId: rootId,
      parentEdge: 1,
      childShape: "small-square" as const,
      childEdge: 3,
      foldAngle: Math.PI / 2,
      reverse: true
    };
    const once = addEdgeSnappedTile(draft, snap);
    expect(once.tiles).toHaveLength(2);

    // A second identical snap lands in the exact same place as the first child → refused.
    const twice = addEdgeSnappedTile(once, snap);
    expect(twice.tiles).toHaveLength(2);
  });
});
