# Medium-ramp initial assembly and general construction checks

## Outcome

The 37-piece medium candidate now has passing proposed construction for its four-piece lower wedge and five-square support, evaluated together in one continuous workspace across seeds 0, 17 and 53. Every operation and mandatory free checkpoint passes under clear-first. All nine placed parts remain dynamic during final release. The six later stages remain unverified; source fidelity and passive turning are separate unresolved gates. No full replica is promoted.

## Implementation

- Retained pickup identifies the exact prior grip, verifies withdrawal of the other hand, performs the one-hand support transition, then lifts from the actual settled state. Regrasping, duplicate/third hands and blocked withdrawal fail before lifting.
- Grip-aware insertion searches the same five translation directions, requiring both finite-solid and fingertip clearance. The exact selected path drives the simulation. Deadlines propagate through hand checks; docking, ordinary insertion and gravity seating have no unchecked fallback.
- Independent workspace closure permits the first held part of a declared new module beside released obstacles. Every group must retain its own contacts, the move belongs to one group, and cross-group magnetic matches are rejected at both endpoints. Subsequent parts still require separated new joins.
- Ordinary support changes now retain and validate the prior grips. Implicit regrasping, an old/new union needing three hands, and blocked withdrawal fail before changing physical support. Controlled lowering starts from a checked one-hand support state; mandatory free checkpoints also check final withdrawal. The medium support explicitly releases after each extension before changing support grip.
- Medium instructions explicitly label the detailed grips, insertion order, lift and workspace placement as simulation proposals. All 37 source parts, dimensions, poses and joins remain unchanged. The support starts beside the actual released wedge, which remains an obstacle and dynamic body throughout.
- Browser verification now checks retained pickup, the nine-part medium workspace and the later unverified stage, and updates the former small-ramp failure expectation to its verified complete assembly result.

## Review and evidence

Full engineering loop applies to runtime acceptance and visible instructions. Claude subscription OAuth was unavailable as recorded earlier; fresh read-only GPT-5.5 reviews supplied the independent lane. Plan/code artifacts are under `runs/reviews/` with prefixes `grip-aware-insertion`, `retained-grip`, `independent-module-start` and `medium-support-final`.

The initial 44-test focused run passed. The next six-test independent-component/lower-wedge run passed. The ordinary transition correction passes 19 focused tests, then all five transition tests including blocked mandatory-checkpoint withdrawal. A four-wall fixture demonstrated the old false pass before the fix. Source-specific candidate comparisons prove the integrated medium geometry and exact construction contracts match its passing stricter experiment. The first full run with the ordinary transition guard exposed implicit small-candidate grip changes; the final fixed-grip correction restores its complete pass without changing geometry.

Retained failures and passing experiments are in `runs/diagnostics/2026-09-27-medium-{lower-lift,roof-held,support-first-held,support-assembled}.json`. Diagnostic motion summaries include sample counts, endpoint poses and hashes; the regenerated source download carries full recorded playback.

The earlier medium support pass is superseded by `runs/diagnostics/2026-09-27-medium-checked-handoffs.json`, which includes the explicit extra release, every ordinary transition and one-hand support before lowering. The first 486-test full run predates that final guard and is preliminary evidence only. Its accompanying source refresh was stopped before code edits. The final validation below supersedes both preliminary runs.

The small fixed-grip correction now passes all three source stages and all seeds under the stricter runtime. Its complete geometry and construction contract match the passing experiment exactly. The wedge uses the existing support-aligned retry after retaining the clear-first rest failures. The new review found no required findings. Evidence: `runs/diagnostics/2026-09-27-small-fixed-grips.json` and `runs/reviews/small-fixed-grips-code-review.txt`.

## Final validation

- Full suite: **491 passed, 1 skipped, 46 test files**, 656.32 seconds.
- Type checking: passed. Full lint: **0 errors, 38 existing warnings**.
- Regenerated independent contact evidence: **72 trials**, lowest passing frequency **120 Hz**. Assembly fixture: **21 operations**, including three gravity placements.
- All four source reports regenerated against the final runtime. Small assembly passes all three stages; medium passes its first two stages and retains the later unresolved checks. Source-shape and car failures remain separate.
- Production build and generated-artifact checks: passed. Original source hashes, candidate geometry, inventories and physical thresholds are unchanged.
- Production browser checks at `http://127.0.0.1:3013/references`: all four downloads passed; recorded small pickup, gravity seating and complete transfer changed the rendered pose; medium pickup retained only its two placed panels and the support release retained all nine workspace parts. Both completed medium stages show passing assembly and the next stage remains unverified. The 390-pixel mobile view has no horizontal overflow and there were no browser errors. Screenshots and structured results are in `verification/replication/ui/`; the medium pickup, support release and mobile images were also visually inspected.

The existing 25/25 structural benchmark remains applicable: this increment changes only source construction acceptance and instructions; the structural runtime and generator are unchanged. The runtime rejects the reproduced implicit-third-hand case before any unsupported support change.

Keep PR #4 draft. No merge or production promotion is authorized. Continue from these primitives into explicit upper-wedge preparation and workspace transfer, source-shape reconstruction and passive car turns. The exact 3D snail source remains missing; a user question for its link or local path is pending while independent work continues.
