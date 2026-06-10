import dogDraft from "@/build-drafts/dog.json";
import jetAircraftDraft from "@/build-drafts/jet-aircraft.json";
import largeCarRampDraft from "@/build-drafts/large-car-ramp.json";
import mediumCarRampDraft from "@/build-drafts/medium-car-ramp.json";
import smallCarRampDraft from "@/build-drafts/small-car-ramp.json";
import { draftToBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import type { MagneticConnection, TileInstance } from "./types";

export type DraftTemplateId =
  | "jet-aircraft"
  | "small-car-ramp"
  | "medium-car-ramp"
  | "large-car-ramp"
  | "dog";

const DRAFTS: Record<DraftTemplateId, AuthoredBuildDraft> = {
  "jet-aircraft": jetAircraftDraft as unknown as AuthoredBuildDraft,
  "small-car-ramp": smallCarRampDraft as unknown as AuthoredBuildDraft,
  "medium-car-ramp": mediumCarRampDraft as unknown as AuthoredBuildDraft,
  "large-car-ramp": largeCarRampDraft as unknown as AuthoredBuildDraft,
  dog: dogDraft as unknown as AuthoredBuildDraft
};

export interface DraftTemplate {
  tiles: TileInstance[];
  connections: MagneticConnection[];
}

/**
 * Replay a hand-authored, engine-valid build draft as a prompt template.
 *
 * This is the "author once, replay as guided" path from the v1 post-mortem: the tile
 * geometry was authored by a human in the workbench and proven against the physics gate,
 * so the prompt pipeline replays it verbatim instead of re-deriving geometry. Only
 * cosmetic color remapping is allowed; positions, rotations, connections, and parent
 * links are untouched. Steps are renumbered to be contiguous so instructions read 1..N.
 */
export function draftTemplate(
  id: DraftTemplateId,
  colorMap?: Map<string, string>
): DraftTemplate {
  const graph = draftToBuildGraph(DRAFTS[id]);
  const stepNumbers = Array.from(new Set(graph.tiles.map((tile) => tile.step))).sort(
    (first, second) => first - second
  );
  const stepRemap = new Map(stepNumbers.map((step, index) => [step, index + 1]));

  return {
    tiles: graph.tiles.map((tile) => ({
      ...tile,
      step: stepRemap.get(tile.step) ?? tile.step,
      color: colorMap?.get(tile.color) ?? tile.color
    })),
    connections: graph.connections.map((connection) => ({ ...connection }))
  };
}

/**
 * Build a deterministic recolor map from a draft's authored colors onto a palette.
 * Colors are remapped in order of first appearance so the same draft + palette always
 * produces the same result.
 */
export function draftPaletteMap(id: DraftTemplateId, palette: string[]): Map<string, string> {
  const seen: string[] = [];
  for (const tile of DRAFTS[id].tiles) {
    if (!seen.includes(tile.color)) seen.push(tile.color);
  }
  return new Map(seen.map((color, index) => [color, palette[index % palette.length] ?? color]));
}
