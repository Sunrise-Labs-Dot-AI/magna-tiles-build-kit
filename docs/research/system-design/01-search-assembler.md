# Search-Based Assembler for Recognizable Magnatiles Builds

## 1. Approach

Use bounded search over partial `AuthoredBuildDraft` states, adding one tile or macro attachment at
a time. Prune impossible states immediately with the existing overlap/strict assembly path, and rank
survivors with an explicit recognizability score based on BOM, step DAG, subassemblies, fold angles,
and silhouette intent.

Recommended first implementation: beam search. Greedy is a baseline; MCTS is only worth revisiting
after the heuristic and macro action set are proven.

## 2. Target Representation Consumed

Consume these existing sources:

- `lib/reference-encoder/types.ts`: `ReferenceBuildEncoding`, `ReferenceEncodingStep`, BOM, step DAG.
- `lib/reference-encoder/examples/jet-aircraft-reference.ts`: `JET_AIRCRAFT_REFERENCE_ENCODING`.
- `docs/jet-rebuild-target.md`: durable jet geometry intent.
- `public/reference-frames/jet-aircraft/steps/*.jpg`: later visual scoring inputs.
- `lib/reference-encoder/reference-acceptance.ts`: intent predicates, with one discrepancy below.

Important discrepancy: `REFERENCE_INTENT_SPECS` exists in `reference-acceptance.ts`, but it is not
exported. The assembler cannot import it as-is. First production change should export it or move a
neutral `ReferenceIntentSpec` to a shared module.

Useful existing construction APIs:

- `lib/magnetic-tiles/macros.ts`: `tilePrimitive`, `box`, `squarePyramid`, `triangularPrism`,
  `radialFan`, `composeMacros`, `mirrorMacro`, `attachByPort`, `joinByPorts`,
  `EDGE_LENGTH_CLASS_JOIN_MATRIX`, `edgeLengthClassForShapeEdge`, `canJoinFullEdges`.
- `lib/builder/operations.ts`: `createEmptyDraft`, `addRootTile`, `previewEdgeSnappedTile`,
  `addEdgeSnappedTile`, `draftToBuildGraph`, `assembleBuildGraph(draft, { strict: true })`.
- `lib/engine/index.ts`: `gateBuild`, `findRawOverlaps`, `assertNoRawOverlaps`.

Normalize a target into:

```ts
interface SearchTarget {
  id: string;
  encoding: ReferenceBuildEncoding;
  expectedInventory: Inventory;
  requiredSubassemblies: string[];
  requiredRolePatterns: RegExp[];
  requiredFoldAngles: number[];
  silhouetteRules: Array<{ description: string; predicate: (bounds: BuildBounds) => boolean }>;
  stepOrder: Map<string, string[]>;
  referenceFrameSrcs: string[];
}
```

For jet, reuse the current intent:

- required subassemblies: `body`, `nose`, `wings`, `tail`, `top-fin`
- role patterns: `/fuselage/i`, `/nose|wing/i`, `/brace/i`, `/tail|fin/i`
- required folds: `0`, `Math.PI / 2`, `-Math.PI / 2`
- silhouette predicates: `bounds.width > bounds.depth * 1.2`, `bounds.height >= 9`
- BOM: 16 small squares, 9 equilateral triangles, 10 right triangles, 5 isosceles triangles

`docs/jet-rebuild-target.md` adds the practical shape prior: horizontal square-tube fuselage,
pointed nose, wide low wings, rear/top fins, and broad stable footprint.

## 3. Core Algorithm as Concrete Pseudocode

State:

```ts
interface SearchState {
  draft: AuthoredBuildDraft;
  graph: BuildGraph;
  remainingInventory: Inventory;
  completedSteps: Set<string>;
  score: RecognitionScore;
  history: SearchAction[];
}

interface SearchAction {
  kind: "attach-tile" | "attach-macro";
  parentTileId?: string;
  parentEdge?: number;
  parentPortName?: string;
  childShape?: TileShape;
  childEdge?: number;
  childMacro?: TileMacro;
  childPortName?: string;
  foldAngle: number;
  reverse?: boolean;
  role: string;
  subassemblyId: string;
  stepId?: string;
}
```

Beam loop:

```ts
async function assembleSearch(target: SearchTarget): Promise<BuildGraph | null> {
  let beam = [scoreAndIndex(seedInitialState(target), target)];

  for (let depth = 0; depth < maxTiles(target); depth += 1) {
    const candidates: SearchState[] = [];

    for (const state of beam) {
      for (const action of enumerateActions(state, target)) {
        const next = tryApplyAction(state, action, target);
        if (!next) continue;
        const scored = scoreAndIndex(next, target);
        if (!scored.score.hardInvalid) candidates.push(scored);
      }
    }

    beam = dedupeBySignature(candidates)
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, beamWidth);

    const complete = beam.find((state) => isTargetComplete(state, target));
    if (complete) {
      const graph = assembleBuildGraph(complete.draft, { strict: true });
      if ((await gateBuild(graph)).passed) return graph;
    }
  }

  return bestGatePassingCandidate(beam);
}
```

Seed:

```ts
function seedInitialState(target: SearchTarget): SearchState {
  const draft = addRootTile(createEmptyDraft(target.encoding.buildLabel), {
    shape: "small-square",
    role: "jet fuselage body square",
    subassemblyId: "body",
    step: 1
  });
  return indexState(draft, assembleBuildGraph(draft, { strict: true }), target);
}
```

Low-level action generation:

```ts
function enumerateTileActions(state: SearchState, target: SearchTarget): SearchAction[] {
  const actions: SearchAction[] = [];
  for (const parent of state.draft.tiles) {
    for (let parentEdge = 0; parentEdge < TILE_SPECS[parent.shape].maxEdges; parentEdge += 1) {
      for (const childShape of candidateShapesForNextStep(state, target)) {
        for (let childEdge = 0; childEdge < TILE_SPECS[childShape].maxEdges; childEdge += 1) {
          if (
            edgeLengthClassForShapeEdge(parent.shape, parentEdge) !==
            edgeLengthClassForShapeEdge(childShape, childEdge)
          ) continue;
          for (const foldAngle of legalFolds(parent, parentEdge, childShape, childEdge, target)) {
            for (const reverse of [false, true]) {
              actions.push({ kind: "attach-tile", parentTileId: parent.id, parentEdge,
                childShape, childEdge, foldAngle, reverse, ...labelForNextStep(state, target) });
            }
          }
        }
      }
    }
  }
  return actions;
}
```

Low-level application:

```ts
function tryApplyTileAction(state: SearchState, action: SearchAction): SearchState | null {
  const nextDraft = addEdgeSnappedTile(state.draft, {
    parentTileId: action.parentTileId!,
    parentEdge: action.parentEdge!,
    childShape: action.childShape!,
    childEdge: action.childEdge!,
    foldAngle: action.foldAngle,
    reverse: action.reverse ?? false,
    role: action.role,
    subassemblyId: action.subassemblyId,
    step: nextStepNumber(state, action)
  });

  if (nextDraft.tiles.length === state.draft.tiles.length) return null;

  try {
    const graph = assembleBuildGraph(nextDraft, { strict: true });
    return indexState(nextDraft, graph, target);
  } catch {
    return null;
  }
}
```

Macro application uses the same pruning boundary:

```ts
const child = tilePrimitive({ id, shape, role, subassemblyId, stepStart });
const joined = attachByPort(parentMacro, parentPort, child, childPort, { foldAngle, flip });
const nextDraft = macroToDraft(joined, state.draft);
const graph = assembleBuildGraph(nextDraft, { strict: true });
```

Use macro actions for known motifs: body `box`, nose `squarePyramid`, wing mirrored pairs with
`mirrorMacro`, and tail/top-fin triangle modules.

## 4. How Recognizability Is Scored

Return a scalar plus diagnostics:

```ts
interface RecognitionScore {
  total: number;
  hardInvalid: boolean;
  bom: number;
  subassembly: number;
  roles: number;
  folds: number;
  silhouette: number;
  jetSpecific: number;
  constructionOrder: number;
  stabilityProxy: number;
}
```

BOM score: count `graph.tiles` by shape and reward partial progress without allowing overrun.
Final candidates should require exact target BOM unless intentionally producing a smaller sketch.

Subassembly score: coverage of `body`, `nose`, `wings`, `tail`, `top-fin` from `tile.subassemblyId`.
For jet, weight body/wings/nose/tail/top-fin as `0.25/0.25/0.20/0.20/0.10`.

Role score:

```ts
roles = coverage([/fuselage/i, /nose|wing/i, /brace/i, /tail|fin/i], pattern =>
  graph.tiles.some(tile => pattern.test(`${tile.role} ${tile.subassemblyId ?? ""}`))
);
```

Fold score mirrors `reference-acceptance.ts` quarter-turn normalization:

```ts
function normalizeFoldAngle(angle: number): string {
  return (Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)).toFixed(2);
}
```

Silhouette score uses `graph.bounds`, which `builder/operations.ts` calculates from
`tileWorldVertices`:

```ts
const widthRatio = graph.bounds.depth <= 0.001 ? 0 : graph.bounds.width / graph.bounds.depth;
const wideScore = clamp01((widthRatio - 0.8) / 0.4); // reaches 1 at 1.2x
const finHeightScore = clamp01(graph.bounds.height / 9);
silhouette = 0.6 * wideScore + 0.4 * finHeightScore;
```

Jet-specific score:

- body tube: 16 small-square body tiles trending toward a 4-segment tube
- wing span: mirrored wing tiles increase width and low footprint
- nose point: nose contains triangular tiles
- tail fin: tail/top-fin tiles include vertical `±Math.PI / 2` folds

Suggested total:

```ts
total =
  0.15 * bom +
  0.18 * subassembly +
  0.12 * roles +
  0.10 * folds +
  0.20 * silhouette +
  0.18 * jetSpecific +
  0.04 * constructionOrder +
  0.03 * stabilityProxy;
```

Construction order uses `ReferenceEncodingStep.dependsOn`. For jet, body must precede nose, wings
must precede tail, and horizontal tail should precede vertical/top fin.

## 5. Gate and Overlap Guard: Prune vs Validate

During search:

- `addEdgeSnappedTile` calls `overlapsInvolvingTile`; unchanged tile count means prune.
- `assembleBuildGraph(draft, { strict: true })` calls `assertNoRawOverlaps`; catch and prune.
- `findRawOverlaps` is useful for diagnostics and learned penalties.
- edge-class mismatch should be pruned before placement via `edgeLengthClassForShapeEdge` or
  `canJoinFullEdges`.

Final validation:

- run `gateBuild(graph)` only on complete or top-ranked states
- it pre-filters raw overlaps, validates magnetic joins, runs `simulate().stands`, and runs
  `rollTest` for ramps
- for non-ramps, the gate explicitly does not validate resemblance, so recognizability must remain
  in the search score and later visual/human signoff

## 6. Minimal Runnable POC

Created the optional scratch POC:

- `scripts/research/01-search-poc.ts`

It starts from one square, enumerates edge-snap actions, applies `addEdgeSnappedTile`, prunes
unchanged/strict-invalid drafts, and ranks a small beam by a toy aircraft-like score.

Command attempted exactly as requested:

```bash
npx vite-node --config vitest.config.ts scripts/research/01-search-poc.ts
```

No script stdout was produced because `vite-node` is not installed locally and `npx` tried to fetch
it from npm, but this environment has restricted network access.

Observed output:

```text
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/vite-node failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
npm error network
npm error network If you are behind a proxy, please make sure that the
npm error network 'proxy' config is set properly.  See: 'npm help config'
npm error Log files were not written due to an error writing to the directory: /Users/jamesheath/.npm/_logs
npm error You can rerun the command with `--loglevel=verbose` to see the logs in your terminal
```

## 7. Pros/Cons of Candidate Algorithms

Greedy best-first:

- pros: simplest, fast, easy to debug, useful after macro structure is known
- cons: likely to lock into boxy local optima; poor when wings/tail only pay off after several moves
- use as a baseline, not the main assembler

Beam search:

- pros: keeps multiple plausible partial builds, bounds cost, works well with strict pruning, gives
  inspectable histories, can follow reference DAG stages
- cons: heuristic-sensitive, needs dedupe/canonicalization, can still prune late-blooming branches
- use for first production milestone

MCTS:

- pros: better for long-horizon reward and unusual fold exploration
- cons: rollout policy is hard, strict assembly calls are expensive, debug traces are noisier
- defer until beam search exposes a specific failure that MCTS can address

## 8. Risks and Unknowns

- `REFERENCE_INTENT_SPECS` is not exported.
- Jet acceptance height (`bounds.height >= 9`) needs careful interpretation with the low horizontal
  fuselage described in `docs/jet-rebuild-target.md`.
- Builder legal folds are file-local (`SNAP_FOLDS`), while macro fold helpers are public; centralize
  legal fold policy before production search.
- Single-tile branching is large; macro actions are needed for tractability.
- Axis-aligned `BuildGraph.bounds` can mis-score rotated candidates unless pose is normalized.
- Visual recognizability probably needs rendered frame comparison later.
- `gateBuild` is too expensive for inner-loop use.
- XL/long edge behavior needs care because `XL_SQUARE_EDGE` currently equals `LARGE_EDGE`, while
  macro edge classes still distinguish `xl`.

## 9. Effort Estimate and First Milestone

Estimate: M.

Reasons: strict geometry, gate, reference encodings, BOMs, and macro ports already exist. New work is
search orchestration, shared intent spec export, recognizability scoring, state dedupe, and trace
output.

First milestone:

- beam-search assembler for the reviewed jet target
- imports `JET_AIRCRAFT_REFERENCE_ENCODING`
- consumes exported/shared jet intent spec
- starts from a body seed
- enumerates legal edge-class actions
- prunes with `assembleBuildGraph(draft, { strict: true })`
- scores BOM, subassemblies, roles, folds, silhouette, and jet-specific priors
- emits top 3-10 strict-valid candidates with score breakdown and action history
- at least one candidate includes body, nose, wings, tail, and top-fin labels

## 10. Verdict

VERDICT: recommend. Beam search adds the missing recognizability objective while reusing the strict
assembler, edge-class rules, reference DAG, BOM, and macro ports already present in the codebase.

## 5-Line Summary

Verdict: recommend beam search first; greedy is baseline and MCTS is deferred.
Effort: M; infrastructure exists, but scoring/search orchestration is new.
Key risk: weak recognizability heuristics can still reward boxy impostors.
POC result: scratch POC created; requested `vite-node` runner unavailable due network-restricted `npx` fetch.
Next milestone: strict-assembly-valid jet candidates with score breakdowns and action histories.
