import type { InventoryPreset } from "@/lib/magnetic-tiles/types";
import type { DesignBrief } from "./types";

/** A small, explicit grammar. Unsupported requirements stay visible, never silently disappear. */
export function parseDesignBrief(
  prompt: string,
  inventoryPreset: InventoryPreset = "classic-100",
): DesignBrief {
  const text = prompt.trim();
  if (!text || text.length > 1000)
    throw new Error("Describe your build in 1 to 1,000 characters.");
  const race =
    /\b(race\s*course|race\s*track|racing|raceway|downhill|ramp|ramps|car|cars|zigzag\w*|switchback\w*)\b/i.test(
      text,
    );
  const lanes =
    /\b(?:two|2)\s+(?:(?:side[ -]by[ -]side)\s+)?(?:cars|lanes)\b|side[ -]by[ -]side|dual[ -]lane|double[ -]lane/i.test(
      text,
    )
      ? 2
      : 1;
  const explicitTurns = text.match(
    /\b([1-6])\s*(?:turns|bends|switchbacks)\b/i,
  );
  const turns = explicitTurns
    ? Number(explicitTurns[1])
    : /zig[ -]?zag|switchback|slalom/i.test(text)
      ? 2
      : /\b(turn|bend|corner)\b/i.test(text)
        ? 1
        : 0;
  const vocabulary = new Set(
    "a an the build make create design me please for with and of my to two 2 one 1 single side by dual double lane lanes car cars downhill straight sprint race course racecourse raceway racetrack race track racing ramp ramps slope incline gravity turn turns bend bends corner corners zigzag zigzagging switchback switchbacks slalom 3 4 5 6".split(
      " ",
    ),
  );
  const unsupportedTerms = [
    ...new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (word) => !vocabulary.has(word),
      ),
    ),
  ];
  return {
    prompt: text,
    kind: race ? "racecourse" : "structure",
    lanes,
    turns,
    downhill: /downhill|ramp|slope|incline|gravity/i.test(text),
    inventoryPreset,
    unsupportedTerms,
    // Visible assumptions, not a claim about the user's actual cars.
    car: { width: 1.1, length: 2.5, wheelRadius: 0.22, massKg: 0.04 },
  };
}
