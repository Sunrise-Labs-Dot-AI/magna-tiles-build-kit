# Hierarchical Planner + Subassembly Executor

## 1. Approach

Treat recognizability as a planning problem above the existing physical engine: a target reference becomes a typed plan of named subassemblies, their parameterized macro choices, and their port-to-port spatial attachments.

The executor should stay deliberately boring: realize the plan through `tilePrimitive`, `box`, `squarePyramid`, `wedgePrism`, `attachByPort`/`joinByPorts`, `mirrorMacro`, and `composeMacros`, then refuse bad geometry through `assembleBuildGraph(draft, { strict: true })` and `gateBuild()`.

The hard new work is not another overlap checker; it is a recognizability scorer/repair loop that chooses and adjusts subassembly parameters until the build has the required parts, silhouette, symmetry, BOM fit, and fold variety.

## 2. Plan schema/DSL + subassembly catalog

The planner consumes these existing target assets:

- `ReferenceBuildEncoding`: BOM plus ordered `steps`, each optionally tagged with `subassemblyId` and `dependsOn`.
- Jet example subassemblies: `body`, `nose`, `left-wing`, `right-wing`, `tail`, `top-fin`.
- Reference intent: `requiredSubassemblies`, `requiredFoldAngles`, and `silhouetteRules`.
- Reference frames: `public/reference-frames/jet-aircraft/steps/*.jpg`.
- The durable target doc: fuselage is a horizontal 4-segment square tube, not an upright tower.

Concrete TS shape:

```ts
import type { Inventory, TileShape, Vec3 } from "@/lib/magnetic-tiles/types";
import type { BoxFace, MacroOrientation, MirrorAxis, TileMacro } from "@/lib/magnetic-tiles/macros";

export type TargetId = "jet-aircraft" | "small-car-ramp" | string;

export interface PlannerTarget {
  id: TargetId;
  label: string;
  bom: Partial<Inventory>;
  requiredSubassemblies: string[];
  requiredFoldAngles: number[];
  silhouetteRules: SilhouetteRuleSpec[];
  frameRefs: Array<{ stepId: string; src: string }>;
}

export interface SilhouetteRuleSpec {
  id: string;
  description: string;
  metric:
    | { kind: "bounds-ratio"; numerator: "width" | "height" | "depth"; denominator: "width" | "height" | "depth"; min?: number; max?: number }
    | { kind: "min-extent"; axis: "width" | "height" | "depth"; min: number }
    | { kind: "part-presence"; subassemblyId: string }
    | { kind: "symmetry"; left: string; right: string; axis: "x" | "z"; tolerance: number };
}

export interface HierarchicalBuildPlan {
  id: string;
  targetId: TargetId;
  title: string;
  family: "aircraft" | "ramp" | "house" | "castle" | "tower" | "bridge" | "rocket" | "animal";
  expectedInventory: Partial<Inventory>;
  subassemblies: PlannedSubassembly[];
  attachments: PlannedAttachment[];
  checks: PlannerCheck[];
}

export interface PlannedSubassembly {
  id: string;
  role: "body" | "nose" | "wing" | "tail" | "fin" | "brace" | "support" | "ramp" | string;
  macro: CatalogMacroRef;
  params: Record<string, unknown>;
  dependsOn?: string[];
  symmetry?: SymmetrySpec;
  stepStart: number;
  intentTags: string[];
}

export interface CatalogMacroRef {
  kind: "fuselageTube" | "nosePyramid" | "wingPanel" | "tailFin" | "box" | "squarePyramid" | "triangularPrism" | "wedgePrism" | "gableRoof" | "radialFan" | "tilePrimitive";
  version: number;
}

export interface SymmetrySpec {
  mode: "mirror-from" | "generate-pair";
  sourceSubassemblyId?: string;
  axis: MirrorAxis;
  origin: number;
  rename?: { from: string; to: string };
}

export interface PlannedAttachment {
  id: string;
  parentSubassemblyId: string;
  parentPort: string;
  childSubassemblyId: string;
  childPort: string;
  foldAngle: number;
  flip?: boolean;
  order: number;
  repairCandidates?: Array<{ parentPort?: string; childPort?: string; foldAngle?: number; flip?: boolean }>;
}

export interface PlannerCheck {
  kind: "strict-overlap" | "engine-gate" | "bom" | "subassembly-presence" | "silhouette" | "fold-variety";
  required: boolean;
}
```

Catalog entries should wrap the existing macros rather than replacing them:

```ts
export interface SubassemblyCatalogEntry<P> {
  kind: CatalogMacroRef["kind"];
  make(params: P): TileMacro;
  outputPorts(params: P): string[];
  bomEstimate(params: P): Partial<Inventory>;
  recognizableRoles: string[];
  tunables: Array<keyof P>;
}

export interface FuselageTubeParams {
  id: string;
  length: number;       // jet target: 4 segments
  crossSection: "square";
  color?: string;
  stepStart?: number;
}

export interface NosePyramidParams {
  id: string;
  shape: "squarePyramid" | "triangularNose";
  color?: string;
  stepStart?: number;
}

export interface WingPanelParams {
  id: string;
  side: "left" | "right";
  rootCount: number;
  tileShape: Extract<TileShape, "right-triangle" | "equilateral-triangle" | "isosceles-triangle">;
  sweep: number;
  dihedralFold: number;
  mirrorOf?: string;
  stepStart?: number;
}

export interface TailFinParams {
  id: string;
  finShape: Extract<TileShape, "equilateral-triangle" | "isosceles-triangle">;
  orientation: "horizontal" | "vertical";
  stepStart?: number;
}
```

Initial catalog for the jet:

- `fuselageTube`: creates the 16-square horizontal tube as 4 bottom, 4 left side, 4 right side, 4 top panels via `tilePrimitive` + `joinByPorts`.
- `nosePyramid`: either existing `squarePyramid` or a lower/left/right triangular nose made from `tilePrimitive` triangles joined to the tube front.
- `wingPanel`: right-triangle roots and tips attached to side/bottom tube ports; pair generated with `mirrorMacro(..., "z", 0)`.
- `tailFin`: equilateral/isosceles vertical triangles attached to top/rear ports; horizontal tail should be modeled before vertical tail because the reference encoding says ordering matters.

## 3. Core planner + executor algorithm

Pseudocode with real APIs:

```ts
function planTarget(reference: ReferenceBuildEncoding, intent: ReferenceIntentSpec): HierarchicalBuildPlan {
  const dag = normalizeReferenceDag(reference.steps); // uses step.id, step.subassemblyId, step.dependsOn
  const bom = reference.billOfMaterials ?? {};

  const required = intent.requiredSubassemblies;
  const candidates = required.map((id) =>
    chooseCatalogEntry({
      subassemblyId: id,
      bomRemaining: bom,
      stepEvidence: dag.stepsBySubassembly[id],
      silhouetteIntent: intent.silhouetteRules
    })
  );

  const subassemblies = assignParams(candidates, {
    // jet-specific first pass from docs/jet-rebuild-target.md
    body: { kind: "fuselageTube", length: 4, crossSection: "square" },
    nose: { kind: "nosePyramid" },
    wings: { kind: "wingPanel", rootCount: 3, tileShape: "right-triangle", symmetry: "mirror" },
    tail: { kind: "tailFin" },
    "top-fin": { kind: "tailFin" }
  });

  const attachments = resolveAttachmentGraph(subassemblies, dag, {
    bodyToNose: ["fuselage-bottom-4.right", "nose.base"],
    bodyToLeftWing: ["fuselage-left-*.bottom", "left-wing.legA"],
    leftToRightWing: { mirrorMacro: true, axis: "z", origin: 0 },
    bodyToTopFin: ["fuselage-top-1.left", "top-fin.base"]
  });

  return {
    id: `${reference.buildLabel}-hierarchical-v1`,
    targetId: slug(reference.buildLabel),
    title: reference.buildLabel,
    family: "aircraft",
    expectedInventory: bom,
    subassemblies,
    attachments,
    checks: [
      { kind: "strict-overlap", required: true },
      { kind: "engine-gate", required: true },
      { kind: "bom", required: true },
      { kind: "subassembly-presence", required: true },
      { kind: "silhouette", required: true },
      { kind: "fold-variety", required: true }
    ]
  };
}

async function executeAndVerify(plan: HierarchicalBuildPlan): Promise<PlannerResult> {
  const macros = new Map<string, TileMacro>();

  for (const subassembly of topoSort(plan.subassemblies)) {
    const entry = catalog[subassembly.macro.kind];
    let macro = entry.make({ ...subassembly.params, id: subassembly.id, stepStart: subassembly.stepStart });
    if (subassembly.symmetry?.mode === "mirror-from") {
      const source = requireMacro(macros, subassembly.symmetry.sourceSubassemblyId);
      macro = mirrorMacro(source, subassembly.symmetry.axis, subassembly.symmetry.origin);
    }
    macros.set(subassembly.id, macro);
  }

  let build = requireMacro(macros, "body");
  for (const edge of plan.attachments.sort((a, b) => a.order - b.order)) {
    const child = requireMacro(macros, edge.childSubassemblyId);
    build = attachByPort(build, edge.parentPort, child, edge.childPort, {
      foldAngle: edge.foldAngle,
      flip: edge.flip
    });
    build = composeMacros(build);
  }

  const draft = macroToDraft(plan, build);
  const graph = assembleBuildGraph(draft, { strict: true }); // throws RawOverlapError on interpenetration
  const gate = await gateBuild(graph);                       // raw overlap, magnetic/support, stand, roll if ramp
  const recognition = scoreRecognition(graph, plan);          // new: subassemblies + silhouette + fold variety

  if (!gate.passed || !recognition.passed) {
    return repair(plan, { graph, gate, recognition });
  }

  return { plan, macro: build, graph, gate, recognition };
}
```

Repair should be local and bounded:

- If `assembleBuildGraph` throws, try the attachment's `repairCandidates` first: alternate port, `flip`, or fold sign.
- If magnetic validation fails inside `gateBuild`, prefer `joinByPorts` where full-edge classes match; it calls `assertJoinablePorts` and resolves hinge clearance.
- If stand fails, adjust support geometry: lower wing fold, widen wing roots, add horizontal tail/base support, or change top-fin position.
- If silhouette fails, do not blindly add tiles; retune named part params so the recognizable part remains visible.

## 4. How recognizability is ensured

Recognizability is a separate acceptance layer after physical validity.

Minimum checks:

- Subassembly presence: tile `subassemblyId` must cover the intent's required labels. For the jet, require `body`, `nose`, `left-wing`/`right-wing` or aggregate `wings`, `tail`, and `top-fin`.
- Role text: generated tile `role` should satisfy intent patterns like `/fuselage/i`, `/nose|wing/i`, `/tail|fin/i`; this is already how `reference-acceptance.ts` thinks about intent.
- Silhouette: compute bounds from `buildBounds()` or `boundsForTiles()`. The current jet intent expects width greater than depth and height high enough to reveal vertical fins.
- Symmetry: mirror-generated wing pairs should have corresponding tile positions across the `z` axis, with left/right role renaming.
- Fold variety: collect `tile.foldAngle` and require snapped/folded variety from intent, especially `0`, `Math.PI / 2`, and `-Math.PI / 2`.
- BOM closeness: compare `macroBom(macro)` or validation inventory to the reference BOM. The jet target BOM is 16 small squares, 9 equilateral triangles, 10 right triangles, and 5 isosceles triangles.
- Stage legibility: each plan subassembly maps back to reference steps and frames, so the renderer can later compare stage N against `public/reference-frames/jet-aircraft/steps/<N>-*.jpg`.

This makes the planner optimize for "looks like a jet" before "uses all pieces." A physically valid block that lacks wings or a nose fails recognizability even if `gateBuild()` passes.

## 5. How the gate/overlap guard validate each part + the whole

Use validation in increasing scope:

1. Catalog self-check: each catalog entry should produce an overlap-free macro by itself. Existing tests already assert this for primitives like `wedgePrism`, `box`, `squarePyramid`, `gableRoof`, and `radialFan`.
2. Incremental attach check: after each `attachByPort`/`joinByPorts`, call the raw overlap guard on the current tiles. The production boundary is `assembleBuildGraph(draft, { strict: true })`, which calls `assertNoRawOverlaps`.
3. Whole graph check: convert the macro to an `AuthoredBuildDraft`, then `assembleBuildGraph(draft, { strict: true })`.
4. Engine gate: call `gateBuild(graph)`. It runs `findRawOverlaps`, `validateMagneticBuild`, `validateBuild` advisory checks for `BuildGraph`, physics `simulate`, and `rollTest` only when `isFunctionalRamp(build)` is true.
5. Recognition check: after gate, apply plan-specific recognizability checks. `gateBuild()` explicitly says recognizable-object resemblance requires human signoff beyond the engine gate, so this layer must be new.

Important distinction:

- `gateBuild()` is necessary for real builds.
- It is not sufficient for recognizable objects.
- The planner must fail a gate-valid but boxy aircraft if it lacks named nose/wing/tail parts or silhouette.

## 6. Minimal runnable POC

Created scratch file:

`scripts/research/02-planner-poc.ts`

The POC encodes a tiny jet plan:

- `body`: `fuselageTube`, length 4, built from `tilePrimitive` squares and `joinByPorts`.
- `nose`: three equilateral triangle panels attached to front tube ports.
- `wings`: left right-triangle wing roots/tips, mirrored to the right with `mirrorMacro(leftWing, "z", 0)`.
- `top-fin`: one isosceles triangle attached to the fuselage crown.

Executor path in the POC:

```ts
const macro = executePlan(jetPlan);
const draft = macroToDraft(jetPlan, macro);
const graph = assembleBuildGraph(draft, { strict: true });
const gate = await gateBuild(graph);
console.log({ bom: macroBom(macro), gate });
```

Requested command run:

```sh
npx vite-node --config vitest.config.ts scripts/research/02-planner-poc.ts
```

Actual result in this sandbox:

```text
npm error code ENOTFOUND
npm error network request to https://registry.npmjs.org/vite-node failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
```

Root cause:

- `node_modules/.bin` contains `tsx`, `vite`, and `vitest`, but no `vite-node`.
- `node_modules/vite-node` is missing.
- Network is restricted, so `npx` cannot fetch `vite-node`.
- Therefore the requested command failed before the POC script executed.

The POC source is present and imports real repo paths, but no runtime gate verdict was obtainable here because execution was blocked before script evaluation. It intentionally uses a partial BOM: it proves the plan-to-macro-to-draft-to-gate path, not the final faithful 40-piece jet.

## 7. Pros/cons

Pros:

- Separates recognizability from physics, which matches the actual problem.
- Reuses the macro/port API rather than creating another geometry system.
- Keeps failure messages actionable: "nose missing," "wings not symmetric," "strict overlap at wing root," or "stand failed."
- Supports classic task planning: decompose, assign parameterized parts, resolve attachment graph, realize, verify, repair.
- Mirrors the reference encoding: named subassemblies and DAG dependencies become first-class plan nodes.
- Enables stage-by-stage verification against the reference frames later.

Cons:

- Requires a curated subassembly catalog; pure search over arbitrary tiles will be too broad.
- A simple bounds silhouette is crude; it can accept a wide object that still does not read as a jet.
- The current `REFERENCE_INTENT_SPECS` constant is internal to `reference-acceptance.ts`; planner code would need an exported intent spec or a new shared module.
- Repair can become combinatorial if attachment candidates are not tightly bounded.
- Macro ports are human-designed; missing ports on a good macro can block otherwise valid plans.

## 8. Risks/unknowns

- Vision scoring is still unresolved. Bounds and role checks catch gross failures, but final recognizability may need rendered-frame comparison or human review.
- Jet nose attachment is underspecified. The target doc says a pointed triangular group at the front opening; existing `squarePyramid` has base ports, but the horizontal tube front opening may need dedicated fuselage front ports.
- Symmetry by `mirrorMacro` works geometrically, but parent attachment metadata must be repaired for mirrored roots; the POC does this manually.
- `gateBuild()` can be slow because it enters physics simulation; planner repair must avoid broad random search.
- Fold-angle intent in `reference-acceptance.ts` checks exact canonical angles, but recognizable aircraft may need near-horizontal wing dihedral like `-89deg`.
- BOM matching may conflict with recognizability. For example, a partial jet can look right before consuming all tail/detail triangles.
- Subassembly IDs are inconsistent between reference and generated builds: reference has `left-wing`/`right-wing`; intent currently requires aggregate `wings`.

## 9. Effort + first milestone

Effort: M for a useful first planner, L for visual recognition quality.

First milestone:

1. Export or duplicate a shared `ReferenceIntentSpec` for jet aircraft.
2. Add a `planner` module with the `HierarchicalBuildPlan` schema and a hard-coded jet plan.
3. Implement a catalog with `fuselageTube`, `triangularNose`, `wingPanel`, and `tailFin`.
4. Implement executor: catalog instantiate, attachment order, `mirrorMacro`, `assembleBuildGraph`, `gateBuild`.
5. Implement recognition v0: required subassemblies, BOM delta, width/depth/height silhouette, fold-angle coverage, symmetry.
6. Produce one review-ready jet draft only after strict overlap and gate pass; leave rendered-frame comparison as milestone 2.

## 10. VERDICT

VERDICT: Build it as a hierarchical planner, because recognizability is an object-level planning constraint and the repo already has the right lower-level macro, port, overlap, and gate primitives.

The first version should be intentionally narrow: jet-only, catalog-driven, hard-coded candidate params, deterministic repair candidates, and explicit recognition checks. Once that works, generalize across reference encodings.

Verdict: build hierarchical planner + subassembly executor now.
Effort: M for jet planner v0; L for robust visual recognizability.
Key risk: silhouette/role checks are weaker than rendered-frame recognition.
POC result: scratch POC created, but requested `npx vite-node` run failed before execution because `vite-node` is missing and network is blocked.
Next milestone: hard-coded jet plan that strict-assembles, gates, and passes recognition v0.
