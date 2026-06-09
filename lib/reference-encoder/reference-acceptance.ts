import { prepareBugReport, type PreparedBugReport } from "@/lib/bug-reports";
import { LARGE_EDGE, SMALL_EDGE, emptyInventory, SHAPE_ORDER, TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { tileWorldVertices } from "@/lib/magnetic-tiles/magnet-geometry";
import type { BuildBounds, GeneratedBuildResponse, Inventory } from "@/lib/magnetic-tiles/types";
import { CAR_RAMPS_REFERENCE_COLLECTION } from "./examples/car-ramps-reference";
import { JET_AIRCRAFT_REFERENCE_ENCODING } from "./examples/jet-aircraft-reference";
import type {
  ReferenceBuildCollection,
  ReferenceBuildEncoding,
  ReferenceBuildSegment
} from "./types";

export interface ReferenceAcceptanceCase {
  id: string;
  prompt: string;
  expectedLabel: string;
  expectedKind: "aircraft" | "ramp";
  referenceSummary: string;
  expectedInventory: Inventory;
  unsupportedMaterials?: string[];
}

export interface ReferenceAcceptanceGap {
  caseId: string;
  prompt: string;
  summary: string;
  details: string;
  expected: string;
  actual: string;
  result: GeneratedBuildResponse;
}

export interface ReferenceAcceptanceRun {
  cases: ReferenceAcceptanceCase[];
  gaps: ReferenceAcceptanceGap[];
  reports: PreparedBugReport[];
}

export interface ReferenceIntentSpec {
  summary: string;
  requiredSubassemblies: string[];
  requiredRolePatterns: RegExp[];
  requiredFoldAngles: number[];
  silhouetteRules: Array<{
    description: string;
    predicate: (bounds: BuildBounds) => boolean;
  }>;
  targetRules?: Array<{
    description: string;
    predicate: (result: GeneratedBuildResponse) => boolean;
  }>;
}

export const REFERENCE_INTENT_SPECS: Record<string, ReferenceIntentSpec> = {
  "jet-aircraft": {
    summary:
      "Jet must have a body, nose/wing triangles, wing braces, tail fins, and both flat and folded panels in an aircraft-like wide silhouette.",
    requiredSubassemblies: ["body", "nose", "wings", "tail", "top-fin"],
    requiredRolePatterns: [/fuselage/i, /nose|wing/i, /brace/i, /tail|fin/i],
    requiredFoldAngles: [0, Math.PI / 2, -Math.PI / 2],
    silhouetteRules: [
      {
        description: "aircraft should be wider than it is deep",
        predicate: (bounds) => bounds.width > bounds.depth * 1.2
      },
      {
        description: "aircraft should have visible vertical fins",
        predicate: (bounds) => bounds.height >= 9
      }
    ],
    targetRules: [
      {
        description: "aircraft must use the reviewed Jet Aircraft recipe, not the procedural fallback",
        predicate: (result) => result.build.tiles.some((tile) => /^jet-body-square-/.test(tile.id))
      },
      {
        description: "aircraft recipe must include attached recipe triangle modules",
        predicate: (result) => result.build.tiles.some((tile) => /^jet-equilateral-triangle-/.test(tile.id))
      }
    ]
  },
  "small-car-ramp": {
    summary:
      "Small ramp must include wedge sides, a sloped driving surface, landing/runout panels, support pieces, and side guards.",
    requiredSubassemblies: ["wedge", "driving-surface", "landing", "runout", "support", "guards"],
    requiredRolePatterns: [/wedge/i, /sloped driving/i, /landing/i, /support/i, /guard/i],
    requiredFoldAngles: [0, Math.PI / 2, -Math.PI / 2],
    silhouetteRules: [
      {
        description: "small ramp should have a low, usable run",
        predicate: (bounds) => bounds.depth >= 8 && bounds.height <= 4
      }
    ],
    targetRules: [
      {
        description: "small ramp should have a continuous climbable surface, not tall decorative spikes",
        predicate: hasClimbableRampProfile
      }
    ]
  },
  "medium-car-ramp": {
    summary: "Medium ramp must include a square rear support, repeated triangular bracing, and side guards.",
    requiredSubassemblies: ["rear-support", "braces", "guards"],
    requiredRolePatterns: [/rear support/i, /triangular brace/i, /side guard/i],
    requiredFoldAngles: [0, Math.PI / 2],
    silhouetteRules: [
      {
        description: "medium ramp should be wider than a compact small ramp",
        predicate: (bounds) => bounds.width >= 15
      },
      {
        description: "medium ramp should have a taller support profile",
        predicate: (bounds) => bounds.height >= 9
      }
    ],
    targetRules: [
      {
        description: "medium ramp should include a continuous climbable driving surface",
        predicate: hasClimbableRampProfile
      }
    ]
  },
  "large-car-ramp": {
    summary: `Large ramp must include a tall square wall, large ${LARGE_EDGE}-inch ramp planes, and triangular side markers.`,
    requiredSubassemblies: ["large-rear-wall", "large-ramp-plane", "large-side-triangles"],
    requiredRolePatterns: [/rear wall/i, /XL ramp plane/i, /side marker/i],
    requiredFoldAngles: [0, Math.PI / 2],
    silhouetteRules: [
      {
        description: "large ramp should have a broad wall",
        predicate: (bounds) => bounds.width >= 18
      },
      {
        description: "large ramp should be tall",
        predicate: (bounds) => bounds.height >= 18
      }
    ],
    targetRules: [
      {
        description: "large ramp should include an inclined ramp plane instead of flat floor panels against a wall",
        predicate: hasClimbableRampProfile
      }
    ]
  }
};

export function referenceAcceptanceCases(): ReferenceAcceptanceCase[] {
  return [
    encodingToCase(JET_AIRCRAFT_REFERENCE_ENCODING),
    ...collectionToCases(CAR_RAMPS_REFERENCE_COLLECTION)
  ];
}

export function runReferenceAcceptance(now = new Date()): ReferenceAcceptanceRun {
  const cases = referenceAcceptanceCases();
  const gaps = cases.flatMap((testCase) => evaluateReferenceCase(testCase));
  const reports = gaps.map((gap, index) =>
    prepareBugReport(
      {
        prompt: gap.prompt,
        currentStep: Math.max(1, gap.result.instructions.length),
        severity: "bug",
        area: "prompt-mapping",
        summary: gap.summary,
        details: gap.details,
        expected: gap.expected,
        actual: gap.actual,
        result: gap.result
      },
      new Date(now.getTime() + index)
    )
  );

  return { cases, gaps, reports };
}

function evaluateReferenceCase(testCase: ReferenceAcceptanceCase): ReferenceAcceptanceGap[] {
  const result = generateBuild(testCase.prompt);
  const gaps: ReferenceAcceptanceGap[] = [];

  if (!matchesExpectedKind(result, testCase.expectedKind)) {
    gaps.push({
      caseId: testCase.id,
      prompt: testCase.prompt,
      summary: `Reference prompt maps to the wrong build family: ${testCase.expectedLabel}`,
      details:
        `The reviewed reference expects a ${testCase.expectedKind} build, but the current generator produced a ${result.build.family} template. ` +
        `This means the renderer/instructions are not testing the encoded reference pattern yet.`,
      expected: testCase.referenceSummary,
      actual: `${result.build.title} (${result.build.family}) with ${result.build.tiles.length} tiles`,
      result
    });
  }

  if (testCase.unsupportedMaterials?.length) {
    gaps.push({
      caseId: testCase.id,
      prompt: testCase.prompt,
      summary: `Reference uses unsupported materials: ${testCase.expectedLabel}`,
      details:
        `The reference build requires ${testCase.unsupportedMaterials.join(", ")}, but the current generator only supports the Classic-100 shape set. ` +
        "The generated result cannot faithfully test this reference until the catalog and renderer understand these pieces.",
      expected: `${testCase.expectedLabel} should support ${testCase.unsupportedMaterials.join(", ")}.`,
      actual: `${result.build.title} uses only the current built-in catalog.`,
      result
    });
  }

  const inventoryMismatches = SHAPE_ORDER.filter(
    (shape) => result.validation.usedInventory[shape] !== testCase.expectedInventory[shape]
  );
  if (inventoryMismatches.length > 0) {
    gaps.push({
      caseId: testCase.id,
      prompt: testCase.prompt,
      summary: `Generated build does not match the reference bill of materials: ${testCase.expectedLabel}`,
      details:
        "A reviewed library build needs to preserve the video BOM before we call it faithful. " +
        `Mismatched shapes: ${inventoryMismatches.map((shape) => TILE_SPECS[shape].label).join(", ")}.`,
      expected: formatInventory(testCase.expectedInventory),
      actual: formatInventory(result.validation.usedInventory),
      result
    });
  }

  const physicalIssues = result.validation.issues.filter((issue) =>
    ["tile-overlap", "floating-tiles", "duplicate-placement", "magnet-constraint"].includes(issue.code)
  );
  if (physicalIssues.length > 0) {
    gaps.push({
      caseId: testCase.id,
      prompt: testCase.prompt,
      summary: `Generated build has physical validation issues: ${testCase.expectedLabel}`,
      details:
        "Reference builds should not pass acceptance while they contain overlaps, unsupported tiles, duplicated placements, or invalid magnetic joins. " +
        physicalIssues.map((issue) => `${issue.code}: ${issue.detail}`).join(" "),
      expected: "No blocking physical validation issues for the rendered reference build.",
      actual: physicalIssues.map((issue) => `${issue.code} (${issue.tileIds?.length ?? 0} tiles)`).join("; "),
      result
    });
  }

  const intentGaps = evaluateReferenceIntent(testCase, result);
  intentGaps.forEach((intentGap) => gaps.push(intentGap));

  if (testCase.expectedKind === "ramp" && !hasRampLanguage(result)) {
    gaps.push({
      caseId: testCase.id,
      prompt: testCase.prompt,
      summary: `Generated instructions do not describe a ramp: ${testCase.expectedLabel}`,
      details:
        "The reviewed car-ramp references need sloped driving surfaces, wedge/support geometry, and test-with-car validation. " +
        "The current bridge template may create a car-adjacent structure, but it does not encode ramp-specific construction.",
      expected: testCase.referenceSummary,
      actual: result.instructions.map((step) => `${step.step}. ${step.title}`).join("; "),
      result
    });
  }

  return gaps;
}

function evaluateReferenceIntent(
  testCase: ReferenceAcceptanceCase,
  result: GeneratedBuildResponse
): ReferenceAcceptanceGap[] {
  const spec = REFERENCE_INTENT_SPECS[testCase.id];
  if (!spec) return [];

  const missingSubassemblies = spec.requiredSubassemblies.filter(
    (subassembly) => !result.build.tiles.some((tile) => tile.subassemblyId === subassembly)
  );
  const missingRoles = spec.requiredRolePatterns.filter(
    (pattern) => !result.build.tiles.some((tile) => pattern.test(tile.role))
  );
  const foldAngles = new Set(
    result.build.tiles
      .filter((tile) => tile.parentTileId)
      .map((tile) => normalizeFoldAngle(tile.foldAngle ?? 0))
  );
  const missingFolds = spec.requiredFoldAngles.filter((angle) => !foldAngles.has(normalizeFoldAngle(angle)));
  const bounds = result.build.bounds;
  const silhouetteFailures = spec.silhouetteRules.filter((rule) => !rule.predicate(bounds));
  const targetRuleFailures = spec.targetRules?.filter((rule) => !rule.predicate(result)) ?? [];

  if (
    missingSubassemblies.length === 0 &&
    missingRoles.length === 0 &&
    missingFolds.length === 0 &&
    silhouetteFailures.length === 0 &&
    targetRuleFailures.length === 0
  ) {
    return [];
  }

  return [
    {
      caseId: testCase.id,
      prompt: testCase.prompt,
      summary: `Generated build misses reference intent: ${testCase.expectedLabel}`,
      details: [
        missingSubassemblies.length ? `Missing subassemblies: ${missingSubassemblies.join(", ")}.` : "",
        missingRoles.length ? `Missing role patterns: ${missingRoles.map(String).join(", ")}.` : "",
        missingFolds.length ? `Missing fold angles: ${missingFolds.map((angle) => angle.toFixed(2)).join(", ")}.` : "",
        silhouetteFailures.length
          ? `Silhouette failures: ${silhouetteFailures.map((rule) => rule.description).join("; ")}.`
          : "",
        targetRuleFailures.length
          ? `Target failures: ${targetRuleFailures.map((rule) => rule.description).join("; ")}.`
          : ""
      ]
        .filter(Boolean)
        .join(" "),
      expected: spec.summary,
      actual: `Subassemblies: ${Array.from(new Set(result.build.tiles.map((tile) => tile.subassemblyId ?? "none"))).join(", ")}. Bounds: ${Math.round(bounds.width)}w x ${Math.round(bounds.height)}h x ${Math.round(bounds.depth)}d.`,
      result
    }
  ];
}

function encodingToCase(encoding: ReferenceBuildEncoding): ReferenceAcceptanceCase {
  return {
    id: "jet-aircraft",
    prompt: encoding.buildLabel,
    expectedLabel: encoding.buildLabel,
    expectedKind: "aircraft",
    expectedInventory: normalizeInventory(encoding.billOfMaterials),
    referenceSummary:
      "Jet aircraft with pinned BOM, upright fuselage, pointed nose, mirrored wings, tail ordering, top fin, and final pose checks."
  };
}

function collectionToCases(collection: ReferenceBuildCollection): ReferenceAcceptanceCase[] {
  return collection.segments.map((segment) => segmentToCase(segment));
}

function segmentToCase(segment: ReferenceBuildSegment): ReferenceAcceptanceCase {
  return {
    id: segment.id,
    prompt: segment.buildLabel,
    expectedLabel: segment.buildLabel,
    expectedKind: "ramp",
    referenceSummary: segment.summary,
    expectedInventory: normalizeInventory(segment.billOfMaterials, segment.additionalMaterials),
    unsupportedMaterials: segment.additionalMaterials
      ?.filter((material) => materialToShape(material.label) === null)
      .map((material) => material.label)
  };
}

function matchesExpectedKind(
  result: GeneratedBuildResponse,
  expectedKind: ReferenceAcceptanceCase["expectedKind"]
): boolean {
  if (expectedKind === "aircraft") {
    return result.build.family === "aircraft" && /\b(air|jet|plane|aircraft)\b/i.test(result.build.title);
  }

  return result.build.family === "ramp" && hasRampLanguage(result);
}

function hasRampLanguage(result: GeneratedBuildResponse): boolean {
  const text = [result.build.title, result.build.summary, ...result.instructions.map((step) => step.instruction)]
    .join(" ")
    .toLowerCase();
  return /\b(ramp|slope|sloped|wedge|incline)\b/.test(text);
}

function formatInventory(inventory: Inventory): string {
  return SHAPE_ORDER.map((shape) => `${TILE_SPECS[shape].label}: ${inventory[shape]}`).join("; ");
}

function normalizeInventory(
  inventory: Partial<Inventory> | undefined,
  additionalMaterials: Array<{ label: string; count: number }> = []
): Inventory {
  const normalized = SHAPE_ORDER.reduce((current, shape) => {
    current[shape] = inventory?.[shape] ?? 0;
    return current;
  }, emptyInventory());

  additionalMaterials.forEach((material) => {
    const shape = materialToShape(material.label);
    if (shape) normalized[shape] += material.count;
  });

  return normalized;
}

function materialToShape(label: string) {
  const normalized = label.toLowerCase();
  if (normalized === "xl square" || normalized === "large square") return "large-square";
  return null;
}

function normalizeFoldAngle(angle: number): string {
  const nearestQuarterTurn = Math.round(angle / (Math.PI / 2));
  const normalized = nearestQuarterTurn * (Math.PI / 2);
  return normalized.toFixed(2);
}

function hasClimbableRampProfile(result: GeneratedBuildResponse): boolean {
  if (result.build.family !== "ramp") return false;

  const surfaceTiles = result.build.tiles.filter((tile) =>
    /driving|landing|runout|ramp plane|slope|incline|approach/i.test(`${tile.role} ${tile.subassemblyId ?? ""}`)
  );
  if (surfaceTiles.length < 2) return false;

  const surfaceVertices = surfaceTiles.flatMap((tile) => tileWorldVertices(tile));
  const surfaceMinY = Math.min(...surfaceVertices.map((vertex) => vertex.y));
  const surfaceMaxY = Math.max(...surfaceVertices.map((vertex) => vertex.y));
  const surfaceHeight = surfaceMaxY - surfaceMinY;
  if (surfaceHeight < SMALL_EDGE / 2) return false;

  const surfaceWidth = Math.max(...surfaceVertices.map((vertex) => vertex.x)) - Math.min(...surfaceVertices.map((vertex) => vertex.x));
  const surfaceDepth = Math.max(...surfaceVertices.map((vertex) => vertex.z)) - Math.min(...surfaceVertices.map((vertex) => vertex.z));
  const horizontalRun = Math.max(surfaceWidth, surfaceDepth);
  if (horizontalRun < surfaceHeight * 1.2) return false;

  const useXAxis = surfaceWidth > surfaceDepth;
  const stationHeights = new Map<number, number>();
  surfaceTiles.forEach((tile) => {
    const station = Math.round((useXAxis ? tile.position.x : tile.position.z) * 2) / 2;
    stationHeights.set(station, Math.max(stationHeights.get(station) ?? Number.NEGATIVE_INFINITY, tile.position.y));
  });
  const centers = Array.from(stationHeights.entries())
    .map(([station, y]) => ({ station, y }))
    .sort((first, second) => first.station - second.station);
  const upward = centers.every((center, index) => index === 0 || center.y >= centers[index - 1].y - 0.75);
  const downward = centers.every((center, index) => index === 0 || center.y <= centers[index - 1].y + 0.75);

  return upward || downward;
}
