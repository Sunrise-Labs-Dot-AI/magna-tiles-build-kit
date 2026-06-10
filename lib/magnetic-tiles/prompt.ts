import type { BuildFamily, BuildPart, PartColorRequest, PromptProfile } from "./types";

const PALETTES = {
  rainbow: ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#7b2cbf"],
  royal: ["#4d5bd1", "#f6c453", "#ef476f", "#ffffff", "#22b8cf"],
  ocean: ["#118ab2", "#06d6a0", "#8ecae6", "#ffffff", "#ffb703"],
  garden: ["#4aa96c", "#f7b733", "#ef476f", "#8ecae6", "#ffffff"],
  ember: ["#f05d5e", "#f7b733", "#6c584c", "#ffffff", "#2aaec2"]
};

export type PaletteName = keyof typeof PALETTES;

export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

export function paletteByName(name: PaletteName): string[] {
  return PALETTES[name];
}

const FAMILY_KEYWORDS: Record<BuildFamily, string[]> = {
  castle: ["castle", "princess", "king", "queen", "fort", "palace", "towered"],
  house: ["house", "home", "garage", "barn", "cabin", "store", "shop"],
  tower: ["tower", "skyscraper", "tall", "spire", "lighthouse"],
  bridge: ["bridge", "road", "car", "cars", "tunnel", "arch"],
  rocket: ["rocket", "ship", "spaceship", "space", "shuttle", "plane"],
  animal: ["dog", "dinosaur", "snail", "animal", "cat", "dragon", "puppy", "creature"],
  aircraft: ["jet", "aircraft", "airplane", "aeroplane", "airframe"],
  ramp: ["ramp", "ramps", "slope", "sloped", "wedge", "incline"]
};

/** Deterministic color-word lookup for explicit color requests ("red roof", "a blue castle"). */
export const COLOR_WORDS: Record<string, string> = {
  red: "#ef476f",
  orange: "#f7b733",
  yellow: "#ffd166",
  green: "#06d6a0",
  teal: "#2aaec2",
  blue: "#118ab2",
  navy: "#0b5f8a",
  purple: "#7b2cbf",
  violet: "#7b2cbf",
  pink: "#ff8fab",
  white: "#ffffff",
  gray: "#d8dee2",
  grey: "#d8dee2"
};

const PART_WORDS: Record<string, BuildPart> = {
  roof: "roof",
  rooftop: "roof",
  wall: "wall",
  walls: "wall",
  tower: "tower",
  towers: "tower",
  door: "door",
  doors: "door",
  deck: "deck",
  landing: "deck",
  body: "body",
  nose: "nose",
  wing: "wing",
  wings: "wing",
  fin: "fin",
  fins: "fin",
  tail: "fin",
  base: "base",
  floor: "base"
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  twin: 2,
  double: 2,
  triple: 3
};

export function hashPrompt(prompt: string): number {
  let hash = 2166136261;
  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function classifyPrompt(prompt: string): PromptProfile {
  const normalized = prompt.toLowerCase();
  const seed = hashPrompt(normalized.trim() || "magnetic tile build");
  const family = chooseFamily(normalized);
  const size = chooseSize(normalized);
  const partColors = choosePartColors(normalized);
  const dominantColor = chooseDominantColor(normalized, partColors);
  const palette = applyDominantColor(choosePalette(normalized, seed), dominantColor);
  const accents = chooseAccents(normalized, family);
  const count = chooseCount(normalized, family);
  const title = titleForPrompt(normalized, family, size, count);

  return {
    family,
    size,
    palette,
    accents,
    title,
    seed,
    count,
    partColors,
    dominantColor
  };
}

export interface ProfileOverrides {
  family?: BuildFamily;
  size?: PromptProfile["size"];
  count?: number;
  paletteName?: PaletteName;
}

/**
 * Re-derive a profile with discrete overrides (family / size / count / palette name),
 * recomputing the title and accents so the presented plan stays honest about what is
 * actually generated. Used by the deterministic repair ladder and by the optional LLM
 * parameter mapper -- in both cases only discrete template parameters change, never
 * geometry.
 */
export function reviseProfile(
  prompt: string,
  base: PromptProfile,
  overrides: ProfileOverrides
): PromptProfile {
  const normalized = prompt.toLowerCase();
  const family = overrides.family ?? base.family;
  const size = overrides.size ?? base.size;
  const count = family === "tower" ? Math.min(3, Math.max(1, overrides.count ?? base.count)) : 1;
  const palette = overrides.paletteName
    ? applyDominantColor(PALETTES[overrides.paletteName], base.dominantColor)
    : base.palette;

  return {
    ...base,
    family,
    size,
    count,
    palette,
    accents: chooseAccents(normalized, family),
    title: titleForPrompt(normalized, family, size, count)
  };
}

function chooseFamily(prompt: string): BuildFamily {
  if (/\b(ramp|ramps|slope|sloped|wedge|incline)\b/.test(prompt)) return "ramp";
  if (/\b(jet|aircraft|airplane|aeroplane|airframe)\b/.test(prompt)) return "aircraft";

  let best: BuildFamily = "castle";
  let score = -1;

  for (const [family, keywords] of Object.entries(FAMILY_KEYWORDS) as Array<
    [BuildFamily, string[]]
  >) {
    const familyScore = keywords.reduce(
      (total, keyword) => total + (keywordMatches(prompt, keyword) ? 1 : 0),
      0
    );
    if (familyScore > score) {
      best = family;
      score = familyScore;
    }
  }

  return score > 0 ? best : "house";
}

/**
 * Keyword hit with a leading word boundary so embedded words do not misfire
 * ("lighthouse" must not count as "house"), while plurals still match
 * ("towers" counts as "tower").
 */
function keywordMatches(prompt: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}`).test(prompt);
}

function chooseSize(prompt: string): PromptProfile["size"] {
  if (/\b(tall|giant|huge|skyscraper|high)\b/.test(prompt)) return "tall";
  if (/\b(large|big)\b/.test(prompt)) return "tall";
  if (/\b(wide|long|bridge|road|garage)\b/.test(prompt)) return "wide";
  if (/\b(medium)\b/.test(prompt)) return "medium";
  if (/\b(small|little|tiny|mini)\b/.test(prompt)) return "small";
  return "medium";
}

/**
 * Parse a requested structure count, e.g. "two towers" or "3 towers". Only the tower
 * family composes repeated structures today, so other families keep count 1 and the
 * summary stays honest about what is actually generated.
 */
function chooseCount(prompt: string, family: BuildFamily): number {
  if (family !== "tower") return 1;

  const match = prompt.match(
    /\b(one|two|three|four|five|twin|double|triple|\d+)\s+(?:\w+\s+)?(towers?|spires?|lighthouses?|skyscrapers?)\b/
  );
  if (!match) return 1;

  const raw = NUMBER_WORDS[match[1]] ?? Number.parseInt(match[1], 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(3, Math.max(1, raw));
}

/** Parse explicit "<color> <part>" requests like "red roof" or "blue walls". */
function choosePartColors(prompt: string): PartColorRequest[] {
  const requests: PartColorRequest[] = [];
  const colorNames = Object.keys(COLOR_WORDS).join("|");
  const partNames = Object.keys(PART_WORDS).join("|");
  const pattern = new RegExp(`\\b(${colorNames})\\s+(${partNames})\\b`, "g");

  for (const match of prompt.matchAll(pattern)) {
    const part = PART_WORDS[match[2]];
    if (requests.some((existing) => existing.part === part)) continue;
    requests.push({ part, color: COLOR_WORDS[match[1]], colorName: match[1] });
  }

  return requests;
}

/** A standalone color word ("a blue castle") becomes the dominant palette color. */
function chooseDominantColor(
  prompt: string,
  partColors: PartColorRequest[]
): string | undefined {
  const colorNames = Object.keys(COLOR_WORDS).join("|");
  const partNames = Object.keys(PART_WORDS).join("|");
  const standalone = new RegExp(`\\b(${colorNames})\\b(?!\\s+(?:${partNames})\\b)`);
  const match = prompt.match(standalone);
  if (!match) return undefined;
  if (partColors.some((request) => request.colorName === match[1])) return undefined;
  return COLOR_WORDS[match[1]];
}

function applyDominantColor(palette: string[], dominantColor?: string): string[] {
  if (!dominantColor) return palette;
  return [dominantColor, ...palette.filter((color) => color !== dominantColor)];
}

function choosePalette(prompt: string, seed: number): string[] {
  if (prompt.includes("rainbow")) return PALETTES.rainbow;
  if (/\b(princess|royal|castle|palace)\b/.test(prompt)) return PALETTES.royal;
  if (/\b(ocean|water|ice|space|rocket|spaceship)\b/.test(prompt)) {
    return PALETTES.ocean;
  }
  if (/\b(dog|dinosaur|snail|animal|garden)\b/.test(prompt)) return PALETTES.garden;

  const values = Object.values(PALETTES);
  return values[seed % values.length];
}

function chooseAccents(prompt: string, family: BuildFamily): string[] {
  const accents = new Set<string>();
  if (prompt.includes("rainbow")) accents.add("rainbow colors");
  if (prompt.includes("garage")) accents.add("wide door");
  if (prompt.includes("princess")) accents.add("crown roof");
  if (prompt.includes("dinosaur")) accents.add("tail and back spikes");
  if (prompt.includes("snail")) accents.add("shell and antenna");
  if (prompt.includes("dog") || prompt.includes("puppy")) accents.add("ears and tail");
  if (family === "bridge") accents.add("drive-through arch");
  if (family === "rocket") accents.add("nose cone and fins");
  return Array.from(accents);
}

function titleForPrompt(
  prompt: string,
  family: BuildFamily,
  size: PromptProfile["size"],
  count: number
): string {
  if (prompt.includes("dinosaur")) return "Friendly Tile Dinosaur";
  if (prompt.includes("snail")) return "Snail";
  if (prompt.includes("dog") || prompt.includes("puppy")) return "Little Tile Dog";
  if (prompt.includes("garage")) return "Toy Car Garage";
  if (/\b(jet|aircraft|airplane|aeroplane|airframe)\b/.test(prompt)) return "Jet Aircraft";
  if (prompt.includes("ramp")) {
    // Derive from the size parameter (not raw prompt words) so a repaired/lowered
    // build keeps an honest title.
    if (size === "small") return "Small Car Ramp";
    if (size === "tall") return "Large Car Ramp";
    return "Medium Car Ramp";
  }
  if (prompt.includes("spaceship")) return "Space Cruiser";
  if (prompt.includes("princess")) return "Princess Castle";
  if (family === "tower" && count === 2) return "Twin Towers";
  if (family === "tower" && count === 3) return "Three Towers";
  if (prompt.includes("lighthouse")) return "Lighthouse";
  const sizeLabel = size === "medium" ? "" : `${capitalize(size)} `;
  return `${sizeLabel}${capitalize(family)}`;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
