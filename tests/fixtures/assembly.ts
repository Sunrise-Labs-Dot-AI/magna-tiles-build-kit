import { transformLocal } from "@/lib/engine/math";
import { assemble } from "@/lib/replication/geometry";
import { edgeGrips } from "@/lib/replication/grip";
import { emptyInventory } from "@/lib/magnetic-tiles/catalog";
import type { Replica } from "@/lib/replication/types";
import { closedShell } from "./closed-shell";

export function assemblyUFixture(): Replica {
  const shell = closedShell(1);
  const ids = ["x-0--1", "z-0--1", "x-0-1"];
  const build = assemble("u-fixture", "Three-sided support", ids.map(id => shell.tiles.find(t => t.id === id)!), "tower");
  const grip = (id: string) => {
    const tile = build.tiles.find(t => t.id === id)!;
    return edgeGrips(tile).sort((a, b) => transformLocal(b.localPoint, tile.position, tile.basis!).y - transformLocal(a.localPoint, tile.position, tile.basis!).y)[0];
  };
  return { id: "u-fixture", sourceId: "fixture", title: "Three-sided support", build,
    bomFrameId: "fixture", inventory: emptyInventory(), uncertainties: [], materialQuestions: [],
    stages: [{ id: "u", frameId: "fixture", title: "U", instruction: "Support the first wall until the other two are joined.", tileIds: ids, support: "released" }],
    construction: [{ stageId: "u", operations: ids.map((id, i) => ({ tileIds: [id], hands: i ? [grip(id), grip(ids[0])] : [grip(id)] })) }] };
}
