# 04 - Parametric Optimizer Research

## 1) Approach

Use a parametric jet template that emits real `TileMacro` geometry, converts that macro into an
`AuthoredBuildDraft`, and scores the resulting `BuildGraph` with codebase validators before any
human visual iteration.

The optimizer should search over a small set of interpretable geometry parameters, then treat
`assembleBuildGraph`, `gateBuild`, `findRawOverlaps`, and `simulate` as the feedback loop between
recognizable aircraft intent and physically valid magnetic-tile construction.

Grounding note: the prompt named `examples/jet-aircraft-reference.ts` and root
`reference-acceptance.ts`, but the files found in this repo are
`lib/reference-encoder/examples/jet-aircraft-reference.ts` and
`lib/reference-encoder/reference-acceptance.ts`.

## 2) Jet Template Parameterization

Use the macro layer as the template boundary because `lib/magnetic-tiles/macros.ts` already
exports `TileMacro`, `MacroPort`, `attachByPort`, `composeMacros`, `mirrorMacro`, `placeMacro`,
`box`, `squarePyramid`, `triangularPrism`, `radialFan`, `wedgePrism`, and `tilePrimitive`.

Concrete parameter set:
- `fuselageLengthTiles: integer`
  - Maps to `box({ id: "fuselage", width: 1, height: 1, depth: fuselageLengthTiles })`.
  - This follows `docs/jet-rebuild-target.md`: 16 small squares imply a four-segment square tube.
  - For an open tube, use `openFaces: ["front", "back"]`.
  - Current limitation: `box` only emits ports for faces that are not open, so an open front/back
    tube does not expose `"front"` or `"back"` ports.
- `fuselageCrossSectionWidth: integer`
  - Maps to `box.width`.
  - Default should stay `1`, matching a square tube rather than a wide cabin.
  - Wider cross-sections should be soft-penalized because the jet reference BOM has exactly
    16 `small-square` body tiles.
- `fuselageCrossSectionHeight: integer`
  - Maps to `box.height`.
  - Default should stay `1`.
  - A taller body risks violating the "low CG, wide stance" reading in `docs/jet-rebuild-target.md`.
- `fuselageOpenEnds: boolean`
  - Maps to `box.openFaces`.
  - `true` means `openFaces: ["front", "back"]`.
  - `false` keeps front/back panels and exposes `box` ports `"front"` and `"back"` for direct
    `attachByPort`.
- `noseDepthTiles: integer`
  - POC maps this to `placeMacro(squarePyramid(...), { z: -SMALL_EDGE * (noseDepthTiles + 1) })`.
  - Production should prefer `attachByPort(fuselage, "front", squarePyramid(...), "backBase", ...)`
    when the fuselage uses a closed adapter face.
  - If the square tube remains open, add a small `tilePrimitive({ shape: "small-square" })` adapter
    or a dedicated macro port on the tube lip before joining the nose.
- `noseSharpness: continuous 0..1`
  - `squarePyramid` does not expose a sharpness field.
  - Approximate with alternative macros: `squarePyramid` for high sharpness, `radialFan` with fewer
    `segments` for a fan-like nose, or a custom chain of `tilePrimitive` triangles.
  - This must be documented as an indirect parameter, not a current field on `SquarePyramidParams`.
- `noseFoldAngle: continuous radians`
  - Maps to `attachByPort(..., { foldAngle: noseFoldAngle })` when the nose is attached by ports.
  - Use `arbitraryFold`, `rightAngleFold`, or raw `attachByPort` depending on whether the fold is
    constrained to quarter-turns or searched continuously.
- `wingCountPerSide: integer`
  - Maps to repeated `tilePrimitive({ shape: "right-triangle", plane: "horizontal" })` or
    `triangularPrism` modules.
  - Use `composeMacros(...leftWingSegments)` for one side.
  - Use `mirrorMacro(leftWing, "x", origin)` or `mirroredPair` for symmetry.
- `wingSpanTiles: integer`
  - Maps to the number of repeated wing tiles or repeated macro segments.
  - In the POC, `wingSpan` controls how many right-triangle `tilePrimitive` macros are placed
    before mirroring.
  - In production, the best form is likely a subassembly joined with `attachByPort` to lower side
    faces, matching the target doc's "large triangular panels splayed WIDE and nearly flat."
- `wingSweepRadians: continuous`
  - Maps to the `facing` argument on `placeMacro` or to `startAngle` when using `radialFan`.
  - If built from attached wing modules, sweep can also be represented by choosing parent/child
    ports plus a small yaw transform before `attachByPort`.
- `wingDihedralRadians: continuous`
  - Maps to `attachByPort(..., { foldAngle: wingDihedralRadians })`.
  - Keep near-flat values preferred because `docs/jet-rebuild-target.md` says the wings are "wide
    and nearly flat" and contribute to the support footprint.
- `wingAttachmentZ: continuous`
  - Maps to which fuselage side tile/port receives the wing.
  - With current `box` ports, direct port choice is coarse (`"left"`, `"right"`, top variants).
  - A production body macro may need per-segment side ports like `"left-2"` to avoid free placement.
- `tailFinHeightTiles: integer`
  - Maps to stacked `tilePrimitive` triangles, `radialFan({ segments })`, or a small `wallGrid`
    adapter plus triangles.
  - The acceptance spec's jet silhouette rule requires `bounds.height >= 9`, so this parameter is
    not cosmetic.
- `tailFinCount: integer`
  - Maps to one vertical fin plus mirrored horizontal tail pieces.
  - Use `composeMacros` for the horizontal tail and vertical fin.
  - Use `attachByPort` so `MagneticConnection` metadata is created rather than relying on freeform
    proximity.
- `topFinEnabled: boolean`
  - Maps to a small front/top triangle macro attached to the fuselage top.
  - This corresponds to the `"top-fin"` subassembly in file-local `REFERENCE_INTENT_SPECS`.
- `tailOrder: enum`
  - Maps to step numbers in `TileInstance.step`.
  - `JET_AIRCRAFT_REFERENCE_ENCODING.steps` says horizontal tail first, then vertical fin on top.
  - This affects instruction fidelity even when geometry is unchanged.

## 3) Objective Function

The scalar objective should combine recognizability rewards with physical penalties:
```text
score(p) =
  20 * subassemblyCoverage(p)
+ 15 * rolePatternCoverage(p)
+ 15 * foldCoverage(p)
+ 20 * silhouetteCoverage(p)
+ 10 * bomCloseness(p)
+ 10 * aspectTarget(p)
+ 10 * boundsSanity(p)
- 40 * sumRawOverlapPenetration(p)
- 25 * max(0, maxDisplacement(p) - MAX_STANDING_DISPLACEMENT)
- 10 * disconnectedTileCount(p)
-  8 * invalidMagneticReasonCount(p)
```

Recognizability terms:
- `subassemblyCoverage` is the fraction of file-local
  `REFERENCE_INTENT_SPECS["jet-aircraft"].requiredSubassemblies` present in
  `TileInstance.subassemblyId`: `"body"`, `"nose"`, `"wings"`, `"tail"`, `"top-fin"`.
- `rolePatternCoverage` is the fraction of
  `REFERENCE_INTENT_SPECS["jet-aircraft"].requiredRolePatterns` matched by `TileInstance.role`:
  `/fuselage/i`, `/nose|wing/i`, `/brace/i`, `/tail|fin/i`.
- `foldCoverage` is the fraction of required normalized fold angles found in tiles with
  `parentTileId`: `0`, `Math.PI / 2`, `-Math.PI / 2`.
- `silhouetteCoverage` uses the two jet `silhouetteRules` in
  `lib/reference-encoder/reference-acceptance.ts`: `bounds.width > bounds.depth * 1.2` and
  `bounds.height >= 9`.
- `bomCloseness` compares the actual tile counts to
  `JET_AIRCRAFT_REFERENCE_ENCODING.billOfMaterials`: 16 `small-square`, 9
  `equilateral-triangle`, 10 `right-triangle`, 5 `isosceles-triangle`, and 0 `large-square`.
- `aspectTarget` rewards a wide aircraft stance, e.g.
  `clamp01((bounds.width / bounds.depth - 1.0) / 0.5)`.
- `boundsSanity` rejects degenerate geometry from `boundsForTiles` or `BuildGraph.bounds`, such as
  zero width/depth or extreme height relative to depth.

Penalty terms:
- `sumRawOverlapPenetration` is
  `findRawOverlaps(graph.tiles).reduce((sum, o) => sum + o.penetration, 0)`.
- `maxDisplacement` comes from `simulate(build).maxDisplacement`.
- `disconnectedTileCount` mirrors the disconnected-tile check in `validateMagneticBuild`, which
  emits `disconnected-tile:<id>` rejected reasons.
- `invalidMagneticReasonCount` is `validateMagneticBuild(normalizeBuild(graph)).rejectedReasons.length`.

Important source constraint:
- `REFERENCE_INTENT_SPECS` is not exported from `lib/reference-encoder/reference-acceptance.ts`.
  Production can either export it deliberately or duplicate the current predicates in an optimizer
  fixture. The POC does not import it.

## 4) Optimizer Choice

Preferred optimizer: CMA-ES.

Rationale:
- The search has continuous values (`wingSweepRadians`, `wingDihedralRadians`, `noseFoldAngle`) and
  discontinuous physical penalties from `findRawOverlaps`, `gateBuild`, and `simulate`.
- CMA-ES is robust when gradients do not exist and local shape changes create cliff-like failures.
- Discrete parameters can be handled by relaxed continuous genes that are rounded at template
  evaluation time: `Math.round(fuselageLengthTiles)`, `Math.round(wingSpanTiles)`,
  `Math.round(tailFinCount)`.

Alternative: Nelder-Mead.
- Pros: simple, low overhead, good for a small continuous-only parameter set.
- Cons: weaker with integer tile counts, symmetry choices, and hard invalid regions.
- Use it only after freezing discrete parameters or as a local polish step after CMA-ES.

Alternative: random-restart hill-climb.
- Pros: easiest first implementation and debuggable.
- Cons: likely to get stuck in local minima when overlap penalties dominate.
- Good first milestone because it can reuse the POC's `evaluate(params)` function.

Budget:
- Run cheap geometry scoring first: `assembleBuildGraph(..., { strict: false })`,
  `findRawOverlaps`, bounds checks, BOM checks, and disconnected count.
- Bound the first pass to about 300 to 800 geometry evaluations.
- Run `simulate` only for the top 10 to 25 candidates per generation or final shortlist because
  `simulate` creates a Rapier world and steps up to `SIMULATION_MAX_STEPS`.
- Run full `gateBuild` only for finalist candidates because it includes raw overlaps, magnetic
  validation, `simulate`, and optional `rollTest` for ramps.

## 5) Hard vs Soft Constraint Handling

Hard gates:
- `assembleBuildGraph(draft)` defaults to strict behavior and calls `assertNoRawOverlaps`.
- `assertNoRawOverlaps` throws `RawOverlapError` when `findRawOverlaps` finds penetration above
  `RAW_OVERLAP_TOLERANCE`.
- `gateBuild(input)` rejects builds with raw overlaps, invalid magnetic/support issues from
  `validateMagneticBuild`, and non-standing simulation results.

Soft penalties:
- During search, call `assembleBuildGraph(draft, { strict: false })` or `draftToBuildGraph(draft)`
  so bad candidates can still receive informative scores.
- Penalize overlap penetration from `findRawOverlaps` rather than immediately discarding every
  candidate during early exploration.
- Penalize `simulate(...).maxDisplacement` only above a threshold, using
  `MAX_STANDING_DISPLACEMENT` as the production threshold.
- Penalize disconnected tiles by counting graph components or by parsing
  `validateMagneticBuild(...).rejectedReasons`.

Final acceptance:
- A selected candidate must pass strict `assembleBuildGraph` and `gateBuild`.
- The optimizer score is a ranking tool, not a replacement for the engine gate or human visual
  signoff described in `docs/jet-rebuild-target.md`.

## 6) Minimal Runnable POC Description

POC file: `scripts/research/04-optimizer-poc.ts`.

What it does:
- Defines `JetParams` with `fuselageLength`, `noseDepth`, and `wingSpan`.
- Builds a fuselage with `box({ width: 1, height: 1, depth: fuselageLength, openFaces: ["front", "back"] })`.
- Builds a nose with `squarePyramid` and positions it with `placeMacro`.
- Builds wings from repeated `tilePrimitive({ shape: "right-triangle", plane: "horizontal" })`
  calls, then mirrors them with `mirrorMacro`.
- Combines all subassemblies with `composeMacros`.
- Converts `TileMacro` to `AuthoredBuildDraft` by mapping tiles to `BuilderTile` with
  `authoredMode: "edge-snap"` and `confirmed: true`.
- Calls `assembleBuildGraph(draft, { strict: false })`.
- Calls `findRawOverlaps(graph.tiles)` and sums `RawOverlap.penetration`.
- Computes aspect ratio and wing/body/nose recognizability terms from `boundsForTiles` and
  `TileInstance.subassemblyId`.
- Computes a local disconnected-tile penalty by traversing `BuildGraph.connections`.

Exact requested command attempted:
```text
npx vite-node --config vitest.config.ts scripts/research/04-optimizer-poc.ts
```

Result in this sandbox:
```text
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/vite-node failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
```

Reason:
- `node_modules/.bin` contains `vite`, `vitest`, `tsx`, and `tsc`, but no `vite-node`.
- `npx` attempted to fetch `vite-node` from npm, and network access is restricted.

The POC itself produced this stdout with the local TS runtime:
```text
Parametric optimizer POC evaluations
1. params={"fuselageLength":3,"noseDepth":1,"wingSpan":2} score=75.47 recognizability=80.87 penalty=5.40 overlaps=0 disconnected=9 bounds=21.00w/3.09h/15.16d
2. params={"fuselageLength":5,"noseDepth":2,"wingSpan":3} score=72.39 recognizability=78.99 penalty=6.60 overlaps=0 disconnected=11 bounds=27.00w/3.09h/24.16d
3. params={"fuselageLength":2,"noseDepth":1,"wingSpan":1} score=54.25 recognizability=58.45 penalty=4.20 overlaps=0 disconnected=7 bounds=15.00w/3.09h/12.16d
```

Interpretation:
- The undersized `{ fuselageLength: 2, noseDepth: 1, wingSpan: 1 }` config scores lowest.
- The two larger configs score close together because the objective rewards wing/body/nose
  presence but penalizes disconnected free-placed macro pieces.
- All three sampled configs have zero raw overlaps after the POC's spacing adjustment.

## 7) Pros and Cons vs Alternatives

Pros vs hand iteration:
- Uses the same `findRawOverlaps`, `assembleBuildGraph`, and `gateBuild` boundaries humans must
  satisfy anyway.
- Produces a ranked candidate list instead of relying on manual visual adjustment.
- Keeps parameters interpretable: "increase wing span" is easier to review than arbitrary tile
  coordinates.

Cons vs hand iteration:
- Objective design takes time.
- Early scores can reward artifacts humans would reject visually.
- Human signoff remains required for reference likeness.

Pros vs constraint-propagation CSP:
- Easier to integrate with continuous angles and Rapier simulation.
- Works with existing macro constructors instead of requiring a full symbolic constraint model.

Cons vs CSP:
- Does not prove completeness.
- May waste evaluations in invalid regions a CSP could prune.
- Requires careful penalties to avoid objective gaming.

Pros vs ML:
- Needs no training corpus.
- Directly cites `REFERENCE_INTENT_SPECS`, `JET_AIRCRAFT_REFERENCE_ENCODING`, and engine results.
- Easier to explain and debug.

Cons vs ML:
- A hand-built objective may miss visual gestalt.
- It will not learn new construction idioms unless humans add parameters/macros.
- It can overfit the jet unless generalized across reference encodings.

## 8) Risks and Unknowns

Objective gaming:
- A candidate can satisfy `bounds.width > bounds.depth * 1.2` by scattering wing tiles too far
  apart.
- Mitigation: add compactness, connection, and support penalties using `BuildGraph.connections` and
  `validateMagneticBuild`.

Local minima:
- Once overlap penalties dominate, small parameter changes may all look worse.
- Mitigation: use CMA-ES or random restarts, and evaluate with strict mode off before final gating.

Evaluation cost:
- `simulate` is expensive because it creates a Rapier world and loops until settled or collapsed.
- Mitigation: defer `simulate` to shortlists and use geometry-only scores first.

API limitations:
- `box` lacks per-segment side ports and open-end lip ports.
- `squarePyramid` lacks a direct sharpness parameter.
- `REFERENCE_INTENT_SPECS` is file-local and cannot be imported without changing
  `reference-acceptance.ts`.

Reference ambiguity:
- `JET_AIRCRAFT_REFERENCE_ENCODING` describes an upright body column in one step, while
  `docs/jet-rebuild-target.md` argues the durable interpretation is a horizontal square tube.
- The optimizer should follow `docs/jet-rebuild-target.md` for the rebuild target, but acceptance
  should preserve both reference notes until human review resolves the discrepancy.

## 9) Effort and First Milestone

Effort: M.

Why not S:
- The POC is small, but a production optimizer needs a real connected jet template, exported or
  duplicated intent predicates, and a two-stage evaluation pipeline.

Why not L:
- Existing macro APIs already cover the core construction surface: `box`, `squarePyramid`,
  `tilePrimitive`, `mirrorMacro`, `composeMacros`, `attachByPort`, and `boundsForTiles`.

First milestone:
- Build a connected jet template with three subassemblies: body tube, mirrored wings, and nose.
- Use `attachByPort` for all joins.
- Run 50 random-restart hill-climb evaluations over `fuselageLengthTiles`, `wingSpanTiles`, and
  `wingDihedralRadians`.
- Require finalist candidates to have `findRawOverlaps(graph.tiles).length === 0`.
- Then run `gateBuild` on the top 5 candidates.

## 10) Verdict

VERDICT: Pursue a parametric optimizer, starting with random-restart hill-climb and graduating to
CMA-ES once the connected jet template is stable.

Rationale:
- The codebase already has the necessary scoring primitives: `REFERENCE_INTENT_SPECS` predicates,
  `BuildGraph.bounds`, `findRawOverlaps`, `assembleBuildGraph`, `gateBuild`, and `simulate`.
- The highest-risk work is not the optimizer algorithm; it is making the template connected and
  expressive enough that search parameters correspond to real magnetic-tile moves.

## 5-Line Summary

Verdict: Pursue parametric optimization after building a connected macro-level jet template.
Effort: M.
Key risk: Objective gaming through wide but disconnected or visually wrong tile scatter.
POC result: Three sampled configs produced console scores, zero raw overlaps, and a lower score for the undersized jet.
Next step: Replace the POC's free-placed wing/nose pieces with `attachByPort` joins and run a 50-evaluation hill-climb.
