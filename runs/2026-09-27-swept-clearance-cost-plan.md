# Preserve swept-clearance decisions while removing repeated geometry work

## Trigger and evidence

The current 480/1920 candidate (validator `50853cf620abb7438d728475d3e567213dedc796f6f4930ecfcbe3cb7f61db2b`) exceeded the unchanged medium-assembly test allowance. Its incomplete full regression was stopped after a reported failure at 1,210,103 ms; no detailed failure cause was emitted. Do not infer a full-suite pass or increase budgets.

The complete independent supported-transfer fixture then passed all five stages in a separate CPU-profiled run, 253.999 seconds. The archived V8 profile attributes 75.45 sampled seconds (29.67%, inclusive) to `checkSweptPoses`, including 29.62 seconds to `separatingAxes`. Source inspection confirms repeated normals/world-edge calculations per pair and projection-array allocation per axis. The archive and manifest are `diagnostics/2026-09-27-assembly-cost-profile.*`. Inclusive samples overlap; this predicts an opportunity, not an earned speedup or proof that this alone resolves medium cost.

## Bounded implementation

1. Freeze the current `checkSweptPoses`, interpolation/motion-bound helpers, and insertion separating-axis implementation in a test-only oracle, with the source SHA-256 values recorded. The oracle must retain its original math and be independent of the new prepared-geometry helper.
2. In `lib/replication/insertion.ts`, extract a prepared geometry value containing the normal, ordered edge directions and ordered face-axis candidates. Derive these with exactly the existing operations. Keep the existing exported `separatingAxes(a,b)` contract as a wrapper. A second helper assembles the identical ordered candidates from two prepared values, preserving cross-product operand order, normalization, near-zero cutoff and axis deduplication.
3. In `lib/replication/rotation-clearance.ts`, prepare each midpoint panel once per recursive interval. Reuse only within that interval; no global cache, approximate keys, sleeping-body assumptions or cross-call certificates. Compute axis projection extrema with ordered `Math.min`/`Math.max` reductions initialized to their original empty-set identities, retaining NaN and signed-zero semantics. Reduce the maximum gap the same way. Preserve all endpoint mapping, interpolation, motion bounds, pair order, table checks, threshold expressions, recursion order/depth, deadlines and exact failure messages.
4. Do not alter any physical integrator, numerical profile, observer frequency, hand check, tolerance, fixture, source model, test allowance or production budget. Do not replace the independent caller checker with the engine checker or introduce new broadphase acceptance.

## Required evidence

- Exact prepared/wrapper axis equivalence against the frozen original, including order and `Object.is` scalar equality; all catalog shapes, Euler and explicit bases, reflected bases, near-parallel edges, signed zero, extreme and nonfinite direct-call inputs.
- At least 2,000 deterministic diverse sweep comparisons against the independent oracle, plus explicit collision-between-clear-endpoints, table crossings, ordering, changed sets, threshold-adjacent pairs, ambiguous/depth exhaustion and deadline controls. Require identical status and detail. Existing held-motion and insertion negative tests stay unchanged.
- The unchanged five-scenario native-trajectory probe must compare exactly against the earned current-runtime archive `2026-09-27-proof-reuse-after.json.gz`: 124 world records, 2,275,376 native steps, initial/terminal digests and full outcomes. Its script and fixture hashes must still match. Timing is separate evidence.
- Run medium assembly within its unchanged 1,200,000 ms allowance, then full regression with the existing two-worker configuration. Preserve failures. No speedup claim until measured; if cost still fails, profile the remaining cost instead of widening this patch speculatively.
- All runtime-bound reports become stale after checker changes. Repeat configured72, the fixed-budget structural benchmark, generic and source reports, artifact/build/browser checks under the final frozen context. The source-report budget remains 900,000 ms; report-only success does not imply replica acceptance.
- Independent plan review before runtime changes, and independent code/evidence review before publication. No merge or production promotion. Revert only this narrow optimization if exact equivalence fails.

This work removes measured verification cost. It does not settle source identity, source geometry, withheld coverage, assembly completeness, calibration or passive-car behavior; the broader verified-build goal remains active.
