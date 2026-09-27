# Reliable harness, increment 1

User correction: the goal is to keep building the harness until it reliably creates verified builds. The goal remains active; opening or updating a candidate PR is not completion.

Implemented exact physical contact hulls with no extra collision skin in browser and headless simulation. Source-independent 9/13-piece shell fixtures fail before and pass after the correction under three perturbation seeds. Material parameters, collision tolerance, displacement limit and required rest duration are unchanged. Negative collapse/unsupported checks remain active. The large source ramp now passes release, with peak displacement about 0.270 inches. Jet and medium remain release failures.

Implemented continuous SAT for fixed-orientation translation, bounded insertion search, source-stage installed-obstacle contracts, per-part/module sequence coverage, and interactive path previews. The small ramp has five wedge insertions, four launch-module insertions and one module-joining insertion. Their clearance is verified; held stability, grip access and magnetic closure are not. Whole-model support flags do not bypass coverage. Full source promotion remains disabled until the explicit contracts in the reviewed plan are implemented.

The generated two-step riser now has real rear-wall bracing (13 squares rather than 10). No support pieces were added to source replicas. The historical jet and snail now have failed metadata matching live gates; the legacy large ramp's stale failed card was corrected. All nine cards/drafts are tested against the live engine; raw-overlap regression coverage is preserved independently.

Validation: 275 tests passed, one skipped, 21 files; production build passed; lint 0 errors with 38 existing warnings; structural benchmark 25/25. Strict source verification exits 1 because the source acceptance requirements are unresolved. Independent plan/code review used fresh GPT-5.5 after one failed Claude Opus OAuth attempt. Both blocking code findings were fixed and independently marked ADDRESSED; the follow-up metadata warning was audited and corrected. Browser QA covers 4 downloads, stable module labels, keyboard insertion endpoints, checkpoint reset, mobile overflow, and page errors.

Original working checkout remains untouched: deleted .claude/scheduled_tasks.lock, modified next-env.d.ts, deleted verification/jet-reconstruction/step-24.png. Work stays in codex/footage-grounded-replicas and PR #4. No merge or production deployment.

## Next increment

1. Resolve source geometry and source-camera observation errors, beginning with the small ramp. Diagnostic only, not applied: the current small-final-34 near/far vertex indices appear mirrored. Swapping z-side correspondences without changing pixels yields an above-table camera and camera-anchor RMS 2.65 px instead of 14.08 px; scored RMS remains 23.30 px and fails the unchanged tolerance. This is NOT new independent validation and must not be used to tune geometry. Re-establish corner identity from the construction sequence, preserve the historical annotation/lock, and label revisions transparently.
2. Reserve additional fitting and withheld evidence before modifying candidate geometry. Existing inspected heldout views are historical diagnostics, never fresh holdouts. Implement the reviewed provenance/coverage and promotion contracts with positive synthetic and negative tampering fixtures.
3. Add explicit bounded hand contacts, grip approach clearance and held release checks. Current insertion clearance is not full assembly verification.
4. Continue medium source topology, then passive turns and car-parameter robustness. No hidden steering or waypoint forces. The medium release currently reaches rest too late for its required observation window; do not change the threshold merely to pass.
5. Large: scored source cameras, exact assembly operations and car route. Jet: source-constrained topology and hinge/contact diagnosis. Exact 3D snail source remains absent.

Local preview: http://localhost:3009/references. Original 3008 process may still run the earlier build; use 3009 for this increment.
