import {
  addEdgeSnappedTile,
  addRootTile,
  assembleBuildGraph,
  createEmptyDraft
} from "@/lib/builder/operations";
import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import type { TileShape } from "@/lib/magnetic-tiles/types";

type SearchState = {
  draft: AuthoredBuildDraft;
  score: number;
  history: string[];
};

const childShapes: TileShape[] = ["small-square", "equilateral-triangle", "right-triangle"];
const foldAngles = [0, Math.PI / 2, -Math.PI / 2];
const reverses = [false, true];

function scoreDraft(draft: AuthoredBuildDraft): number {
  const graph = assembleBuildGraph(draft, { strict: true });
  const subassemblies = new Set(graph.tiles.map((tile) => tile.subassemblyId ?? ""));
  const widthScore = Math.min(graph.bounds.width / 9, 1);
  const lowProfileScore = 1 - Math.min(Math.abs(graph.bounds.height - 3.2) / 8, 1);
  const coverageScore =
    Number(subassemblies.has("body")) * 0.25 +
    Number(subassemblies.has("wings")) * 0.35 +
    Number(subassemblies.has("nose")) * 0.2;
  const tileCountScore = Math.min(graph.tiles.length / 5, 1) * 0.2;
  return Number((widthScore * 0.35 + lowProfileScore * 0.25 + coverageScore + tileCountScore).toFixed(4));
}

function roleFor(shape: TileShape): { role: string; subassemblyId: string } {
  if (shape === "equilateral-triangle") {
    return { role: "toy pointed nose triangle", subassemblyId: "nose" };
  }
  if (shape === "right-triangle") {
    return { role: "toy low wing triangle", subassemblyId: "wings" };
  }
  return { role: "toy fuselage body square", subassemblyId: "body" };
}

function expand(state: SearchState): { kept: SearchState[]; pruned: number } {
  const kept: SearchState[] = [];
  let pruned = 0;

  for (const parent of state.draft.tiles) {
    for (let parentEdge = 0; parentEdge < TILE_SPECS[parent.shape].maxEdges; parentEdge += 1) {
      for (const childShape of childShapes) {
        for (let childEdge = 0; childEdge < TILE_SPECS[childShape].maxEdges; childEdge += 1) {
          for (const foldAngle of foldAngles) {
            for (const reverse of reverses) {
              const metadata = roleFor(childShape);
              const next = addEdgeSnappedTile(state.draft, {
                parentTileId: parent.id,
                parentEdge,
                childShape,
                childEdge,
                foldAngle,
                reverse,
                role: metadata.role,
                subassemblyId: metadata.subassemblyId,
                step: state.draft.tiles.length + 1
              });

              if (next.tiles.length === state.draft.tiles.length) {
                pruned += 1;
                continue;
              }

              try {
                assembleBuildGraph(next, { strict: true });
              } catch {
                pruned += 1;
                continue;
              }

              kept.push({
                draft: next,
                score: scoreDraft(next),
                history: [
                  ...state.history,
                  `${parent.id}:e${parentEdge}->${childShape}:e${childEdge}@${foldAngle.toFixed(2)}${reverse ? ":rev" : ""}`
                ]
              });
            }
          }
        }
      }
    }
  }

  return { kept, pruned };
}

function run(): void {
  const root = addRootTile(createEmptyDraft("search assembler toy"), {
    shape: "small-square",
    role: "toy fuselage body square",
    subassemblyId: "body"
  });
  let beam: SearchState[] = [{ draft: root, score: scoreDraft(root), history: ["root small-square"] }];
  let expanded = 0;
  let pruned = 0;

  for (let depth = 0; depth < 3; depth += 1) {
    const candidates: SearchState[] = [];
    for (const state of beam) {
      const result = expand(state);
      expanded += 1;
      pruned += result.pruned;
      candidates.push(...result.kept);
    }
    const seen = new Set<string>();
    beam = candidates
      .sort((first, second) => second.score - first.score)
      .filter((candidate) => {
        const graph = assembleBuildGraph(candidate.draft, { strict: true });
        const key = `${graph.tiles.length}:${graph.bounds.width}:${graph.bounds.height}:${graph.bounds.depth}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }

  const best = beam[0];
  const graph = assembleBuildGraph(best.draft, { strict: true });
  console.log(`expanded=${expanded} pruned=${pruned} beam=${beam.length}`);
  console.log(`bestScore=${best.score} tiles=${graph.tiles.length}`);
  console.log(`bounds=${graph.bounds.width}w x ${graph.bounds.height}h x ${graph.bounds.depth}d`);
  console.log(`subassemblies=${Array.from(new Set(graph.tiles.map((tile) => tile.subassemblyId))).join(",")}`);
  console.log(`history=${best.history.join(" | ")}`);
}

run();
