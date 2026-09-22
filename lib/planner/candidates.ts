import largeRamp from "@/build-drafts/large-car-ramp.json";
import { draftToBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { buildBounds } from "@/lib/engine/build";
import { add, distance, normalize, scale, subtract } from "@/lib/engine/math";
import {
  switchbackRamp,
  placeMacro,
  composeMacros,
  type TileMacro,
} from "@/lib/magnetic-tiles/macros";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import { hashPrompt } from "@/lib/magnetic-tiles/prompt";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import type { CourseLane, DesignBrief } from "./types";

export interface CourseCandidate {
  build: BuildGraph;
  lanes: CourseLane[];
}

export function courseCandidates(brief: DesignBrief): CourseCandidate[] {
  if (brief.turns === 0) {
    const build = draftToBuildGraph(
      structuredClone(largeRamp) as AuthoredBuildDraft,
    );
    // Build complete, self-standing subassemblies before adding tall rear walls.
    for (const tile of build.tiles)
      tile.step = /wedge|sloped-driving/.test(tile.id)
        ? 1
        : /upper-rear/.test(tile.id)
          ? 3
          : 2;
    build.id = `course-${hashPrompt(brief.prompt)}`;
    build.title =
      brief.lanes === 2 ? "Side-by-side downhill sprint" : "Downhill sprint";
    build.prompt = brief.prompt;
    build.inventoryPreset = brief.inventoryPreset;
    build.summary =
      "A six-inch-wide rigid ramp with a supported launch platform. Car dimensions and simulation results are shown separately.";
    const deck = build.tiles.find(
      (t) => t.id === "large-rigid-sloped-driving-panel",
    )!;
    return [{ build, lanes: straightLanes(build, deck.id, brief) }];
  }
  // Search a bounded, reproducible grammar. Each rejected result retains its evidence.
  return [1, 2, 3].flatMap((height) =>
    [false, true].map((rails) => {
      let base = switchbackRamp({
        lowerLength: 1,
        upperLength: 1,
        towerHeight: height,
        withGuardRails: rails,
      });
      if (brief.lanes === 2) {
        const second = rename(base, "lane2-");
        base = composeMacros(base, placeMacro(second, { x: 0, y: 0, z: 3.36 }));
      }
      const bounds = buildBounds(base.tiles);
      const build: BuildGraph = {
        id: `switchback-${height}-${rails}`,
        title: "Two-flight switchback study",
        prompt: brief.prompt,
        family: "ramp",
        inventoryPreset: brief.inventoryPreset,
        seed: hashPrompt(brief.prompt),
        summary:
          "A generated switchback candidate. Failed checks identify what must change before this can be treated as a build plan.",
        tiles: base.tiles,
        connections: base.connections,
        bounds: {
          width: bounds.max.x - bounds.min.x,
          height: bounds.max.y - bounds.min.y,
          depth: bounds.max.z - bounds.min.z,
        },
      };
      const lanes: CourseLane[] = Array.from(
        { length: brief.lanes },
        (_, i) => {
          const prefix = i ? "lane2-" : "";
          const upper = build.tiles.find(
            (t) => t.id === `${prefix}upper-deck-1-1`,
          )!;
          const lower = build.tiles.find(
            (t) => t.id === `${prefix}lower-deck-1-1`,
          )!;
          const turn = build.tiles.find(
            (t) => t.id === `${prefix}turn-top-1-1`,
          )!;
          const ends = (id: string) => {
            const v = tileWorldVertices(build.tiles.find((t) => t.id === id)!);
            const a = scale(add(v[0], v[3]), 0.5),
              b = scale(add(v[1], v[2]), 0.5);
            return a.y > b.y ? [a, b] : [b, a];
          };
          const [start, end] = ends(upper.id),
            [lowStart, finish] = ends(lower.id);
          return {
            id: `Lane ${i + 1}`,
            width: 3,
            surfaceTileIds: [upper.id, turn.id, lower.id],
            waypoints: [start, end, lowStart, finish],
          };
        },
      );
      return { build, lanes };
    }),
  );
}

export function straightLanes(
  build: BuildGraph,
  deckId: string,
  brief: DesignBrief,
): CourseLane[] {
  const deck = build.tiles.find((t) => t.id === deckId)!;
  const vertices = tileWorldVertices(deck);
  let a = scale(add(vertices[0], vertices[3]), 0.5),
    b = scale(add(vertices[1], vertices[2]), 0.5);
  if (a.y < b.y) [a, b] = [b, a];
  const direction = normalize(subtract(b, a));
  const inset = brief.car.length / 2 + 0.15;
  const start = add(a, scale(direction, inset));
  const end = add(b, scale(direction, -0.4));
  const side = normalize(subtract(vertices[3], vertices[0]));
  const width = distance(vertices[0], vertices[3]) / brief.lanes;
  return Array.from({ length: brief.lanes }, (_, i) => {
    const offset = scale(side, (i - (brief.lanes - 1) / 2) * width);
    return {
      id: `Lane ${i + 1}`,
      width,
      surfaceTileIds: [deckId],
      waypoints: [add(start, offset), add(end, offset)],
    };
  });
}
function rename(m: TileMacro, prefix: string): TileMacro {
  return {
    tiles: m.tiles.map((t) => ({
      ...t,
      id: prefix + t.id,
      parentTileId: t.parentTileId ? prefix + t.parentTileId : undefined,
    })),
    connections: m.connections.map((c) => ({
      ...c,
      fromTileId: prefix + c.fromTileId,
      toTileId: prefix + c.toTileId,
    })),
  };
}
