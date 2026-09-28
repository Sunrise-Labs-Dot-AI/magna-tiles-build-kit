# Gravity placement and source launch construction

This is progress on the active full reconstruction/generation goal, not completion. Worktree: `magnatiles-footage-replicas`, branch `codex/footage-grounded-replicas`, draft PR #4. Preserve the dirty original checkout. Do not merge or deploy production.

## Working behavior

- Explicit `gravitySeat` operations approach a raised release pose with a full-size two-finger proxy, withdraw and simulate gravity with every new cross-module joint absent. Existing joints remain active. Moving bodies use CCD, four collision substeps per 120 Hz reporting step, the original 7.5 second physical duration, original 90-step sustained rest time, unchanged forces/friction/overlap/displacement thresholds and at most one individually held installed panel.
- Table placement and magnetic seating are separate result kinds. A first placement requires actual Rapier ground bearing. Magnetic seating requires every specific withheld target edge to close in the actual rested geometry. The normal connected support and mandatory release checks follow. No authored-pose reset, attraction or distant hinge.
- Each collision substep checks solid overlaps, ground penetration, target displacement, broken joints and conservative swept support-finger clearance. Failed traces preserve the actual terminal pose. Joint-break damping now uses the actual simulation timestep rather than a hardcoded 120 Hz interval.
- Generic U construction and a roof on supports with genuine bearing area pass across three seeds. An exact-width edge-only roof fails: rest-before-attachment cannot replace magnetic capture while a part is still falling. Unsupported, missed, obstructed, malformed and fingertip-crossing cases fail.
- Henry's small launch now starts in the observed sideways pose: place final back panel flat, attach final roof upright, then attach green sides. All four operations pass across seeds 0/17/53. The first operation is recorded gravity placement. A transformed initial assembly pose is allowed; any transfer involving a transformed dependency still requires a validated orientation trajectory and remains unverified.
- The viewer uses actual predecessor/carry poses and recorded gravity snapshots. It never animates a failed result into the authored target. Future parts remain absent and numbered labels stay stable.

## Source and calibration evidence

Construction claims reference four specific fitting frames. Re-extraction reproduced their existing SHA-256 hashes, and the frames are registered in the canonical source/extraction manifest with small-ramp/small-launch ledger bindings. The source verifier checks replica, stage, source ID/digest, frame ID, timestamp, fit role, PNG digest and canonical path. Original metadata/lock versions are archived. Corrupting either a reserved or a construction PNG causes rejection; the probe restores bytes in `finally`.

One independently reserved useful final view now satisfies the minimum view-count rule from `docs/reference-replication-goal.md`; the extra two-view requirement was removed after independent plan/code review. No historical/fitting view is relabeled fresh. Geometry freeze, independent assessment, complete coverage and pixel tolerances remain. Current fidelity failures remain, and the full fidelity promotion predicate still needs completion rather than permanent `unverified` output.

Reviewed original photo edges and independent printed-distance checks are in `docs/research/contact-measurements/`. Square edges are approximately 76–77 mm. The isosceles extrapolated straight edges are approximately 147–148 mm, but their virtual apex extends beyond the rounded plastic tip. The 143 mm catalog value remains noisy; neither these photos nor the old detector justify six-inch stretching. No catalog geometry or heldout pixel coordinates changed.

## Verification

- 326 tests pass, one existing skipped test, 24 test files.
- Lint: zero errors, 38 existing warnings.
- 25/25 structural benchmark outcomes correct, with historical full benchmark preserved. Current full run: `/tmp/magnatiles-seating-structural-benchmark.json`; checked summary is in `verification/replication/structural-regression-summary.json`.
- Production build and artifact fingerprints pass. Strict reference verification intentionally exits 1 because full source replicas remain unverified.
- Browser QA covers all four downloads, construction labels, ordinary insertion, recorded gravity motion, source launch assembly status, missing-source snail state and mobile overflow; no page errors.
- Claude Opus authentication was attempted once for plan and code review and failed with expired OAuth. Fresh GPT-5.5 reviews and resolution notes are under `runs/reviews/`.

## Next work

1. Small wedge: first deck join still fails after U settling (`small-side-1:1 -> small-deck-2:2`, gap about 0.200 in, overlap 2.758 in). Preserve the failed criterion. Investigate adaptive rigid placement against the actual settled support and independently measured magnet/edge contact; do not stretch tiles or tune heldout pixels. Ordinary gravity seating cannot support a deck held only by edge magnets; capture must occur only at proven contact and preserve current momentum/poses if implemented.
2. Implement continuous lift/rotate/translate module transfer with a single held panel and other module panels dynamic, actual obstacle/finger clearance and no pose-reset shortcut. The launch's later rotation is still unverified.
3. Complete independent source coverage and a reachable full-fidelity predicate. Preserve historical versus fresh status, score immutable check measurements, and separate fitting from evaluation.
4. Continue the jet, medium passive car path, large assembly and exact 3D snail source work. Keep the full active goal until the requested replicas and general verified generation path work reliably.
