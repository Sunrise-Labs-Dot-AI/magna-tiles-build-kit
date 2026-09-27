# Rigid-contact verification increment

Active goal remains reliable verified source reconstructions and generated builds. This is progress on draft PR #4, branch `codex/footage-grounded-replicas`, not full goal completion. Original checkout's unrelated changes remain untouched. Do not merge or promote production.

## Implementation and independent evidence

The default 30 Hz soft contact allowed a five-square loaded base to sink through the table. The checked independent flat/base-load sweep now covers 72 trials: 30/60/120 Hz contact, 960/1920 Hz collision, 16/32 solver iterations and seeds 0/17/53. Only 120 Hz passes every case with full-run peak floor penetration ≤0.03 inches, late penetration ≤0.01 inches, sustained rest, no broken joints and peak corner displacement ≤0.95 inches. Its worst peak is 0.010982 inches and worst late penetration 0.006962 inches. This is numerical rigid-contact tuning, not measured plastic/magnetic calibration.

A separate generic three-panel inclined fixture exposed coarse impact penetration of 0.038–0.040 inches at 480 Hz; 960/1920 Hz pass the existing tolerance across all seeds. The engine now subdivides coarse steps to at most 1/960 second, preserving total time and interpolating kinematic targets. Joint breaks use microstep duration. Held motion and seating explicitly use this cadence so swept geometry and fingertip checks still run at every collision step.

A new inverted free-hinge test exposed a three-inch phantom contact depth in the generic convex-hull narrow phase for a rotated saved reference frame. With contacts enabled, equivalent fresh and continued geometry behaved differently. Diagnostic-only contact removal restored agreement; production contacts were never disabled. Exact cuboid primitives now represent all three square catalog sizes, preserving the reference basis and body rotation separately. Triangle prisms are unchanged. Tests verify transformed corners, noncommuting/Euler frames, mass and inertia against analytic boxes and former hulls, actual manifolds during initial free folding, and fresh/continued gravity motion. Engine snapshots now require the current physics-model version.

Collision-step peak ground penetration and corner displacement persist after recovery. Nonfinite state fails closed. Nominal, structural and source releases require separate original speed limits and 90 reporting intervals of rest within 7.5 seconds. Roll/car outcomes also reject structural table penetration. Historical eight-piece small-ramp and rocket labels are corrected from their actual current gates. The source models retain all 40/9/37/51 catalog panels, their geometry, observations and tolerances.

## Source results

- Small source: actual five-piece wedge construction and all three free checkpoints pass, with peak checkpoint floor penetration 0.004575/0.004564/0.004589 inches. The sideways four-piece launch also passes. Its later prepared-module rotation and combination remains guarded as unverified. Full nominal release passes all seeds; source shape and settled image comparisons still fail.
- Medium source: all three nominal releases now sustain rest (603/602/610 intervals), but source shape, complete assembly and inferred car turn still fail or remain unverified.
- Large source: all three nominal releases pass, with floor penetration below 0.009 inches; camera fit, detailed assembly and function remain unverified.
- Jet: original 40-piece BOM remains; source/physics/assembly failures remain visible. Exact 3D snail source remains absent.

Immediate next development is the actual prepared launch transfer from its separately built workspace into the five-piece wedge, preserving original anchors/velocities and checking the whole held rotation/translation. Do not remove the transformed-dependency guard or teleport prepared poses. Then continue source-fidelity reachability and the other requested reconstructions/functions.

## Verification and review

The complete test suite passed 369 tests plus one existing skip before adding the inclined-impact regression; that additional regression also passes (370 total passing tests). Type check and production build pass. Lint has zero errors and the same 38 existing warnings. Reports and checksums are regenerated. The structural benchmark completed with 18/20 constructive successes and all 5 required rejections (23/25 total); four- and five-step staircases exhaust their search budgets without sustained rest. Their failures are retained in `verification/replication/structural-regression-summary.json`. Desktop/mobile playback, keyboard controls, downloads and no-page-error/overflow checks pass. Evidence-integrity corruption/restoration and reserved-view freeze checks pass.

Claude Opus OAuth refresh failed for both plan/code review attempts. Fresh GPT-5.5 reviews were used as the alternative; initial contact-plan and primitive-plan findings are accepted and recorded alongside the plan. The final code review found no actionable issues; the disposition is recorded in `runs/reviews/rigid-contact-review-resolution.md`. The original 25/25 historical benchmark artifact is preserved separately from this model's results.
