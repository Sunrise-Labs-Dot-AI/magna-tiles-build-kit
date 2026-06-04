# Codex Handoff — Automated Visual-Acceptance Gate (make the authoring loop systematic)

## The problem this solves
The whole system has exactly one "looks right" signal: a human's eyes. Every automated check
(`no-overlap`, `validateBuild`, structural specs) is *geometric*, not *perceptual* — a build
can pass all of them and still look like a jumble. So a human is forced into every authoring
iteration. This gate adds the missing perceptual signal: an automated judge that compares a
rendered build to its reference photo and returns a score + specific structural differences, so
the authoring agent self-corrects WITHOUT a human each round. The human becomes the final
approver, and the judge owns regression detection entirely.

## Hard-won context (do not repeat past failure modes)
- Twice, automated "green" signals lied (tests passed / `validation:"pass"` while builds were
  visibly wrong) because the checks didn't measure the real thing. This judge is another
  automated signal, so it MUST be calibrated against known human verdicts and MUST fail-closed.
  It does NOT replace final human signoff; it removes the per-iteration grind and automates
  regression.
- Reference photos are on disk: `public/reference-frames/<id>/*.jpg`. Renders are produced by
  the harness into `verification/<id>/*.png`. OpenAI is already wired (the reference encoder
  uses `OPENAI_API_KEY`; see `lib/reference-encoder/model-options.ts`).
- The approved small ramp (`build-drafts/small-car-ramp.json`, commit `2cbff9b`, James: "this
  is it!") is the canonical POSITIVE calibration case. Old broken renders in git history
  (e.g. baseline commit `63e13a2`) are NEGATIVE cases.

## Prompt (paste verbatim)

```text
You are working in the Magnatiles build kit repo. Build an AUTOMATED VISUAL-ACCEPTANCE GATE so
the build-authoring loop stops needing a human in every iteration. The gate compares a rendered
build to its reference photo with a vision model and returns an actionable verdict. It does NOT
replace final human signoff (verification/SIGNOFF.md) — it gives the authoring agent perceptual
feedback to self-correct, and it automates regression detection.

WHY THIS MUST BE CALIBRATED (read first): twice before, automated "green" signals lied while the
build was visibly wrong. This judge is another automated signal. So you must prove it reproduces
known human verdicts before anyone trusts it, and it must fail-closed (never report "match" when
it cannot actually judge, e.g. missing API key or no reference photo).

STEP 1 — Render-vs-reference judge.
Add lib/verification/visual-judge.ts exporting judgeBuild(id): given a build id, take its renders
(verification/<id>/final-*.png — render them first via the render-draft/verify-builds harness if
missing) and its reference photos (public/reference-frames/<id>/, prefer the final/test frame),
send BOTH to a vision model via the existing OpenAI integration, and return structured JSON:
  {
    verdict: "match" | "revise" | "wrong",
    score: 0-100,
    differences: [ { part: string, observed: string, expected: string, suggestedFix: string } ],
    summary: string
  }
The rubric judges STRUCTURE, not pixels: silhouette/overall shape, presence and arrangement of
parts, proportions, and orientation — render vs reference. Ignore color/lighting/camera. Focus on
the final pose. Fail-closed: if there is no API key or no reference photo, return verdict "wrong"
with summary "judge unavailable" — never "match".

STEP 2 — Calibrate against known verdicts (this is the trust step).
Add tests/visual-judge-calibration.test.ts with a labeled fixture set:
  - POSITIVE: the approved small-car-ramp render must score verdict "match".
  - NEGATIVE: at least one known-bad render (pull one from git history, e.g.
    `git show 63e13a2:verification/<id>/final-default.png`, or render a deliberately broken
    draft) must score "wrong" or "revise".
The judge must reproduce these labels. If it can't, tune the rubric/prompt (NOT the labels) until
it does, and document residual disagreement in verification/PROGRESS.md. A judge that cannot
reproduce the human verdicts is not trustworthy — say so loudly rather than shipping it green.
(Note: the calibration set is meant to GROW — every build James later signs off becomes a new
positive, every one he rejects a new negative.)

STEP 3 — Wire it into the loop and into regression.
- CLI: `npm run judge:build -- <id>` renders the build, runs judgeBuild, prints score + the
  differences list. This is what the authoring agent reads to self-correct (build -> render ->
  judge -> apply suggestedFix -> repeat) with no human until convergence.
- Regression: `npm run judge:all` runs the judge across every build that has a reference photo
  and a recorded human signoff, and exits non-zero if any previously-approved build now scores
  below "match". This catches a good build silently breaking later — zero human needed.

STEP 4 — Prove it on the medium ramp.
Author the medium car ramp (FAITHFUL reconstruction of the reference switchback: low approach
wedge -> raised turn box -> upper ramp segment; reference public/reference-frames/medium-car-ramp/
final-a.jpg, final-b.jpg, slope-face.jpg, rear-support.jpg; BOM 15 small-square, 18
equilateral-triangle, 4 isosceles-triangle) using the judge loop: build -> render -> judgeBuild ->
apply the differences -> repeat until verdict "match" AND no-overlap anchor green AND
validateBuild "pass". Only THEN hand the converged render to James for final signoff. Show your
judge transcript (scores per iteration) in verification/PROGRESS.md.

GUARDRAILS:
- The judge is ADVISORY for "looks right": it gates the agent's self-correction loop and
  regression alerts. It does NOT check verification/SIGNOFF.md — only James does.
- Never tune the judge to make the CURRENT build pass; calibrate it to James's known verdicts.
- The geometric gates still apply: no-overlap anchor + validateBuild "pass" are required
  independent of the judge. All three must hold.
- Fail-closed always: no API key / no reference photo => "wrong", never "match".
- Commit STEP 1-3 (the gate + calibration) before STEP 4 (using it), so the tooling lands as a
  reviewable diff separate from the build work.

DONE: judgeBuild returns calibrated structured verdicts; calibration test reproduces the
small-ramp=match / known-bad=wrong labels; `npm run judge:build` and `judge:all` work and
fail-closed; the medium ramp reaches verdict "match" + anchor green + validation pass via the
auto-loop and is queued for James's final signoff with a per-iteration judge transcript.
```

## Fast-follow (separate handoff): validated authoring macros
Once the judge exists, add parameterized, pre-validated assembly macros on top of the existing
`recipe-compiler` / `edge-attachment`: `wedgePrism({length, slopeAngle, deckTiles})`,
`wallGrid({rows, cols})`, `box({w,h,d})`, `turnSegment(...)`. Each returns tiles+connections
guaranteed overlap-free (asserted by the no-overlap anchor). Authoring then becomes composing
correct prisms instead of guessing raw tiles, so the judge loop converges in far fewer rounds.
The medium ramp is literally two wedge prisms + a turn box — exactly what these macros are for.

## Reviewer notes (for James — not the agent)
- The win is role change, not magic: you go from "hand-correct every iteration" to "approve the
  converged result," and regression becomes fully automated. New hero builds still need your
  final eye; the grind in between is what this removes.
- Trust is earned by calibration: before relying on the judge, confirm its calibration test
  actually reproduces your small-ramp "this is it!" as "match" and a known-bad as "wrong." If it
  doesn't, the judge isn't ready — that's the honest signal, not a reason to lower the bar.
- Every build you sign off or reject should be added to the calibration set so the judge tracks
  your taste over time.
