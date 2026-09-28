# Captured-fold continuation code review

Fresh independent read-only GPT-5.5 medium34365 found one critical and three warning issues. All accepted and corrected. This uses the established alternate reviewer after the documented Claude subscription OAuth failure. Original findings: `reviews/fold-closure-release-code-review.txt`.

| Finding | Disposition | Correction |
|---|---|---|
| CRITICAL: report could say completed before instrumentation assertion fails | ACCEPT | Failures remain in the saved incomplete file with a top-level summary; assert instrumentation success before the only completed save, which also rejects a nonempty failure summary. |
| WARNING: missing sleeping/wake evidence | ACCEPT | Every velocity snapshot records sleeping, each mode change records/asserts wake=true, and newly released bodies must be awake before the first native step. |
| WARNING: cumulative pop IDs presented as new events | ACCEPT | Each event records both newIds and cumulativeIds explicitly. |
| WARNING: separated-edge failure could have an unrelated cause | ACCEPT | Record actual root:3/end:1 edge geometry. Require original contact gap to pass, translated gap to fail, preserved axis agreement/longitudinal overlap and no solid intersection. |

The main-agent audit also requires exactly one observed world, three panel mode changes and all14,400 native steps for any passing support phase; missing instrumentation cannot silently count as a pass. Fresh verifier28228 returns ADDRESSED on all four fixes without remaining findings: `reviews/fold-closure-release-code-fix-review.txt`. Post-fix type checking and focused lint pass. Verdict CLEAN for the bounded experiment's execution. Subsequent native execution38497 completes12 captured-release branches with unchanged inputs and no instrumentation errors; independent results review38963 is VERIFIED/CLEAN. The observed outcomes and limitations are in `2026-09-28-fold-closure-release-increment.md`.
