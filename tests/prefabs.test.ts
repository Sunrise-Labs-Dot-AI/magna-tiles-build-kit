import { describe, expect, it } from "vitest";
import { createEmptyDraft, draftToBuildGraph } from "@/lib/builder/operations";
import {
  PREFAB_ORDER,
  PREFAB_SPECS,
  placePrefabOnEdge,
  placePrefabOnGround,
  prefabGhostOnGround
} from "@/lib/builder/prefabs";
import { gateBuild } from "@/lib/engine";
import { findRawOverlaps } from "@/lib/engine/overlap";

describe("prefabs", () => {
  it.each(PREFAB_ORDER)("%s places on open ground as a gate-valid island", async (prefabId) => {
    const result = placePrefabOnGround(createEmptyDraft(`prefab-${prefabId}`), prefabId, { x: 0, z: 0 }, "#118ab2");
    expect(result.placedTileIds.length).toBeGreaterThan(0);
    expect(findRawOverlaps(result.draft.tiles)).toHaveLength(0);
    // Every prefab tile has coherent lineage for subtree selection/deletion.
    for (const id of result.placedTileIds) {
      const tile = result.draft.tiles.find((candidate) => candidate.id === id)!;
      expect(Boolean(tile.root) || Boolean(tile.parentTileId)).toBe(true);
    }
    const verdict = await gateBuild(draftToBuildGraph(result.draft));
    expect(verdict.passed).toBe(true);
  }, 60_000);

  it("the open cube is the user's example: exactly 4 small squares on edges", () => {
    const result = placePrefabOnGround(createEmptyDraft("open-cube-shape"), "open-cube", { x: 0, z: 0 }, "#118ab2");
    expect(result.placedTileIds).toHaveLength(4);
    const tiles = result.draft.tiles;
    expect(tiles.every((tile) => tile.shape === "small-square")).toBe(true);
    // All four are standing on edges (vertical planes: normals horizontal).
    expect(tiles.every((tile) => Math.abs(tile.basis!.zAxis.y) < 0.001)).toBe(true);
  });

  it("stacks a second tower module on the first one's top edge, and the stack passes the gate", async () => {
    const first = placePrefabOnGround(createEmptyDraft("tower-stack"), "tower-module", { x: 0, z: 0 }, "#118ab2");
    expect(first.placedTileIds.length).toBeGreaterThan(0);
    const lowerFront = first.placedTileIds.find((id) => id.includes("front"))!;

    // The top edge of the lower front wall (edge 2) is a valid snap target.
    const second = placePrefabOnEdge(first.draft, "tower-module", { tileId: lowerFront, edge: 2 }, "#ffb703");
    expect(second.placedTileIds.length).toBe(4);
    expect(findRawOverlaps(second.draft.tiles)).toHaveLength(0);

    // The upper module is attached to the lower one (anchor lineage + connections).
    const anchorTile = second.draft.tiles.find((tile) => tile.id === second.placedTileIds[0])!;
    expect(anchorTile.parentTileId).toBe(lowerFront);
    const crossConnections = second.draft.connections.filter(
      (connection) =>
        (second.placedTileIds.includes(connection.fromTileId) && first.placedTileIds.includes(connection.toTileId)) ||
        (second.placedTileIds.includes(connection.toTileId) && first.placedTileIds.includes(connection.fromTileId))
    );
    expect(crossConnections.length).toBeGreaterThanOrEqual(2);

    // And the whole 2-high tower passes the engine gate.
    const verdict = await gateBuild(draftToBuildGraph(second.draft));
    expect(verdict.passed).toBe(true);
  }, 60_000);

  it("refuses all-or-nothing when the prefab would overlap an existing structure", () => {
    const first = placePrefabOnGround(createEmptyDraft("prefab-collision"), "closed-box", { x: 0, z: 0 }, "#118ab2");
    const before = first.draft.tiles.length;
    const ghost = prefabGhostOnGround(first.draft, "open-cube", { x: 0, z: 0 }, "#ffb703");
    expect(ghost.valid).toBe(false);
    const blocked = placePrefabOnGround(first.draft, "open-cube", { x: 0, z: 0 }, "#ffb703");
    expect(blocked.placedTileIds).toHaveLength(0);
    expect(blocked.draft.tiles).toHaveLength(before);
    expect(blocked.reason).toBeTruthy();
  });

  it("declares every prefab in the hotbar order with labels", () => {
    expect(PREFAB_ORDER).toHaveLength(5);
    for (const id of PREFAB_ORDER) {
      expect(PREFAB_SPECS[id].label.length).toBeGreaterThan(0);
    }
  });
});
