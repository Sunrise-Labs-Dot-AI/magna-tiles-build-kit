# Multi-Agent Vision Loop for Reference Rebuilds

## 1. Approach

The system converts a reviewed reference encoding into subassembly plans, has builders author each
subassembly with the existing macro vocabulary, gates the composed draft, renders step PNGs, and
uses a vision critic to issue typed corrections. It beats the current ad-hoc human loop because
feedback becomes repeatable, code-grounded, and physically gated before visual resemblance can pull
the build into impossible geometry.

## 2. Codebase Anchors

- Reference contract: `ReferenceBuildEncoding`, `ReferenceEncodingStep`, and BOM types in `lib/reference-encoder/types.ts`.
- Jet reference: `JET_AIRCRAFT_REFERENCE_ENCODING` in `lib/reference-encoder/examples/jet-aircraft-reference.ts`.
- Jet acceptance intent: `REFERENCE_INTENT_SPECS["jet-aircraft"]` in `lib/reference-encoder/reference-acceptance.ts`.
- Draft contract: `AuthoredBuildDraft` and `BuilderTile` in `lib/builder/types.ts`.
- Real graph boundary: `assembleBuildGraph(draft, { strict: true })` in `lib/builder/operations.ts`.
- Hard physical gate: `gateBuild(input)` in `lib/engine/gate.ts`; raw overlap floor is `RAW_OVERLAP_TOLERANCE = 0.03` in `lib/engine/overlap.ts`.
- Render output convention: `verification/<id>/*.png` from `scripts/render-draft.ts`.
- Reference frames: `public/reference-frames/jet-aircraft/steps/01-body-start.jpg` through `13-final-rear.jpg`.
- Durable target: `docs/jet-rebuild-target.md` says the reliable jet model is a low square-tube fuselage, pointed nose, wide low wings, rear tail fins, top fin, and final front/side/rear checks.

## 3. Macro Surface the Loop Should Speak

Builders should call macros from `lib/magnetic-tiles/macros.ts`, not hand-edit tile bases.

```ts
type MacroName =
  | "tilePrimitive" | "box" | "openBox" | "cube" | "squarePyramid" | "rocketFinBase"
  | "radialFan" | "wallGrid" | "triangularPrism" | "wedgePrism" | "composeMacros"
  | "attachByPort" | "joinByPorts" | "rightAngleFold" | "arbitraryFold"
  | "mirroredPair" | "placeMacro";

type KnownPortName =
  | "edge0" | "edge1" | "edge2" | "edge3" | "bottom" | "right" | "top" | "left"
  | "legA" | "hypotenuse" | "legB" | "base" | "rightLong" | "leftLong"
  | "front" | "back" | "topLeftEdge" | "topRightEdge" | "topFrontEdge" | "topBackEdge"
  | "topRightRampEdge" | "frontBase" | "rightBase" | "backBase" | "leftBase"
  | "bodyBase" | "frontFinBase" | "rightFinBase" | "backFinBase" | "leftFinBase"
  | "lowEdge" | "highEdge" | "leftDeckEdge" | "rightDeckEdge" | "baseFloor"
  | "baseEdge" | "topEdge" | `${string}.${string}`;
```

Grounding examples: `box()` exposes `front/back/left/right/bottom/top`, `topLeftEdge`, `topRightEdge`, `topFrontEdge`, `topBackEdge`, and `topRightRampEdge`; `squarePyramid()` exposes `frontBase/rightBase/backBase/leftBase`; `wedgePrism()` exposes `lowEdge/highEdge/leftDeckEdge/rightDeckEdge/baseFloor`; `rocketFinBase()` exposes `bodyBase/frontFinBase/rightFinBase/backFinBase/leftFinBase`; `tilePrimitive()` exposes generic `edge0..edgeN` plus square and triangle aliases.

## 4. Agent Roles and Interfaces

### PLANNER

Consumes the reviewed reference spec: BOM plus step DAG from `ReferenceBuildEncoding.steps`. Produces `SubassemblyPlan[]` for code-only builders.

```ts
import type { BuildGraph, Inventory } from "@/lib/magnetic-tiles/types";
import type { AuthoredBuildDraft, BuilderTile } from "@/lib/builder/types";
import type { ReferenceBuildEncoding } from "@/lib/reference-encoder/types";
import type { GateBuildResult } from "@/lib/engine";

type DraftTile = BuilderTile;

interface PlannerInput {
  reference: ReferenceBuildEncoding;
  intent: { requiredSubassemblies: string[]; requiredRolePatterns: string[]; requiredFoldAngles: number[]; silhouetteRules: string[] };
  frameRoot: "public/reference-frames/jet-aircraft/steps";
}

interface SubassemblyPlan {
  id: "body" | "nose" | "left-wing" | "right-wing" | "wings" | "tail" | "top-fin" | "aircraft" | string;
  title: string;
  dependsOn: string[];
  referenceStepIds: string[];
  targetFramePaths: string[];
  stepRange: { first: number; last: number };
  inventoryBudget: Partial<Inventory>;
  targetRoles: string[];
  macroHints: Array<{ macro: MacroName; params: Record<string, unknown>; portsToExpose?: KnownPortName[] }>;
  geometryTargets: { minHeight?: number; minWidth?: number; maxDepth?: number; symmetryAxis?: "x" | "z"; notes: string[] };
}

interface PlannerOutput { plans: SubassemblyPlan[]; globalInventory: Partial<Inventory>; dag: Array<{ id: string; dependsOn: string[] }> }
```

Jet planning should produce `body`, `nose`, `left-wing`, `right-wing`, `wings`, `tail`, `top-fin`, and `aircraft`. The BOM is pinned from the reviewed encoding: 16 small squares, 9 equilateral triangles, 10 right triangles, 5 isosceles triangles, and 0 large squares.

### BUILDER

Runs per subassembly. It consumes one `SubassemblyPlan` plus prior critic feedback and returns `DraftTile[]` produced through macro calls.

```ts
interface BuilderInput {
  plan: SubassemblyPlan;
  existingDraft?: AuthoredBuildDraft;
  previousFeedback?: CriticFeedback[];
  allowedMacros: MacroName[];
  hardRules: { noFreeformBasisEdits: true; preserveInventoryBudget: true; preserveReferenceStepLabels: true };
}

interface MacroCallSpec {
  macro: MacroName;
  id: string;
  params: Record<string, unknown>;
  attach?: { parentSubassemblyId: string; parentPort: KnownPortName; childPort: KnownPortName; foldAngle?: number; flip?: boolean };
}

interface BuilderOutput {
  subassemblyId: string;
  macroCalls: MacroCallSpec[];
  draftTiles: DraftTile[];
  localConnections: AuthoredBuildDraft["connections"];
  exposedPorts: KnownPortName[];
  inventoryUsed: Partial<Inventory>;
  selfChecks: Array<{ name: string; passed: boolean; actual: unknown }>;
}
```

Jet guidance: body should prefer `box()` or composed `box()`/`openBox()` tube sections; wings should prefer mirrored macro composition plus `attachByPort()`; nose and fins should prefer `squarePyramid()`, `tilePrimitive()`, and port folds where possible.

### ASSEMBLER / COORDINATOR

Composes subassemblies, runs strict assembly, then runs the engine gate. It is the only role allowed to return a gated `BuildGraph`.

```ts
interface CoordinatorInput { draft: AuthoredBuildDraft; builderOutputs: BuilderOutput[]; requiredSubassemblies: string[]; expectedInventory: Partial<Inventory> }
type CoordinatorRejectionKind = "strict-overlap" | "gate-raw-overlap" | "gate-magnetic" | "gate-simulation" | "inventory-mismatch" | "missing-subassembly";
type CoordinatorOutput =
  | { status: "accepted"; graph: BuildGraph; gate: GateBuildResult; draft: AuthoredBuildDraft }
  | { status: "rejected"; rejection: { kind: CoordinatorRejectionKind; reasons: string[]; requeueTarget?: string }; draft: AuthoredBuildDraft };

async function coordinate(draft: AuthoredBuildDraft): Promise<CoordinatorOutput> {
  try {
    const graph = assembleBuildGraph(draft, { strict: true });
    const gate = await gateBuild(graph);
    if (!gate.passed) return { status: "rejected", rejection: classifyGate(gate), draft };
    return { status: "accepted", graph, gate, draft };
  } catch (error) {
    return { status: "rejected", rejection: classifyStrictAssembly(error), draft };
  }
}
```

### VISION CRITIC

Consumes rendered PNGs, reference JPGs, build step index, and draft snapshot. Returns structured feedback. It can suggest macro-level corrections but cannot bypass strict assembly or gate validity.

```ts
interface VisionCriticInput {
  buildId: string;
  stepIndex: number;
  subassemblyId?: string;
  renderedPngPaths: string[];   // verification/<id>/step-05.png
  referenceJpgPaths: string[];  // public/reference-frames/jet-aircraft/steps/05-left-wing.jpg
  draftSnapshot: AuthoredBuildDraft;
  gate?: GateBuildResult;
  compareMode: "deterministic-silhouette" | "vision-llm" | "hybrid";
}

interface Mismatch {
  id: string; stepIndex: number; subassemblyId?: string; severity: "blocker" | "major" | "minor";
  kind: "silhouette" | "missing-subassembly" | "wrong-port" | "wrong-fold-angle" | "wrong-scale" | "wrong-symmetry" | "wrong-step-order" | "camera-unreliable";
  evidence: { renderedPath: string; referencePath: string; metric?: string; expected?: string; actual?: string };
}

interface Correction {
  id: string; targetSubassemblyId: string;
  action: "replace-macro" | "change-macro-param" | "reattach-by-port" | "change-fold-angle" | "mirror-subassembly" | "move-step-range" | "request-system-macro";
  macro?: MacroName;
  port?: { parentPort?: KnownPortName; childPort?: KnownPortName };
  paramsPatch?: Record<string, unknown>;
  foldAngle?: number;
  rationale: string;
  mustStillPass: ["assembleBuildGraph.strict", "gateBuild"];
}

interface CriticFeedback { score: number; mismatches: Mismatch[]; corrections: Correction[]; confidence: number }
```

## 5. Orchestration and Control Flow

```txt
ReferenceBuildEncoding + REFERENCE_INTENT_SPECS
  -> PLANNER -> SubassemblyPlan[]
  -> BUILDER(body | nose | wings | tail | top-fin)
  -> ASSEMBLER/COORDINATOR
       -> assembleBuildGraph(draft, { strict: true })
       -> gateBuild(graph)
       -> reject invalid geometry or physics before rendering
  -> render step/final PNGs to verification/<id>/*.png
  -> VISION CRITIC
       -> per-subassembly critique for steps 01..10
       -> whole-build critique for steps 11..13 and final views
  -> correction filter -> requeue one target BUILDER
  -> stop or iterate
```

Per-subassembly critique maps frames to owners: `body` gets `01-body-start`, `02-body-tall`, `03-body-stands`; `nose` gets `04-nose`; `left-wing` gets `05-left-wing`; `right-wing/wings` gets `06-right-wing` and `07-wings-aligned`; `tail` gets `08-tail-end` and `09-tail-horiz-vert`; `top-fin` gets `10-top-fin`. Whole-build critique uses `11-final-front`, `12-final-side`, `13-final-rear`, plus `verification/<id>/final-front.png`, `final-side.png`, and `final-iso.png`.

```ts
interface LoopStopCriteria {
  maxIterations: 5;
  minCriticScore: 0.82;
  minCriticConfidence: 0.70;
  requireStrictAssembly: true;
  requireGatePass: true;
  requireNoBlockerMismatches: true;
  requireInventoryMatch: true;
}
```

If the same mismatch survives two builder attempts, stop draft tweaking and request system work. That follows `docs/build-loop.md`: repeated defects are usually macro/tooling gaps.

## 6. Vision Critic Design

Inputs are render paths, reference frame paths, and build step index:

```ts
const input = {
  renderedPngPaths: ["verification/jet-aircraft/step-07.png"],
  referenceJpgPaths: ["public/reference-frames/jet-aircraft/steps/07-wings-aligned.jpg"],
  stepIndex: 7,
  subassemblyId: "wings"
} satisfies Pick<VisionCriticInput, "renderedPngPaths" | "referenceJpgPaths" | "stepIndex" | "subassemblyId">;
```

Deterministic silhouette diff should use `sharp`, `jimp`, or canvas. Use it when the question is outline, symmetry, relative area, height, or quadrant placement.

```ts
interface SilhouetteMetrics { iou: number; centroidDelta: { x: number; y: number }; areaRatio: number; widthRatio: number; heightRatio: number; leftRightBalance: number; topBottomBalance: number }

async function scoreSilhouette(renderPath: string, referencePath: string): Promise<SilhouetteMetrics> {
  const render = await loadAndNormalizeImage(renderPath);
  const reference = await loadAndNormalizeImage(referencePath);
  const renderMask = alphaOrBackgroundMask(render, { threshold: 24 });
  const referenceMask = foregroundMask(reference, { cropHandsAndText: true, threshold: 32 });
  const alignedRender = alignByBoundingBox(renderMask, referenceMask);
  const intersection = countPixels(and(alignedRender, referenceMask));
  const union = countPixels(or(alignedRender, referenceMask));
  return {
    iou: union === 0 ? 0 : intersection / union,
    centroidDelta: subtractCentroids(centroid(alignedRender), centroid(referenceMask)),
    areaRatio: area(alignedRender) / Math.max(1, area(referenceMask)),
    widthRatio: bbox(alignedRender).width / Math.max(1, bbox(referenceMask).width),
    heightRatio: bbox(alignedRender).height / Math.max(1, bbox(referenceMask).height),
    leftRightBalance: horizontalMassBalance(alignedRender),
    topBottomBalance: verticalMassBalance(alignedRender)
  };
}
```

Good v0.1 thresholds: `iou >= 0.55`, `0.75 <= areaRatio <= 1.35`, `heightRatio >= 0.65` for tail/final-side, and `abs(leftRightBalance) <= 0.18` for final-front.

Vision-LLM scoring should be reserved for semantic or ambiguous questions: whether step 09 shows horizontal tail first with vertical tail on top, whether the final object reads as a jet rather than a flat sprawl, whether the nose points forward, or whether hands/text/camera angle make deterministic diff unreliable.

```ts
interface VisionPromptPayload {
  task: "compare_magnetic_tile_build_to_reference_frame";
  buildId: string;
  stepIndex: number;
  subassemblyId?: string;
  renderedImages: Array<{ path: string; label: string }>;
  referenceImages: Array<{ path: string; label: string }>;
  allowedMacros: MacroName[];
  allowedPorts: KnownPortName[];
  hardFloors: [
    "assembleBuildGraph(draft, { strict: true }) must pass",
    "gateBuild(graph) must pass",
    "no correction may require raw overlaps",
    "no freeform tile basis edits as final authoring"
  ];
  outputSchema: "CriticFeedback";
}
```

Prompt rule: return only `CriticFeedback` JSON; corrections must reference real macro names and ports; prefer `reattach-by-port`, `change-fold-angle`, `mirror-subassembly`, or `change-macro-param`; use `request-system-macro` if current macros cannot express the target. Recommendation: run deterministic diff every iteration, escalate to vision LLM for borderline scores, occluded steps, semantic ordering, and final holistic resemblance.

## 7. Gate as Hard Floor

`assembleBuildGraph(draft, { strict: true })` and `gateBuild()` are non-negotiable floors. The strict assembler calls `assertNoRawOverlaps`; `gateBuild()` repeats raw overlap detection, validates magnetic connections, runs simulation, and only then returns pass/fail reasons.

The critic cannot override this. A visually better correction that creates raw overlaps, disconnected tiles, invalid magnetic edges, unsnapped tiles, or a failing stand simulation is rejected before re-queueing.

```ts
async function correctionCanRequeue(draft: AuthoredBuildDraft, correction: Correction): Promise<boolean> {
  const candidate = applyCorrectionAsDraftPatch(draft, correction);
  const graph = assembleBuildGraph(candidate, { strict: true });
  const gate = await gateBuild(graph);
  return gate.passed;
}
```

For recognizable objects, `gateBuild()` can pass while still noting that resemblance requires human signoff. The vision loop adds that resemblance check; it does not replace the physical gate.

## 8. Minimal POC / Worked Trace

The POC can be a small deterministic critic around the schema above:

```ts
async function deterministicCritique(input: VisionCriticInput): Promise<CriticFeedback> {
  const renderedPath = input.renderedPngPaths[0];
  const referencePath = input.referenceJpgPaths[0];
  const metrics = await scoreSilhouette(renderedPath, referencePath);
  const mismatches: Mismatch[] = [];
  const corrections: Correction[] = [];
  if (metrics.iou < 0.55) {
    mismatches.push({ id: `step-${input.stepIndex}-silhouette-low-iou`, stepIndex: input.stepIndex, subassemblyId: input.subassemblyId, severity: "major", kind: "silhouette", evidence: { renderedPath, referencePath, metric: "iou", expected: ">= 0.55", actual: metrics.iou.toFixed(2) } });
  }
  if (input.subassemblyId === "wings" && Math.abs(metrics.leftRightBalance) > 0.18) {
    mismatches.push({ id: `step-${input.stepIndex}-wing-asymmetry`, stepIndex: input.stepIndex, subassemblyId: "wings", severity: "blocker", kind: "wrong-symmetry", evidence: { renderedPath, referencePath, metric: "leftRightBalance", expected: "<= 0.18", actual: metrics.leftRightBalance.toFixed(2) } });
    corrections.push({ id: "mirror-right-wing-from-left-wing", targetSubassemblyId: "right-wing", action: "mirror-subassembly", macro: "mirroredPair", paramsPatch: { axis: "x", origin: 0 }, rationale: "Reference step shows matched left/right wings; current silhouette mass is one-sided.", mustStillPass: ["assembleBuildGraph.strict", "gateBuild"] });
  }
  return { score: clamp01(0.7 * metrics.iou + 0.3 * (1 - Math.abs(metrics.leftRightBalance))), mismatches, corrections, confidence: 0.8 };
}
```

Worked jet cycle: use step `07-wings-aligned`, reference `public/reference-frames/jet-aircraft/steps/07-wings-aligned.jpg`, and render `verification/jet-aircraft/step-07.png`. Suppose deterministic metrics return `iou = 0.48`, `leftRightBalance = 0.31`, `heightRatio = 0.92`, and `areaRatio = 1.08`. The critic returns blocker `wrong-symmetry` plus a `mirror-subassembly` correction using `mirroredPair`; optionally it can suggest `attachByPort` from an exposed fuselage side port such as `fuselage.left`/`fuselage.right` to triangle child port `base`, with a small fold angle only if strict assembly and `gateBuild` still pass.

```json
{
  "score": 0.51,
  "confidence": 0.8,
  "mismatches": [{ "id": "step-7-wing-asymmetry", "stepIndex": 7, "subassemblyId": "wings", "severity": "blocker", "kind": "wrong-symmetry", "evidence": { "renderedPath": "verification/jet-aircraft/step-07.png", "referencePath": "public/reference-frames/jet-aircraft/steps/07-wings-aligned.jpg", "metric": "leftRightBalance", "expected": "<= 0.18", "actual": "0.31" } }],
  "corrections": [{ "id": "mirror-right-wing-from-left-wing", "targetSubassemblyId": "right-wing", "action": "mirror-subassembly", "macro": "mirroredPair", "paramsPatch": { "axis": "x", "origin": 0 }, "rationale": "The reference shows wings aligned on both sides of the body.", "mustStillPass": ["assembleBuildGraph.strict", "gateBuild"] }]
}
```

Builder receives the correction, regenerates `right-wing`, and returns new `DraftTile[]`. Coordinator immediately runs `assembleBuildGraph(draft, { strict: true })` and `gateBuild(graph)`. If the reattach overlaps the body or creates an invalid edge, the correction is rejected and the builder tries a different port/fold, not a gate bypass.

## 9. Pros and Cons

Pros: typed visual review, repeatable requeueable feedback, impossible builds rejected early, deterministic checks for outline/area/symmetry/height/missing parts, and explicit `request-system-macro` pressure when the macro vocabulary cannot express the target.

Cons: vision-LLM calls add latency and cost across 13 frames plus final views; LLM corrections are nondeterministic and can overfit to camera artifacts; deterministic diff misses semantic ordering, hidden rear attachments, correct tile type usage, magnet plausibility, and final "reads as a jet" judgment; pixel diff depends on stable camera framing; correction filtering is mandatory.

Deterministic diff is cheap and should cover gross geometry. Vision LLM is expensive and should cover semantics, ambiguity, poor angles, and final resemblance.

## 10. Risks and Unknowns

- `scripts/render-draft.ts` has a camera hook fallback: if `setCameraView` cannot access the R3F store, it reloads and uses orbit deltas, which can make PNG comparison inconsistent.
- Vision-LLM nondeterminism means corrections must be treated as hypotheses, not authority.
- Reference frame 08 has poor rear-tail angle by its own overlay; critic should emit `camera-unreliable`.
- The reviewed encoding says "upright body column" while `docs/jet-rebuild-target.md` argues the durable rebuild should be a horizontal square tube. Planner should privilege the durable target for geometry while retaining BOM and step DAG.
- Current ports may not expose the exact lower side edge needed for low wing placement on a long tube. Repeated failure should trigger a system macro request such as `fuselageBox` or `wingPair`.
- Inventory matching can conflict with resemblance if macro composition consumes extra squares.

## 11. Effort

Effort: M. The repo already has reference encodings, macro composition, strict assembly, engine gate, render output, and extracted frames; missing work is orchestration glue, deterministic image scoring, typed feedback contracts, correction filtering, and a calibrated vision prompt.

First milestone for v0.1:

```txt
Given the jet reference encoding and a candidate jet draft:
1. Produce SubassemblyPlan[] for body, nose, wings, tail, top-fin, and aircraft.
2. Run strict assembly and gateBuild before visual critique.
3. Compare step-07 and final-front with deterministic silhouette metrics.
4. Emit CriticFeedback JSON with one macro/port-grounded correction.
5. Requeue exactly one target subassembly only if the correction survives strict assembly and gateBuild.
```

Done means one full critic-to-builder cycle on the jet runs without changing the engine, weakening the gate, or relying on freeform tile basis edits.

## 12. Verdict

Verdict: build it, with deterministic scoring as the default and vision LLM reserved for semantic or ambiguous frames.

Why: the codebase already has hard physical gates and reference artifacts; the unreliable part is visual resemblance feedback, and a typed critic loop adds that without weakening the geometry floor.

Summary - verdict: Build the multi-agent vision loop with deterministic-first critique.
Summary - effort: M, mostly orchestration, image scoring, schemas, and prompt calibration.
Summary - key risk: render camera inconsistency plus nondeterministic LLM corrections.
Summary - first milestone: one gated jet step-07 critic-to-builder correction cycle.
Summary - reliability requirement: every visual correction must be revalidated by strict assembly and gateBuild before it can count.
