# Reconstruction implementation review

Date: 2026-09-26. Scope: new source reconstruction lane, models, reports, workshop UI and passive-car regressions.

The full engineering loop was selected because this changes geometry, physical evaluation and user-visible behavior. The plan review is recorded in `footage-plan-review.txt` and its disposition. Claude was unavailable: the local Claude CLI reported no authenticated subscription session on one authentication check. The installed Codex CLI also rejected the default GPT-6 model as requiring a newer client. A fresh `codex exec -m gpt-5.5 -s read-only` was used for independent plan review, implementation review and fix verification. No API billing credentials were configured. A Claude second-lane pass remains desirable when available; this is a documented substitute.

Review artifacts:

- `footage-code-review.txt`: initial BLOCK, one critical integrity issue and three warnings.
- `footage-code-review-verification.txt`: independent follow-up **MERGE-OK**, with explicit static-review limits.

| Finding | Disposition | Fix | Verification |
|---|---|---|---|
| Generated verdicts/SVGs could change while model fingerprints stayed valid | ACCEPT | Separate checksums cover the complete report JSON, comparison SVGs and summary. Build verifies content and exact bundle coverage. | Unit regression plus actual report-status and SVG edits both rejected by `reference:check-artifacts`; restored bundle passes. |
| Medium lower-wedge step linked to the small-ramp clip | ACCEPT | Ten additional construction frames were extracted. Every stage link now matches its source operation, including the medium wedge at 00:48. | Test iterates every stage in all four candidates; evaluator enforces mapping. |
| Runtime projection partitions and landmark roles were not validated | ACCEPT | Reject any partition outside fit/holdout and role outside camera/check; passed observations must also equal the locked source measurements. | Malformed-label regressions and independent static review. |
| Vertical car route could produce a degenerate chassis | ACCEPT | Reject segments with negligible horizontal length and impossible wheel/chassis width. | Vertical, nonfinite and missing-surface routes return failed trials with no simulation samples. |

Additional implementation checks preserve Euler-only tile orientations through pose changes and settling; sample peak corner movement every physics step; require 90 consecutive rest steps at separately stated linear/angular thresholds; never refit a camera after release; and observe post-car structural motion throughout the final second. The production type check caught an incorrect Euler helper call signature during this refinement; it was corrected and covered by an Euler-only stage/release regression.

The reviewer's read-only sandbox could not run tools that write temporary caches (`EPERM`). The implementation lane ran those checks locally. Browser QA exercises all four candidates, construction selection, stable module labels P6–P9, downloads/links, the missing-snail state, and mobile overflow. Screenshots and results are under `verification/replication/ui/`.

The software review verdict does not certify any source replica. Jet/medium measured shape checks fail; the larger releases fail sustained rest; the medium car turn fails. Small passes release and its inferred car route but fails the image comparison and lacks complete assembly validation. Large image/path verification and the exact 3D snail source remain missing. This work is submitted as a draft PR with those acceptance gaps visible.
