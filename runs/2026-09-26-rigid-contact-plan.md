# Rigid contact convergence and release acceptance

Previous goal turn: progress. HEAD d83a893, draft PR #4, preview green, clean worktree. The full verified reconstruction/generation goal remains active. Full engineering loop applies because contact integration and acceptance are shared runtime physics behavior.

## Evidence before implementation

The small wedge now assembles and is lowered with actual physical state, but its released lower deck gradually exceeds the unchanged 0.03-inch floor penetration tolerance. More collision steps alone did not fix this. A separate single square on the table sinks about 0.008 inches at the existing 30 Hz contact frequency, independently of 120/480/960 Hz time stepping.

An independent five-square loaded-base fixture rotates the existing closed-shell fixture upside down: one horizontal base carries four rigidly connected upright walls. There is no source reconstruction, no raw overlap and no target-dependent dimension. Preliminary three-second runs give late ground penetration:

| Physics steps/sec | 30 Hz contact frequency | 60 Hz | 120 Hz |
|---|---:|---:|---:|
| 120 | 0.0945 in | 0.0264 in | 0.0075 in |
| 480 | 0.0939 in | 0.0240 in | 0.0067 in |
| 960 | 0.0900 in | 0.0239 in | 0.0067 in |

These are diagnostics, not final evidence: tests must validate the fixture's geometry, repeat releases and evaluate full duration/rest. A reanchored wedge diagnostic responds similarly but is explicitly not the actual assembled state, so it cannot certify source assembly.

Installed JS bindings are Rapier 0.19.2. Their pinned Cargo.lock uses Rust Rapier 0.30.1. That version documents contact springs with default natural frequency 30 Hz and damping ratio 5; increasing frequency risks jitter. See https://raw.githubusercontent.com/dimforge/rapier.js/v0.19.2/Cargo.lock and https://raw.githubusercontent.com/dimforge/rapier/v0.30.1/src/dynamics/integration_parameters.rs . Do not rely on newer C/Rust defaults or upgrade the dependency to obtain a passing model.

## Plan and acceptance

1. Add a reproducible independent contact fixture/diagnostic. Validate catalog rigidity, connection topology and raw nonintersection. Record baseline versus proposed settings, floor penetration, post-impact rest, speeds, corner displacement and broken joints. A numerical target of at most 0.01 inches late penetration reserves two-thirds of the unchanged 0.03-inch overlap budget. Select the lowest tested contact frequency that meets this target for both flat and loaded-base fixtures without jitter or breakage; preliminary candidate is 120 Hz. This is numerical rigid-contact tuning, not measured plastic/magnet calibration.
2. Make the selected contact frequency explicit in shared engine constants. Keep gravity, tile size/thickness/mass, friction, magnetic break law, raw overlap tolerance and displacement/rest thresholds unchanged. Enable CCD for tiles. Refine a coarse engine step into at most 1/480-second collision steps while preserving the caller's total requested time. Already finer assembly steps remain unchanged. Joint breaks use each actual substep duration. Kinematic targets must follow their intended path across subdivisions; do not make them reach the endpoint in the first substep.
3. Add engine ground-penetration evidence measured from actual transformed prism vertices at every collision step. Retain the peak even if a later step recovers. Reject nonfinite state. All release acceptance lanes, including nominal simulation, source release, structural sweep and passive roll/car outcomes, must not accept ground penetration exceeding the existing tolerance. This closes the current gap where nominal release can pass while assembly rejects table penetration. Do not make contact itself, an initial drop or a trace endpoint count as penetration.
4. Audit sustained rest in the release lanes touched by this change. `simulate` currently breaks on a rest counter but does not require it in `stands`; the structural release sweep also lacks sustained rest. Require separate existing linear/angular limits and the existing 90 reporting-step rest time, without changing the maximum 7.5-second duration. Include ground/rest evidence in results and invalidate stale physics/fingerprint model versions as needed.
5. Rerun actual small-wedge assembly, not a reanchored reconstruction, across 0/17/53. If it passes, assert every operation, handoff, lowering and mandatory free checkpoint. Keep source fidelity, nominal release and actual assembly distinct. If it still fails, inspect the actual remaining failure rather than weakening limits. Preserve the prepared-launch transfer guard until explicit state transfer succeeds.
6. Positive fixtures must converge across timestep/solver refinements. Negative fixtures must still collapse, break, hit obstacles or remain unstable. Check midpoint/ground crossings, transient penetration followed by recovery, invalid state, wrong time accounting, kinematic substep interpolation, and unsupported moving panels. Run the structural benchmark and investigate any lost constructive cases as real model/planning failures, not reasons to revert stricter truthfulness. Keep rejection cases intact.
7. If the wedge is resolved, continue into actual prepared launch transfer using the previous reviewed transfer plan: separate construction workspace, one held panel, other parts dynamic, all installed obstacles retained, explicit state merge with original anchors, and no pose teleport. Separate code/review scope if necessary, but keep the full goal active.

## Delivery

## Review resolutions before implementation

- ACCEPT peak selection: every candidate setting must keep **peak** penetration at or below the unchanged 0.03 inches across the entire drop/release, as well as late penetration at or below 0.01 inches. The late criterion adds numerical headroom; it never replaces the peak gate. Repeat at 480/960 collision steps/sec and 16/32 solver iterations, with release seeds 0/17/53. Record every collision step.
- ACCEPT time accounting: centralize subdivision in `EngineWorld.step`; preserve requested seconds, restore the caller's dt, interpolate position-based kinematic targets over all substeps, and sample breakage using actual microstep dt. Test elapsed gravity time, kinematic midpoint, and coarse/refined break equivalence. Rest remains measured per 1/120-second reporting step for 90 consecutive steps.
- ACCEPT result evidence: nominal simulation, structural sweeps, source releases, rolls and cars report peak ground penetration and fail on excess or nonfinite state. Nominal and structural release tests explicitly exercise missing rest, not just fixture success.
- ACCEPT units: pin existing lengthUnit=1, normalizedAllowedLinearError=0.001 and damping=5 in convergence evidence/tests. Do not retune them. Browser sandbox currently has lengthUnit=10 and a separate integration loop; label its behavior diagnostic until parity is tested, and do not use it as acceptance evidence.
- Required regressions include transient penetration followed by recovery; invalid state; unsupported motion; nominal/structural sustained rest; roll/car tile penetration; and actual small-wedge state continuation across all seeds. Transformed prepared transfer remains blocked until explicit no-teleport state merge passes.

Initial alternative review: `runs/reviews/rigid-contact-plan-review.txt`. All four findings accepted and incorporated above; verify these conditions in implementation and a fresh code review.

Alternative-model plan review before edits, then independent code review and fix verification. Full tests, meaningful benchmarks, report/artifact regeneration, build/lint, desktop/mobile playback and draft PR CI. Record numerical assumptions and remaining calibration boundaries. Preserve unrelated original-checkout edits; no production promotion or merge.

## New blocking diagnostic: rotated convex-prism contact

The new freely folding, inverted wall/leaf fixture exposed a previously masked collision error. The identical geometry with a rotated saved body reference frame reports a contact depth of approximately **-3 inches along z**, although the exact prisms meet at a corner and do not overlap. A fresh baked hull folds normally; the continued hull is falsely held. Disabling contacts solely in a diagnostic restores identical folding. CCD off and explicit collider transform propagation do not resolve it. Logs: `/tmp/magnatiles-contact-hinge-points.log` (manifolds) and `/tmp/magnatiles-contact-hinge-nocontact.log` (diagnostic only). Do not disable contacts in production or claim the provisional small-wedge assembly pass yet.

Proposed bounded fix: use Rapier's exact cuboid primitive for rectangular catalog panels, with the catalog half-extents and reference basis applied as collider-local rotation. Keep the immutable hull vertices for independent geometry checks and snapshot coordinates. Triangle panels retain convex prisms. This changes the collision algorithm, not thickness, dimensions, anchors, forces or tolerances. Before adoption, verify cuboid corners equal the existing prism corners under nontrivial body/reference rotations, and that fresh/continued free hinges fold equivalently with contacts enabled. Assert manifold depths agree with independent SAT rather than accepting the former three-inch phantom. Repeat flat/loaded contact frequency selection, source/structural regressions and actual assembly. If the primitive does not fix the contact error, continue the minimal fixture diagnosis rather than moving the source model or weakening tests.

Primitive-plan review resolutions (all ACCEPT; verified before implementation):
- Explicit frame equation is bodyRotation × referenceBasis × catalogVertex. Test all three square sizes, noncommuting rotations and Euler-only reference geometry; preserve the original hull proof vertices.
- Test-only exact signed SAT uses all 15 box axes without the production 0.03-inch overlap filter. The collision regression inspects actual contact manifolds with contacts enabled and compares negative depths with this independent geometry, allowing only documented numerical/step error. Folding alone is insufficient.
- Add a required physics-model version to EngineState; reject missing/stale versions on continuation. Regenerate all evidence/fingerprints. Never reuse the provisional convex-model assembly result.
- Compare primitive mass/inertia with the analytic solid-box inertia and the former convex shape, and compare fresh/continued gravity trajectories. No material/force/geometry retuning accompanies primitive selection.

Review artifact: `runs/reviews/rigid-contact-primitive-plan-review.txt`. The five findings above are acceptance conditions, not approval requirements from the user.

Additional timestep evidence: the independent three-panel supported-slope fixture from the preexisting generic library (not a source reconstruction) has peak table penetration 0.038–0.040 inches at 480 Hz, 0.004–0.022 at 960 Hz and 0.004 at 1920 Hz across 0/17/53. All nine runs settle with no breaks; only the coarse impact violates the unchanged table tolerance. Therefore select 960 Hz as the shared maximum collision step, consistent with the already-required assembly support cadence. Recheck contact frequency at 960/1920 Hz. Held motion and gravity seating explicitly adopt 960 Hz too so their swept prism/finger checks still run on every collision step; reporting time and rest remain 120 Hz. Preserve the coarse diagnostic as baseline, and do not present timestep-sensitive trajectories as measured real motion.
