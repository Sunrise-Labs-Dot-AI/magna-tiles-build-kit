import type { BuildFamily, PromptProfile } from "./types";

const PALETTES = {
  rainbow: ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#7b2cbf"],
  royal: ["#4d5bd1", "#f6c453", "#ef476f", "#ffffff", "#22b8cf"],
  ocean: ["#118ab2", "#06d6a0", "#8ecae6", "#ffffff", "#ffb703"],
  garden: ["#4aa96c", "#f7b733", "#ef476f", "#8ecae6", "#ffffff"],
  ember: ["#f05d5e", "#f7b733", "#6c584c", "#ffffff", "#2aaec2"]
};

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
  const palette = choosePalette(normalized, seed);
  const accents = chooseAccents(normalized, family);
  const title = titleForPrompt(normalized, family, size);

  return {
    family,
    size,
    palette,
    accents,
    title,
    seed
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
      (total, keyword) => total + (prompt.includes(keyword) ? 1 : 0),
      0
    );
    if (familyScore > score) {
      best = family;
      score = familyScore;
    }
  }

  return score > 0 ? best : "house";
}

function chooseSize(prompt: string): PromptProfile["size"] {
  if (/\b(tall|giant|huge|skyscraper|high)\b/.test(prompt)) return "tall";
  if (/\b(large|big)\b/.test(prompt)) return "tall";
  if (/\b(wide|long|bridge|road|garage)\b/.test(prompt)) return "wide";
  if (/\b(medium)\b/.test(prompt)) return "medium";
  if (/\b(small|little|tiny|mini)\b/.test(prompt)) return "small";
  return "medium";
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
  size: PromptProfile["size"]
): string {
  if (prompt.includes("dinosaur")) return "Friendly Tile Dinosaur";
  if (prompt.includes("snail")) return "Snail";
  if (prompt.includes("dog") || prompt.includes("puppy")) return "Little Tile Dog";
  if (prompt.includes("garage")) return "Toy Car Garage";
  if (/\b(jet|aircraft|airplane|aeroplane|airframe)\b/.test(prompt)) return "Jet Aircraft";
  if (prompt.includes("ramp")) {
    if (prompt.includes("small")) return "Small Car Ramp";
    if (prompt.includes("large") || prompt.includes("big")) return "Large Car Ramp";
    return "Medium Car Ramp";
  }
  if (prompt.includes("spaceship")) return "Space Cruiser";
  if (prompt.includes("princess")) return "Princess Castle";
  const sizeLabel = size === "medium" ? "" : `${capitalize(size)} `;
  return `${sizeLabel}${capitalize(family)}`;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
