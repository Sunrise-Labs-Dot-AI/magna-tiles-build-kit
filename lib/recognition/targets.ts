import type { ReferenceIntentSpec } from "@/lib/reference-encoder/reference-acceptance";

/**
 * Recognition targets for the new scorer (Phase 2). These are intentionally DECOUPLED from the
 * legacy `REFERENCE_INTENT_SPECS` in reference-acceptance.ts: that constant drives the old
 * procedural-acceptance flow and still encodes the original tippy-tall jet (height >= 9). The
 * corrected jet (docs/jet-rebuild-target.md) is a LOW, LONG, WIDE-WINGED build resting on its belly,
 * so it needs its own silhouette rules. Reusing the ReferenceIntentSpec shape keeps the scorer
 * generic.
 *
 * Bounds axes (from BuildGraph.bounds / calculateBounds): width = X extent (fuselage length),
 * height = Y extent, depth = Z extent (wingspan).
 */
export const JET_RECOGNITION_TARGET: ReferenceIntentSpec = {
  summary:
    "Jet reads as a low horizontal aircraft: long square-tube fuselage on its belly, a pointed nose, wide swept wings, and an upright tail fin.",
  requiredSubassemblies: ["body", "nose", "wings", "tail", "top-fin"],
  requiredRolePatterns: [/fuselage|body/i, /nose/i, /wing/i, /tail|fin/i],
  requiredFoldAngles: [0, Math.PI / 2, -Math.PI / 2],
  silhouetteRules: [
    {
      description: "fuselage is clearly the long axis (long and low, not a tower)",
      predicate: (bounds) => bounds.width > bounds.height * 1.6
    },
    {
      description: "wings span wide relative to height (a broad, low footprint)",
      predicate: (bounds) => bounds.depth > bounds.height * 1.2
    },
    {
      description: "has vertical relief from nose/fin (not a flat slab)",
      predicate: (bounds) => bounds.height >= 3.5
    }
  ]
};

export const RECOGNITION_TARGETS: Record<string, ReferenceIntentSpec> = {
  "jet-aircraft": JET_RECOGNITION_TARGET
};
