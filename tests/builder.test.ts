import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  addEdgeSnappedTile,
  addFreeformTile,
  addRootTile,
  createEmptyDraft,
  createDraftFromGenerated,
  evaluateReviewReadiness,
  mirrorBuilderTiles,
  snapNearestEdge,
  transformFreeformTile
} from "@/lib/builder/operations";
import { listBuildDrafts, readBuildDraft, saveBuildDraft, validateDraftShape } from "@/lib/builder/storage";
import { attachTile, makeAnchorTile } from "@/lib/magnetic-tiles/edge-attachment";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { findMagneticEdgeMatch, tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";

describe("builder operations", () => {
  it("places edge-snapped tiles with the same geometry as attachTile", () => {
    const draft = addRootTile(createDraftFromGenerated(generateBuild("Small Car Ramp")), {
      shape: "small-square",
      position: { x: 20, y: 1.5, z: 0 },
      role: "test parent",
      subassemblyId: "fixture"
    });
    const parent = draft.tiles[draft.tiles.length - 1];
    const next = addEdgeSnappedTile(draft, {
      parentTileId: parent.id,
      parentEdge: 1,
      childShape: "small-square",
      childEdge: 3,
      foldAngle: Math.PI / 2,
      reverse: true,
      color: "#118ab2",
      role: "test child",
      subassemblyId: "fixture",
      step: 1
    });
    const child = next.tiles[next.tiles.length - 1];
    const expected = attachTile(makeAnchorTile(parent.id, parent.shape, parent.position, parent.basis, 1, parent.role), {
      key: child.id,
      shape: "small-square",
      attachTo: parent.id,
      parentEdge: 1,
      childEdge: 3,
      foldAngle: Math.PI / 2,
      reverse: true,
      step: 1,
      role: "test child"
    });

    expect(child.position.x).toBeCloseTo(expected.position.x);
    expect(child.position.y).toBeCloseTo(expected.position.y);
    expect(child.position.z).toBeCloseTo(expected.position.z);
    expect(child.basis?.zAxis.x).toBeCloseTo(expected.basis.zAxis.x);
  });

  it("uses the clicked parent magnet when placing folded edge-snap tiles", () => {
    const draft = addRootTile(createEmptyDraft("magnet alignment fixture"), {
      shape: "large-square",
      position: { x: 0, y: 3, z: 0 },
      role: "large parent",
      subassemblyId: "fixture"
    });
    const parent = draft.tiles[draft.tiles.length - 1];
    const next = addEdgeSnappedTile(draft, {
      parentTileId: parent.id,
      parentEdge: 0,
      parentMagnetT: 0.25,
      childShape: "small-square",
      childEdge: 2,
      foldAngle: Math.PI / 2,
      edgeFit: "auto",
      reverse: false,
      color: "#118ab2",
      role: "folded child",
      subassemblyId: "fixture",
      step: 1
    });
    const child = next.tiles[next.tiles.length - 1];
    const vertices = tileWorldVertices(child);
    const childEdgeCenter = {
      x: (vertices[2].x + vertices[3].x) / 2,
      y: (vertices[2].y + vertices[3].y) / 2,
      z: (vertices[2].z + vertices[3].z) / 2
    };

    expect(childEdgeCenter.x).toBeCloseTo(-1.5);
    expect(childEdgeCenter.y).toBeCloseTo(-0.09);
    expect(childEdgeCenter.z).toBeCloseTo(-0.09);
  });

  it("updates freeform transforms deterministically and marks the tile unconfirmed", () => {
    const draft = addFreeformTile(createDraftFromGenerated(generateBuild("Small Car Ramp")), {
      shape: "right-triangle",
      position: { x: 0, y: 1.5, z: 0 },
      role: "loose test",
      subassemblyId: "fixture"
    });
    const tileId = draft.tiles[draft.tiles.length - 1].id;
    const transformed = transformFreeformTile(draft, tileId, {
      x: 1,
      z: -0.5,
      rx: Math.PI / 12,
      ry: Math.PI / 8
    });
    const tile = transformed.tiles.find((item) => item.id === tileId);

    expect(tile?.position).toMatchObject({ x: 1, y: 1.5, z: -0.5 });
    expect(tile?.rotation.x).toBeCloseTo(Math.PI / 12);
    expect(tile?.rotation.y).toBeCloseTo(Math.PI / 8);
    expect(tile?.confirmed).toBe(false);
  });

  it("snaps a nearby freeform tile onto the nearest magnetic edge", () => {
    const draft = addRootTile(createDraftFromGenerated(generateBuild("Small Car Ramp")), {
      shape: "small-square",
      position: { x: 30, y: 1.5, z: 0 },
      role: "snap parent",
      subassemblyId: "fixture"
    });
    const parent = draft.tiles[draft.tiles.length - 1];
    const loose = addFreeformTile(draft, {
      shape: "small-square",
      position: { x: parent.position.x + 3.05, y: parent.position.y, z: parent.position.z },
      role: "nearby loose panel",
      subassemblyId: "fixture"
    });
    const tileId = loose.tiles[loose.tiles.length - 1].id;
    const snapped = snapNearestEdge(loose, tileId);
    const tile = snapped.tiles.find((item) => item.id === tileId);

    expect(tile?.confirmed).toBe(true);
    expect(tile?.authoredMode).toBe("edge-snap");
    expect(snapped.connections.some((connection) => connection.toTileId === tileId)).toBe(true);
    expect(tile && findMagneticEdgeMatch(parent, tile)).not.toBeNull();
  });

  it("mirrors selected tiles while preserving shape counts", () => {
    const draft = createDraftFromGenerated(generateBuild("Jet Aircraft"));
    const mirrored = mirrorBuilderTiles(draft, [draft.tiles[0].id]);

    expect(mirrored.tiles).toHaveLength(draft.tiles.length + 1);
    expect(mirrored.tiles[mirrored.tiles.length - 1].shape).toBe(draft.tiles[0].shape);
    expect(mirrored.tiles[mirrored.tiles.length - 1].confirmed).toBe(false);
  });

  it("requires confirmed geometry, steps, labels, matching BOM, and visual signoff for review readiness", () => {
    const draft = addFreeformTile(createDraftFromGenerated(generateBuild("Small Car Ramp")), {
      shape: "small-square",
      role: "",
      subassemblyId: ""
    });
    const report = evaluateReviewReadiness(draft);

    expect(report.reviewReady).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("not magnet-confirmed");
    expect(report.blockingReasons.join(" ")).toContain("visual signoff");
  });

  it("keeps generated library prompts as drafts, not shippable by validator alone", () => {
    for (const item of BUILD_LIBRARY) {
      const draft = createDraftFromGenerated(generateBuild(item.prompt), {
        status: "draft",
        visualSignoff: false
      });
      const report = evaluateReviewReadiness(draft);

      expect(report.geometryValid).toBe(true);
      expect(report.reviewReady).toBe(false);
    }
  });
});

describe("builder draft storage", () => {
  it("saves, lists, and reloads local JSON drafts", async () => {
    const root = await mkdtemp(join(tmpdir(), "magnetic-builder-test-"));
    try {
      const draft = createDraftFromGenerated(generateBuild("Small Car Ramp"), { id: "small-ramp-test" });
      const saved = await saveBuildDraft(draft, root);
      const list = await listBuildDrafts(root);
      const loaded = await readBuildDraft("small-ramp-test", root);

      expect(saved.id).toBe("small-ramp-test");
      expect(list.map((item) => item.id)).toContain("small-ramp-test");
      expect(loaded.tiles.length).toBe(draft.tiles.length);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects malformed draft payloads", () => {
    expect(() => validateDraftShape({ id: "", title: "", tiles: null } as never)).toThrow(/required fields/);
  });
});
