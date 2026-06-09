# Codex Follow-up Prompt — Oracle-First Stabilization (Pass 2)

This is the prompt to paste into a fresh long-running Codex task. It exists because Pass 1
made the checkers green without making the product correct: every "green" signal traced back
to `validateBuild()`, and that oracle is blind to overlap. Pass 2 is built around one
un-gameable check (a raw geometric overlap scan with no magnetic-hinge excuse) and forces
*oracle-first* ordering — prove the check catches the current breakage before fixing anything.

Companion contract: [`codex-stabilization-spec.md`](codex-stabilization-spec.md).

---

## Prompt (paste verbatim)

```text
You are continuing work in this repository (Magnatiles build kit, Next.js 16 / React 19 /
TS / Three.js / vitest). This is a SECOND stabilization pass. The previous pass marked every
box in docs/codex-stabilization-spec.md as done and reported all-green tests — but the
product is still broken. Your job is to make "green" mean "physically real," then fix the
builds. The repo is now a git repo with a baseline commit; commit each step so your work is
auditable by diff.

WHY THE LAST PASS FAILED (do not repeat this — it is the entire point):
The only success signals trace back to validateBuild(), and that oracle is BLIND to overlap.
lib/magnetic-tiles/validation.ts (~line 297) excuses any magnet-adjacent tile pair whose
prism penetration is <= 0.2 — but tiles are only 0.18 thick, so a FULL tile-thickness
interpenetration is forgiven. Every shipped recipe build exploits this. Ground truth from a
raw geometric scan (tilesIntersectAsPrisms with NO magnetic-hinge excuse):
  - Jet Aircraft: validation.status=pass, 0 issues, but 19 overlapping tile-pairs (pen 0.18)
  - Small Car Ramp: pass, 0 issues, 5 overlapping pairs
  - Medium Car Ramp: pass, 0 issues, 11 overlapping pairs
  - Large Car Ramp: pass, 0 issues, 6 overlapping pairs
The screenshot harness (scripts/verify-builds.ts) makes it worse: it records a cosmetic UI
pill string ("geometry valid") instead of validation.status, and asserts NOTHING about the
images. The acceptance + prompt-set tests inherit the blind oracle, and prompt-set instruction
checks are regex keyword matches (steps literally titled "Attach the wings" x5 pass /wing/i).
Renders confirm it: the small ramp is a box with bars passing through it, the jet is an
asymmetric mess with an oversized fin. So: proxies were optimized; the product was not.

NON-NEGOTIABLE PRINCIPLE: Do NOT trust validation.status, the acceptance run, or any UI label
as proof until you have proven the overlap oracle against raw geometry. Fix the oracle FIRST,
watch everything correctly go red, then fix the builds until the un-gameable checks go green.

DO THESE IN ORDER. Commit after each step.

STEP 0 — Reproduce the diagnosis.
Write a throwaway scan (or a test) that, for each library build, runs
tilesIntersectAsPrisms(a,b) over all tile pairs with NO carve-out and counts pairs whose
penetration exceeds a 0.03 hairline. Confirm you see ~19/5/11/6. If you cannot reproduce
this, stop and figure out why before continuing.

STEP 1 — Add the un-gameable anchor test (tests/no-overlap.test.ts).
For every shipped build (4 library + the in-scope prompt set), assert ZERO tile-pairs with
prism penetration > 0.03, computed directly from tilesIntersectAsPrisms WITHOUT calling
findMagneticEdgeMatch and WITHOUT any magnetic-hinge excuse. Also assert no tile floats
(raw geometry). The 0.03 hairline is a FIXED physical contact tolerance — it represents two
panels touching at a shared fold edge, not passing through each other. You may NOT loosen it
to pass. Run the suite now: this test MUST be red on all current builds. If it is green, it
is wrong — make it real.

STEP 2 — Fix the oracle (validation.ts).
Reduce the magnetic-hinge penetration excuse from 0.2 to the 0.03 hairline, and escalate
genuine interpenetration from severity "warning" to "error" so an overlapping build reports
status "error", not "warning" or "pass". Write down in verification/PROGRESS.md exactly what
you changed and why (this is the "fix the check, don't widen it" rule in action). Re-run:
validation.status for all 4 current builds must now be "error".

STEP 3 — Fix the recipe geometry (the actual product bug).
Rework the jet and small/medium/large ramp recipes so tiles seat EDGE-TO-EDGE: offset folded
panels by half-thickness across their hinge, correct fold pivots, and stop nesting panels
inside each other. Iterate until BOTH the anchor test (STEP 1) and validateBuild report zero
overlaps and status "pass" — achieved by moving tiles, never by touching a tolerance. After
each build, re-render it and look at the contact sheet: it must read as the target (jet =
central fuselage + symmetric horizontal wings + pointed nose + upright tail fin; ramp = one
continuous climbable incline with real depth, not a flat billboard — the medium ramp is
currently 2.0 deep, which is wrong).

STEP 4 — Make instructions match geometry.
Generate instructions from the actual tiles and step assignments: real per-step tile counts
(the contact sheet currently shows "2 tiles" next to prose saying "6 squares"), part names
from roles, valid support-before-supported order. Assert instruction step count == the
build's max step, and that NO shipped build falls back to generic "Build the next layer" /
repeated "Attach the wings" copy. Do not use a regex keyword match as proof of correctness.

STEP 5 — Make the visual gate real (verify-builds.ts).
The harness must FAIL the run (non-zero exit) if, for any build: validation.status !== "pass",
OR the raw overlap count > 0, OR the instruction step count mismatches. Read the REAL
validation result, not the ".pill" UI text. Then add a human sign-off gate: a build's spec
checkbox may only be checked when verification/SIGNOFF.md records that a person reviewed that
build's contact-sheet renders and approved them. Screenshots that nobody gated are not
evidence. (Optional supplements, not replacements for the human look: silhouette asserts like
left/right projected-area symmetry for the jet and monotonic height along the drive axis for
ramps — but never bounds-ratio proxies.)

STEP 6 — Honest bookkeeping.
Reset docs/codex-stabilization-spec.md checkboxes to unchecked, then re-check ONLY with real
evidence (anchor test green + validation pass + human SIGNOFF). Do NOT renarrow scope to dodge
red: leave generic families descoped in NOTES if they were, but do not alter any gate to make
it pass. Update verification/PROGRESS.md and REPORT.md with before/after raw-overlap counts.

GUARDRAILS:
- Never widen a tolerance, delete/skip a test, or relax the 0.03 hairline to make a signal go
  green. If a check is wrong, fix its logic and document why.
- No stubs/TODOs/placeholder returns in shipped paths. Stay in scope (jet + 3 ramps + in-scope
  prompts + harness).
- Commit each step separately with a clear message so the oracle change is a discrete,
  reviewable diff.

DEFINITION OF DONE v2 (all true AND evidenced):
- tests/no-overlap.test.ts green: 0 raw overlapping pairs (pen > 0.03) and 0 floating tiles
  for all 4 builds + in-scope prompts.
- validateBuild reports status "pass" for all 4 builds WITH the tightened oracle (verify the
  0.03 excuse and error-severity escalation are in the diff).
- Instructions assert-matched to geometry; no generic/repeated fallback copy.
- verify-builds.ts exits non-zero on bad status/overlap/instruction mismatch; passes cleanly.
- verification/SIGNOFF.md records human approval of each build's renders.
- contact-sheet.md shows recognizable, non-interpenetrating builds.
- npm run lint / build / test green. git log shows the oracle fix as its own commit.
Do not declare done until every item is checked with evidence. If a build's geometry can't be
made overlap-free, document the blocker in PROGRESS.md rather than re-widening the oracle.
```

---

## Reviewer notes (for the human running this — not for the agent)

- **The lever Pass 1 lacked:** STEP 1's anchor test ignores the magnetic-hinge excuse and uses
  a fixed 0.03 physical hairline, so it can't be made green by turning a tolerance knob — only
  by moving tiles. If the agent widens it, the diff shows it and the renders stay wrong.
- **STEP 5 is the honest version of "use the dev server to visually verify."** In Pass 1 that
  step had no teeth: screenshots were generated and self-approved. The only reliable looker so
  far has been a human — so no spec box gets checked without a recorded human look.
- **Watch the medium ramp:** it is `2.0` deep — a flat wall pretending to be a ramp. "Fixing
  overlaps" while leaving it 2D is still wrong; the contact-sheet review must catch that.
