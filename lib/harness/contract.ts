import type { InventoryPreset } from "@/lib/magnetic-tiles/types";
import type { Axis, IntentContract, StructureKind } from "./types";

const numbers: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};
const nouns: [StructureKind, RegExp][] = [
  ["tower", /\b(tower|towers)\b/],
  ["container", /\b(box|container|bin|tray)\b/],
  ["tunnel", /\b(tunnel|tunnels)\b/],
  ["staircase", /\b(staircase|stairs|stairway|steps)\b/],
];

/** Extract clauses, not a whitelist of individual words: unknown clauses cannot disappear. */
export function parseIntent(
  prompt: string,
  inventoryPreset: InventoryPreset = "classic-100",
  unlimitedPieces = false,
): IntentContract | null {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 1000)
    throw new Error("Use a prompt of 1 to 1,000 characters.");
  let text = prompt
    .toLowerCase()
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/g,
      (word) => String(numbers[word]),
    );
  const matches = nouns.filter(([, pattern]) => pattern.test(text));
  if (!matches.length) return null;
  const kind = matches[0][0];
  const contract: IntentContract = {
    version: 1,
    prompt: prompt.trim(),
    kind,
    cells: { width: 1, height: 1, depth: 1, steps: 2 },
    fixed: [],
    limits: {},
    maxPieces: null,
    unlimitedPieces,
    requireFloors: false,
    passage: { width: 2, height: 2 },
    inventoryPreset,
    unresolved: [],
    assumptions: [],
  };
  if (matches.length > 1)
    contract.unresolved.push(
      "Multiple structure families in one request are not yet compiled.",
    );
  text = text.replace(
    /\b(?:at most|no more than|maximum(?: of)?|max|up to)\s+(\d+)\s+(?:pieces|tiles)\b/g,
    (_, n) => {
      contract.maxPieces = Math.min(contract.maxPieces ?? Infinity, Number(n));
      return " ";
    },
  );
  text = text.replace(/\b(\d+)\s*[- ]?\s*(?:steps|step)\b/g, (_, n) => {
    if (contract.fixed.includes("steps") && contract.cells.steps !== Number(n))
      contract.unresolved.push("Conflicting step counts.");
    contract.cells.steps = Number(n);
    contract.fixed.push("steps");
    return " ";
  });
  text = text.replace(
    /\b(?:with\s+)?(\d+)\s+(?:levels|stories|storeys)\b/g,
    (_, n) => {
      if (
        contract.fixed.includes("height") &&
        contract.cells.height !== Number(n)
      )
        contract.unresolved.push("Conflicting height cell counts.");
      contract.cells.height = Number(n);
      contract.requireFloors = true;
      contract.fixed.push("height");
      return " ";
    },
  );
  text = text.replace(
    /\b(\d+)\s*(?:tiles?|squares?|cells?)\s+(wide|tall|high|deep|long)\b/g,
    (_, n, label) => {
      const key =
        label === "wide"
          ? "width"
          : /tall|high/.test(label)
            ? "height"
            : "depth";
      if (contract.fixed.includes(key) && contract.cells[key] !== Number(n))
        contract.unresolved.push(`Conflicting ${key} cell counts.`);
      contract.cells[key] = Number(n);
      contract.fixed.push(key);
      return " ";
    },
  );
  text = text.replace(
    /\b(?:(at least|at most|no more than|about|exactly)\s+)?(\d+(?:\.\d+)?)\s*[- ]?\s*(?:inches|inch|in)\s+(wide|tall|high|deep|long)\b/g,
    (_, modifier, amount, label) => {
      const n = Number(amount),
        axis: Axis =
          label === "wide" ? "x" : /tall|high/.test(label) ? "y" : "z";
      const tolerance = modifier === "exactly" ? 0.05 : 0.4;
      const range =
        modifier === "at least"
          ? { min: n, max: 60 }
          : /at most|no more than/.test(modifier ?? "")
            ? { min: 0, max: n }
            : { min: Math.max(0, n - tolerance), max: n + tolerance };
      const old = contract.limits[axis];
      contract.limits[axis] = old
        ? {
            min: Math.max(old.min, range.min),
            max: Math.min(old.max, range.max),
          }
        : range;
      if (!modifier || modifier === "about")
        contract.assumptions.push(
          `${label}: ${n} in interpreted within ±0.4 in to allow tile thickness.`,
        );
      return " ";
    },
  );
  if (/\bclosed\b|\blid\b|\broof\b/.test(text) && kind === "container")
    contract.unresolved.push(
      "Containers currently require an open top; a lid/roof is a different intent.",
    );
  if (/\bopen[ -]top(?:ped)?\b/.test(text) && kind !== "container")
    contract.unresolved.push(
      "Open-top intent is only implemented for containers.",
    );
  for (const [, pattern] of nouns)
    text = text.replace(new RegExp(pattern.source, "g"), " ");
  text = text
    .replace(
      /\bopen[ -]top(?:ped)?\b|\b(?:build|make|create|design|please|me|a|an|the|with|and|that|is|of|for|magnetic|tiles|magnatiles|wide|tall)\b/g,
      " ",
    )
    .replace(/[,.!?;:]/g, " ")
    .trim();
  if (text)
    contract.unresolved.push(
      `Uninterpreted clause: ${text.replace(/\s+/g, " ")}`,
    );
  contract.assumptions.push(
    "Nominal cells are 3 inches; envelope checks include physical tile thickness.",
  );
  if (kind === "container")
    contract.assumptions.push(
      "Container means a floor, four enclosing walls, open top, and a clear interior.",
    );
  if (kind === "tunnel")
    contract.assumptions.push(
      "Tunnel runs front to back with side walls, a continuous roof and floor, and a clear 2 × 2 inch passage. The floor may be raised on a braced base; nominal width/length specify the outer layout, not passage size.",
    );
  if (kind === "tower")
    contract.assumptions.push(
      "Tower means a closed upright shell, with height greater than both footprint dimensions.",
    );
  if (
    kind === "tower" &&
    !/height|tall|high|levels|stories|storeys/.test(prompt.toLowerCase())
  )
    contract.cells.height = 2;
  for (const [axis, range] of Object.entries(contract.limits)) {
    const key = axis === "x" ? "width" : axis === "y" ? "height" : "depth";
    if (contract.fixed.includes(key)) continue;
    contract.cells[key] = Math.max(
      contract.cells[key],
      Math.ceil((range.min - 0.36) / 3),
    );
  }
  if (unlimitedPieces) {
    contract.maxPieces = null;
    contract.assumptions.push(
      "Unlimited pieces: set inventory and prompt piece-count caps are disabled.",
    );
  }
  return contract;
}

/** Runtime schema for agent-authored contracts. No caller can disable mandatory checks. */
export function validateContract(
  value: unknown,
): asserts value is IntentContract {
  const c = value as IntentContract;
  if (
    !c ||
    c.version !== 1 ||
    !["tower", "container", "tunnel", "staircase"].includes(c.kind) ||
    typeof c.prompt !== "string" ||
    c.prompt.length > 1000 ||
    !["classic-100", "builder-xl"].includes(c.inventoryPreset)
  )
    throw new Error("Invalid intent contract.");
  if (
    !c.cells ||
    !["width", "height", "depth", "steps"].every(
      (k) =>
        Number.isInteger(c.cells[k as keyof typeof c.cells]) &&
        c.cells[k as keyof typeof c.cells] >= 1 &&
        c.cells[k as keyof typeof c.cells] <= 8,
    )
  )
    throw new Error(
      "Cell dimensions and step count must be integers from 1 to 8.",
    );
  if (
    !c.passage ||
    ![c.passage.width, c.passage.height].every(
      (n) => Number.isFinite(n) && n >= 1 && n <= 24,
    )
  )
    throw new Error("Passage dimensions must be 1 to 24 inches.");
  if (
    !Array.isArray(c.fixed) ||
    c.fixed.some((k) => !["width", "height", "depth", "steps"].includes(k))
  )
    throw new Error("Invalid fixed dimensions.");
  if (
    typeof c.unlimitedPieces !== "boolean" ||
    typeof c.requireFloors !== "boolean" ||
    (c.maxPieces !== null &&
      (!Number.isInteger(c.maxPieces) ||
        c.maxPieces < 1 ||
        c.maxPieces > 100000))
  )
    throw new Error("Piece budget must be null or a positive integer.");
  if (
    !c.limits ||
    Object.entries(c.limits).some(
      ([axis, v]) =>
        !["x", "y", "z"].includes(axis) ||
        !v ||
        !Number.isFinite(v.min) ||
        !Number.isFinite(v.max) ||
        v.min < 0 ||
        v.max > 60,
    )
  )
    throw new Error("Invalid dimension limits.");
  if (
    !Array.isArray(c.unresolved) ||
    !Array.isArray(c.assumptions) ||
    [...c.unresolved, ...c.assumptions].some(
      (s) => typeof s !== "string" || s.length > 1000,
    )
  )
    throw new Error("Invalid contract annotations.");
}
