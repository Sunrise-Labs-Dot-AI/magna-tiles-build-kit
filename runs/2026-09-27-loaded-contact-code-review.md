# Loaded contact experiment: review traceability

Review scope is the diagnostic fixture, runner, evidence assessment, static inspection and tests. Logic/evidence validity and clarity personas apply; there is no user-facing UI or production parameter change in this increment. The independently reviewed plan predates execution.

Sequential independent read-only review used the established `gpt-5.5` CLI fallback after the previously documented Claude subscription OAuth failure. It does not force findings and does not run another copy of the experiment. Original output: `reviews/loaded-contact-initial-code-review.txt`.

| Finding | Disposition | Correction | Verification |
|---|---|---|---|
| Numerical labels could disagree with actual recorded settings | ACCEPT | Validate native timestep, solver, unit/error settings, ERP and explicitly ERP-inferred contact frequency. Preserve setter-only API semantics. | Eight focused cases pass, including altered settings; independent follow-up VERIFIED/CLEAN. |
| Loaded-cell snapshots could omit panels or joints | ACCEPT | Require exact fixture reference geometry, distinct IDs/counts, dynamic finite bodies, full connections and active joint models. | Copied flat, missing/duplicate bodies/joints, modified geometry/anchor and fixed-body cases reject; independent follow-up VERIFIED/CLEAN. |

The initial incomplete run was discarded for selection and retained locally. A complete fresh run uses the corrected code; no changed setting has been promoted.

The independent follow-up (`reviews/loaded-contact-followup-code-review.txt`) verified both corrections and found no remaining concrete issue. It specifically checked that readable ERP safely establishes the effective numerical setting under the fixed vendored damping ratio.

Final independent review (`reviews/loaded-contact-final-evidence-review.txt`) is **VERIFIED/CLEAN, with limits**. It checked all 216 cells, effective parameters, exact panel/joint counts, no certified late/rest credit on failures, manifest/script/raw hashes, the 168-pass/48-failure accounting, null selection, unchanged baseline comparisons and collision-event labels. It found no blocking code or evidence issue. Its note that the exact focused-test stdout was not readily located is addressed by retaining the original log at `diagnostics/2026-09-27-loaded-contact-focused-tests.txt` (34 tests, three files, 43.73 seconds); the broader validation transcript is adjacent. The full suite subsequently completed successfully: 677 tests plus one existing skip across all 57 files, in 2099.47 seconds; actual stdout is retained in the validation transcript. Exact-head publication remains pending.
