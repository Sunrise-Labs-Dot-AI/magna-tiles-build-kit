# Finite contact and complete small-ramp assembly increment

## Outcome

The nine-piece Henry small-ramp candidate now passes its complete three-stage assembly across seeds 0, 17 and 53, including unsupported final release of the actual transferred module. The 37- and 51-piece ramp candidates pass their three release perturbations. Their source geometry is unchanged. Source fidelity remains failed/incomplete, the medium passive turn fails, larger construction contracts remain missing, and the exact 3D snail source is still absent. No full replica is promoted.

## Implementation

- A continuous finite-prism solid guard checks tiles and table throughout each collision substep, preserves failure history, and rejects uncertifiable intervals. It does not replace vehicle/ball checks.
- A pinned local Rapier.js 0.19.2/f32 runtime adds the reviewed Parry SAT normal/cache correction and finite support-witness check. Original clipping, catalog solids, material values and solver settings remain. Original unpatched controls reproduce the contact defects.
- Backend ownership/lifetime guards and full backend/profile identity reject foreign objects and stale physical continuations. State snapshots remain the versioned application format.
- Assembly tries at most two whole-stage docking policies from isolated predecessor states. Every seed must pass the same policy; failed states never prepare a future stage. The workshop replays selected and rejected attempts with actual motion.
- Generated sprint support faces are corrected as a separate variant. Historical model geometry remains unchanged; nominal library labels follow the fresh nine-model audit.
- Reports retain solid failure histories and peak overlap. The source report CLI permits an explicit wall-clock budget without changing physical limits.

## Evidence

- Full test suite: **460 passed, 1 skipped, 40 files**, 592.58 seconds. Type checking passed.
- Lint: **0 errors, 38 pre-existing warnings**. Diff whitespace check passed.
- Contact matrix: 198 orientations; 1,200 random pairs and 360 near-parallel pairs in both orders; 50 exact-touch/shallow analytic pairs; 16 cache configurations with 52 motions each. Original defect controls and backend boundaries pass.
- Independent contact convergence: **72 trials**, lowest passing frequency remains **120 Hz**.
- Clean runtime builds: two full builds with fresh Cargo caches produce identical artifacts. Packaged CJS SHA-256: `5e4c38a5ada93780d4dd9aba7553d63cdb6f003c59c602f784beeff719d347c0`. Full source/patch/lock/toolchain provenance is in `vendor/rapier-contact/provenance.json`.
- Complete packaged small assembly: `runs/diagnostics/2026-09-27-packaged-v3-small-assembly.json`; full refreshed playback/evidence in `public/reference-replicas/small-ramp.json`.
- Structural benchmark: **24/25** outcomes, comprising **19/20** constructive cases and **5/5** required rejections. The five-step staircase exceeds the unchanged 240000 ms budget before completing a candidate. No incomplete result is accepted. A repeat/profile and a separate optimization plan investigate this limitation.
- Browser QA: selected and rejected sequence selection, checkpoint changes, recorded-motion slider and completed nine-tile transfer render correctly with no page errors. Screenshots and check record: `verification/reference-workshop-v3/`.
- Source report regeneration, complete artifact integrity check and production compilation all passed. All four reports share validation code hash `41e24f3b908a2f1a0decd144dea070c20f42241920ea81a0c723af5f9b8836f7`.

## Reviews and limits

The full engineering loop applies because this changes physical acceptance and visible assembly behavior. Claude subscription OAuth was unavailable as recorded by earlier review attempts; fresh read-only GPT-5.5 CLI plan and adversarial code reviews were used. Relevant artifacts:

- `runs/reviews/contact-backend-integration-plan-review.txt`
- `runs/reviews/polyhedral-contact-code-review.txt`
- `runs/reviews/polyhedral-contact-cache-review.txt`
- `runs/reviews/finite-gjk-witness-plan-review.txt`
- `runs/reviews/finite-gjk-witness-code-review.txt`
- `runs/reviews/solid-backend-assembly-code-review.txt`

Accepted required findings are resolved, including optional witness support consistency, exact-touch contact existence and collider ownership for contactPairsWith. The finite-witness implementation review found no required correctness findings. Whole-stage retry/continuation negative tests and full tests cover isolation and failure propagation.

Keep PR #4 draft. This increment is simulation progress toward the active verified-build goal, not source acceptance or real-world material calibration. Do not merge or promote production. Next work targets collision-check computation cost and explicit medium-ramp construction, then source geometry and passive turning.
