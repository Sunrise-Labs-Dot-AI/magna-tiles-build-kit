# 03 - Voxel Target Fitting for Recognizable Magnatiles Builds

## 1) Approach overview

Geometry-first target fitting should add a recognizability objective before the
existing physical gate. Build a coarse target shell from reference views or an
object-class proxy, search legal tile placements that cover that shell, then
emit only builds that survive the existing overlap, magnetic-join, stand, and
roll checks.

The generator should stop asking "which template looks like a jet?" and start
asking "which legal Magnatiles shell best covers the jet target from front,
side, and rear?"

## 2) Target shell

Two target sources are useful.

### A. Silhouette visual hull

For reviewed targets, use the final reference views:

- `public/reference-frames/jet-aircraft/steps/11-final-front.jpg`
- `public/reference-frames/jet-aircraft/steps/12-final-side.jpg`
- `public/reference-frames/jet-aircraft/steps/13-final-rear.jpg`
- `docs/jet-rebuild-target.md`

Process:

1. Segment each reference frame into a foreground mask.
2. Normalize scale using app units from `lib/magnetic-tiles/catalog.ts`.
3. Carve a voxel volume by projecting each voxel into the compatible masks.
4. Keep only surface voxels, because real Magnatiles builds are shells.

Representation:

```ts
type VoxelKey = `${number},${number},${number}`;

interface TargetShell {
  voxelSize: number; // app units; SMALL_EDGE === 3
  occupied: Set<VoxelKey>; // shell voxels, not solid fill
  views: TargetSilhouette[];
  landmarks?: Record<string, VoxelKey[]>; // nose, wings, tail, fin
}

interface TargetSilhouette {
  view: "front" | "side" | "rear" | "top";
  width: number;
  height: number;
  mask: Uint8Array;
}
```

This gives the most direct metric: reproject a build and compare silhouettes.
It is strongest for reviewed references but weak at resolving hidden depth and
concavity.

### B. Parametric proxy shell

For prompt-only targets or ambiguous views, build a proxy from object priors.
For aircraft, components are fuselage tube, nose cone, left/right wings,
horizontal tail, vertical tail, and optional top fin.

`docs/jet-rebuild-target.md` is the key proxy input for the jet: the real body is
a horizontal square tube lying on its belly, not a tall tower. App dimensions are
scaled: `SMALL_EDGE === 3`, `LARGE_EDGE === 6`, `TILE_THICKNESS === 0.18`.

```ts
interface ProxyShellComponent {
  id: string;
  kind: "box-shell" | "triangle-panel" | "pyramid-shell" | "plane-panel";
  transform: { position: Vec3; basis: TileBasis };
  dimensions: Record<string, number>;
  landmarkRole?: "fuselage" | "nose" | "wing" | "tail" | "fin";
  weight: number;
}
```

Voxelize proxy components at `SMALL_EDGE / 4` or `SMALL_EDGE / 6`, then compare
build shells against those weighted voxels.

## 3) Placement / covering algorithm

Use shell set cover over legal tile placements. A candidate placement contributes
covered target voxels and costs for excess volume, silhouette mismatch,
inventory pressure, weak landmarks, and physical risk.

Reuse existing APIs:

- composition: `attachByPort()`, `joinByPorts()`, `composeMacros()`,
  `tilePrimitive()`, `box()`, `squarePyramid()`, `mirroredPair()` in
  `lib/magnetic-tiles/macros.ts`
- legal edge placement: `makeAnchorTile()`, `attachTile()` in
  `lib/magnetic-tiles/edge-attachment.ts`
- builder lattice: `previewEdgeSnappedTile()`, `addEdgeSnappedTile()`,
  `draftToBuildGraph()`, `assembleBuildGraph()` in `lib/builder/operations.ts`
- geometry: `tileWorldVertices()` in `lib/magnetic-tiles/magnet-geometry.ts`
- prism/normal checks: `tilePrismVertices()`, `tileNormal()`,
  `tilesIntersectAsPrisms()` in `lib/magnetic-tiles/prism-geometry.ts`
- hard overlap guard: `findRawOverlaps()`, `assertNoRawOverlaps()` in
  `lib/engine/overlap.ts`
- final gate: `gateBuild()` in `lib/engine/gate.ts`

Pseudocode:

```ts
function fitTarget(target: TargetShell, inventory: Inventory): BuildGraph {
  let beam = seedAnchorsFromProxy(target).map((anchor) =>
    placeRoot(createEmptyDraft("target-fit"), anchor)
  );

  while (!searchDone(beam)) {
    const expanded: CandidateState[] = [];

    for (const state of beam) {
      for (const frontier of exposedEdgesNearUncoveredVoxels(state, target)) {
        for (const shape of legalShapesRemaining(state, inventory)) {
          for (const childEdge of edges(shape)) {
            for (const foldAngle of foldAnglesForTargetNormal(frontier, target)) {
              for (const reverse of [false, true]) {
                const preview = previewEdgeSnappedTile(state.draft, {
                  parentTileId: frontier.tileId,
                  parentEdge: frontier.edge,
                  childShape: shape,
                  childEdge,
                  foldAngle,
                  reverse,
                  edgeFit: "auto",
                  role: inferRole(frontier),
                  subassemblyId: inferSubassembly(frontier),
                  step: state.nextStep
                });
                if (!preview) continue;

                const nextDraft = addEdgeSnappedTile(state.draft, {
                  parentTileId: frontier.tileId,
                  parentEdge: frontier.edge,
                  childShape: shape,
                  childEdge,
                  foldAngle,
                  reverse,
                  edgeFit: "auto",
                  role: preview.role,
                  subassemblyId: preview.subassemblyId,
                  step: state.nextStep
                });

                const graph = draftToBuildGraph(nextDraft);
                if (findRawOverlaps(graph.tiles).length > 0) continue;
                if (!withinInventory(graph.tiles, inventory)) continue;
                expanded.push(scoreState(nextDraft, target));
              }
            }
          }
        }
      }
    }

    beam = keepTopK(expanded, 50);
  }

  return assembleBuildGraph(beam[0].draft, { strict: true });
}
```

Scoring:

```ts
function scoreState(draft: AuthoredBuildDraft, target: TargetShell): Score {
  const graph = draftToBuildGraph(draft);
  const buildShell = voxelizeTilePrisms(graph.tiles);
  return {
    voxelIoU: iou(buildShell.occupied, target.occupied),
    targetCoverage: intersection(buildShell.occupied, target.occupied) / target.occupied.size,
    excess: difference(buildShell.occupied, target.occupied).size / buildShell.occupied.size,
    viewScore: averageSilhouetteIoU(graph.tiles, target.views),
    landmarkScore: weightedLandmarkCoverage(graph.tiles, target.landmarks),
    joinCount: graph.connections.length
  };
}
```

Placement is legal-join driven. Scoring is geometry/vision driven. Acceptance is
still gate driven.

## 4) Recognizability metric

Use voxel shell IoU plus multi-view silhouette IoU.

```text
voxelIoU = |buildShell ∩ targetShell| / |buildShell ∪ targetShell|
targetCoverage = |buildShell ∩ targetShell| / |targetShell|
excessRatio = |buildShell - targetShell| / |buildShell|
viewScore = mean(frontIoU, sideIoU, rearIoU)
```

This catches "valid but boxy" builds because a fuselage cuboid can pass physical
validation while missing wing, nose, and tail voxels.

Initial experimental thresholds:

```text
voxelIoU >= 0.35
targetCoverage >= 0.70
excessRatio <= 0.45
mean silhouetteIoU >= 0.60
required landmark coverage >= 0.65
```

Raw IoU will be modest because tiles are sparse shells and the target is coarse.
Coverage, excess, and landmark scores should carry more decision weight.

## 5) Legal joins and gate constraints

The solver should not emit arbitrary freeform `TileInstance`s and then recover
connections later. It should grow the build through the legal magnetic lattice.

Hard constraints:

1. Every non-root tile should come from `attachTile()`, `attachByPort()`,
   `joinByPorts()`, or `addEdgeSnappedTile()` where possible.
2. Edges come from `tileLocalVertices()` and `TILE_SPECS[shape].maxEdges`.
3. Fold angles start discrete: `0`, `±Math.PI / 2`, `±Math.PI / 4`,
   `±Math.PI / 3`; add arbitrary folds only when target normals justify them.
4. Reject any candidate with `findRawOverlaps(tiles).length > 0`.
5. Emit through `assembleBuildGraph(draft, { strict: true })`.
6. Final acceptance remains `await gateBuild(graph)`.

Important existing behavior:

- `RAW_OVERLAP_TOLERANCE` is `0.03`; do not widen it for fitting.
- `addEdgeSnappedTile()` refuses overlaps involving the new tile.
- `findMagneticEdgeMatch()` supports centered partial edge matches, useful for
  large/small edge contacts.
- `gateBuild()` currently says recognizable-object resemblance needs human
  signoff; this proposal supplies the missing quantitative resemblance layer.

## 6) Minimal runnable POC

Scratch file:

```text
scripts/research/03-voxel-poc.ts
```

Allowed command:

```bash
npx vite-node --config vitest.config.ts scripts/research/03-voxel-poc.ts
```

The POC demonstrates one core mechanism: voxel shell scoring. It builds a coarse
aircraft target from a box fuselage plus triangular wings, defines actual
`TileInstance` placements with explicit `TileBasis`, uses `tileLocalVertices()`
to test whether voxel centers are inside real tile polygons, calls
`findRawOverlaps()`, and prints a table comparing "body only" with
"body + coarse wings".

Expected behavior:

- "body only" covers fuselage voxels but misses most wing voxels.
- "body + coarse wings" improves target coverage and IoU.
- raw overlap counts, if present, remain a validity signal for the legal lattice
  to fix before gate acceptance.

Observed run in this workspace:

```text
npx vite-node --config vitest.config.ts scripts/research/03-voxel-poc.ts
```

The command did not execute the script. `vite-node` is not installed locally, so
`npx` attempted to fetch it from `https://registry.npmjs.org`; restricted network
access failed with `ENOTFOUND registry.npmjs.org`. No dev server or render server
was run. The POC is ready for the same command once `vite-node` exists locally.

## 7) Pros / cons

Pros:

- Optimizes recognizability directly.
- Reuses existing tile geometry and physical validity code.
- Separates target fit from hard validity.
- Gives debuggable failures: missing wing voxels, poor side silhouette, excess
  body volume, uncovered tail landmark.
- Works for reviewed references and prompt-only proxies.
- Can start with greedy/beam search before ILP.

Cons:

- Three-view visual hulls are ambiguous.
- Legal snapping can move a visually ideal placement off target.
- Voxel IoU rewards overfilling unless excess is penalized.
- Candidate expansion can explode.
- Physical simulation may reject high-scoring shells.
- Real builds use subassemblies, so single-tile growth is not enough long term.

## 8) Risks / unknowns

Silhouette-to-3D ambiguity:
front/side/rear masks cannot infer hidden concavity or construction technique.
For the jet, the visual hull alone may fit a solid box unless the fuselage-tube
prior and BOM are included.

Mitigation:
use visual hull for scoring, not sole reconstruction; add object priors,
landmarks, `ReferenceBuildEncoding` BOM, and step-derived subassemblies.

Lattice snapping:
target surfaces may ask for normals or offsets no magnetic join can realize.
Snapping to `attachTile()` can reduce recognizability.

Mitigation:
score snap delta, bin normals into likely folds, seed known macro chunks, and
keep unsnapped placements only as diagnostics.

Sparse shell scoring:
solid targets punish valid shell builds.

Mitigation:
strip interior target voxels, report coverage and excess separately, and weight
landmarks like wings/tail/nose.

Candidate explosion:
edge x shape x childEdge x fold x reverse grows fast.

Mitigation:
expand only frontier edges near uncovered voxels, cache coverage, use beam
search first, and introduce ILP only after candidate generation is bounded.

## 9) Effort and first milestone

Effort: L for the full system, M for the first recognizability scorer.

First milestone: build a non-generative scorer that separates the reviewed jet
recipe from a boxy ablation.

Deliverables:

1. Create a parametric jet proxy shell from `docs/jet-rebuild-target.md`.
2. Voxelize the proxy shell.
3. Voxelize candidate tile prisms from existing build geometry.
4. Report voxel IoU, target coverage, excess, and landmark coverage.
5. Project front/side/rear silhouettes against the jet final frames.
6. Score reviewed jet, old boxy fallback, and fuselage-only ablation.
7. Start legal beam search only after the scorer separates good from bad.

First generator milestone:

1. fit fuselage tube;
2. fit wings;
3. fit tail/fin landmarks;
4. assemble through `assembleBuildGraph(draft, { strict: true })`;
5. run `gateBuild(graph)`.

## 10) Verdict

VERDICT: pursue geometry-first target fitting, but build the scorer before the
solver. The repo already has physical validity machinery; the missing component
is a quantitative recognizability objective that can reject gate-valid but
unrecognizable boxes.

Best path:

1. parametric jet proxy shell;
2. voxel and silhouette scorer;
3. known-good versus known-bad comparison;
4. legal beam search;
5. visual-hull reconstruction for reviewed references after the scorer works.

## 5-line summary

Verdict: yes - add geometry-first target fitting as a recognizability layer before `gateBuild()`.
Effort: L full system, M for first scorer milestone.
Key risk: legal edge lattice snapping can erase the best visual fit.
POC result: scratch POC created; exact `npx vite-node ...` run was blocked because missing `vite-node` triggered a restricted-network fetch.
Next step: score the existing jet recipe against a boxy ablation, then begin legal beam search only after the scorer separates them.
