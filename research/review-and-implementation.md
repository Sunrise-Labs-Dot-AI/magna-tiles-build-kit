# Adversarial Review And Implementation Notes

## Executive Verdict

The report is directionally right about the central modeling issue: wide, flat wings need to be represented as real edge-attached coplanar panels, not as freeform geometry or as downward folds that happen to pass the gate. That part is correct and feasible now.

The report overclaims the current system's guarantees. This repo does not yet have a half-edge/FOLD model, precomputed thick-panel fold intervals, magnetic polarity, vertex trimming, close-seam reasoning, CP-SAT, MCTS, CLIP, EMD, visual hull reconstruction, or a held-out VLM gate. Current validity is a pragmatic attach system plus strict raw-overlap rejection, magnetic edge matching, and simulation. The phrase "correct by construction" is currently aspirational except for narrow moves whose attach transform deterministically produces an edge match and whose result then survives the hard gate.

## Current Code Reality

- `gateBuild` already enforces the non-negotiable floors that matter for this fix: raw overlap pre-filter via `findRawOverlaps` at the `0.03` hairline, magnetic edge validation, `simulate().stands`, and ramp roll tests where applicable.
- `assembleBuildGraph(draft, { strict: true })` already refuses drafts with raw tile interpenetration. The draft path is lenient for authoring, but strict assembly is the right boundary.
- `attachByPort` / `joinByPorts` already implement edge-to-edge transforms and edge-length class checks. `coplanarFlatJoin` already exists and maps to `foldAngle: 0`.
- `resolveJoinedHingeClearance` and `resolveFoldThicknessOffset` are local clearance heuristics. They are not a general thick-panel origami model, and they do not precompute fold feasibility intervals.
- `findMagneticEdgeMatch` validates geometric edge proximity and parallelism, including some partial-edge tolerance. It does not model magnet polarity.
- `jetSilhouetteMatch` is a 3-view geometric IoU against `jet-reference-model.ts`, aggregated by mean. It is useful and cheap, but still gameable compared with the report's proposed min-over-many-views ensemble.
- `jet-reference-model.ts` is a hand-authored reconstruction from video observations, not a MASt3R/SAM2/visual-hull pipeline.

## Proposal Verdicts

| Proposal | Verdict | Adversarial Notes |
|---|---|---|
| Thick-panel half-edge/FOLD representation | CORRECT BUT FUTURE/LARGE | The representation is the right long-term direction, but the repo currently stores placed tile instances plus connection records. Moving to half-edge/FOLD would be a schema and generator rewrite. |
| Axis-shift / offset-panel hinge model with precomputed feasible fold intervals | CORRECT BUT FUTURE/LARGE | The report correctly identifies the thickness problem, but current code only applies a local offset when a folded parent/child pair overlaps. There is no fold-angle feasibility table. |
| "Correct by construction" move generator | WRONG/OVERCLAIMED/NOT-APPLICABLE | Current attach transforms are deterministic, but validity is still proven by post-hoc strict assembly and `gateBuild`. The move generator does not globally guarantee no overlap before checking. |
| Edge-class legality | CORRECT + FEASIBLE-NOW | Already present through `EDGE_LENGTH_CLASS_JOIN_MATRIX` and `assertJoinablePorts`. This was not missing. |
| Magnetic polarity filter | CORRECT BUT FUTURE/LARGE | The code validates edge geometry, not N/S polarity. Adding polarity means extending catalog/magnet data and validation semantics. |
| Coplanar lateral extension for wide flat wings | CORRECT + FEASIBLE-NOW | This is the useful near-term finding. `coplanarFlatJoin` already existed; the jet script was not using it for wings. Implemented below. |
| "Coplanar extension is always valid" | WRONG/OVERCLAIMED/NOT-APPLICABLE | Edge-adjacent coplanar panels do not interpenetrate each other, but they can still collide with other tiles, duplicate an occupied edge, or fail stability. The gate must remain authoritative. |
| Close-seam operation | CORRECT BUT FUTURE/LARGE | Useful for closed shells, but not implemented. Current connections are attach-generated or contact-discovered, not loop-closure solved. |
| Global broad-phase collision inside the move generator | CORRECT + FEASIBLE-NOW | The collision oracle already exists as `findRawOverlaps`; integrating it into every move enumeration is feasible. Do not weaken the hairline. |
| Disassembly/removability graph | CORRECT BUT FUTURE/LARGE | Current connectivity only checks reachability via valid magnetic joints. Removability/disassembly certification is absent and likely larger than this fix. |
| Gravity stability and every-prefix stability | CORRECT BUT FUTURE/LARGE | Final stability exists through `simulate().stands`; every-prefix stability and hinge moment calibration do not. The report correctly flags empirical magnet capacity as a major unknown. |
| SAM2 + MASt3R + visual hull reconstruction | CORRECT BUT FUTURE/LARGE | Good target architecture, but the repo currently uses hand-authored reference geometry and sampled frames. This is a separate reconstruction project. |
| Part-grammar prior | CORRECT BUT FUTURE/LARGE | The current system has roles/subassemblies and parametric scripts, not a learned or formal ShapeAssembly-style grammar. |
| Learned-policy MCTS | CORRECT BUT FUTURE/LARGE | Plausible architecture, but far beyond this repo's current parametric generator and tests. |
| CP-SAT sub-solver | CORRECT BUT FUTURE/LARGE | Potentially useful for small constrained subassemblies, but not needed for the wing fix and not wired into the current continuous geometry scoring. |
| MAP-Elites archive | CORRECT BUT FUTURE/LARGE | Useful for avoiding single-score collapse, but separate product/search infrastructure. |
| Min-over-views silhouette aggregation | CORRECT BUT FUTURE/LARGE | Conceptually right as scorer hardening, but switching the current 3-view mean to min would be a breaking calibration change. The new valid jet has front IoU 0.389 and mean 0.567; min-as-total would report 0.389 and require threshold recalibration. |
| CLIP / VLM critic / Goodhart early stopping | CORRECT BUT FUTURE/LARGE | Right direction for an optimizer, but no current local implementation. Should not be bolted into this geometry fix. |
| EMD / surface-coverage anti-sparseness | CORRECT BUT FUTURE/LARGE | Correct weakness in the structural scorer, but needs a calibrated target surface representation. Cheap tile-count penalties would be gameable and not equivalent. |

## What Was Implemented

The jet reconstruction generator now emits wing candidates that use `coplanarFlatJoin` with `foldAngle: 0` from the flat top facet of the triangular-prism fuselage. The selected draft has wide, horizontal isosceles wing panels attached through real magnetic edge connections. The panels are not freeform placements.

The extra broad top fin was removed from the selected variant because it projected as a tall slab in the front silhouette and was inconsistent with the front target mask. The top-fin subassembly is represented by an edge-on upright stabilizer so structural recognition still sees `top-fin` while the front view remains dominated by the wide flat wings.

No gate thresholds, overlap tolerances, or existing tests were weakened.

## Verification Snapshot

Baseline checked-in draft before this change:

- strict assembly: passed
- `gate.passed`: true
- raw overlaps: 0
- structural recognition: 0.883
- silhouette total: 0.404
- silhouette per view: top 0.630, side 0.458, front 0.125

Updated `build-drafts/jet-reconstruction.json`:

- strict assembly: passed
- `gate.passed`: true
- raw overlaps: 0
- structural recognition: 1.000
- silhouette total: 0.567
- silhouette per view: top 0.600, side 0.711, front 0.389
- wing geometry: fold angle 0, horizontal tile normals, tips at about `z = +/-6.93`

## Prioritized Roadmap

1. Keep the current hard gate as the source of truth and push `findRawOverlaps` into any future move enumerator so illegal moves are rejected before scoring.
2. Add an explicit `lateral-extension` move API around `coplanarFlatJoin`, with tests that assert edge match, zero raw overlaps, and gate pass for square and triangle panels.
3. Replace the local hinge-clearance heuristic with an explicit offset-panel hinge model for non-coplanar folds. Start with parent/child pair tests before attempting multi-vertex trimming.
4. Add scorer hardening after recalibration: either a surface-coverage term against `jet-reference-model.ts` or a separate `worstView` field alongside the current mean silhouette score. Do not silently change `total` without updating thresholds.
5. Add target reconstruction only after the attach/gate/search loop is stable. The current hand-authored reference model is good enough for geometry calibration.
6. Defer MCTS, CP-SAT, MAP-Elites, CLIP, and VLM critics until the legal move generator is explicit and covered by tests.

