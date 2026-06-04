# Codex Handoff — Reconstruct Library Builds from the Reference Photos

The decision (after generation and two stabilization passes failed to produce recognizable
builds): **hand-author each library build to match the real MAGNA-TILES reference photos**,
save it as `build-drafts/<id>.json`, and let guided mode replay it. Codex does the authoring
work; a vision-capable reviewer checks each render against its reference photo; James gives
final signoff.

## Why this is different from every prior attempt
Nothing before was built *to a target it could see*. The generator and recipes invented tile
arrangements blind, so they produced overlap-free-but-wrong shapes (spiked walls, jumbles).
Now there is concrete ground truth on disk: the actual builds photographed,
`public/reference-frames/<build>/*.jpg`. The job is to MATCH those photos, not to invent.

**The wall to avoid:** you cannot design a jet blind. If you can view images, open the
reference frames and build to them. Either way, every build is reviewed against its photo
before signoff — geometry that passes tests but does not match the photo is NOT done.

## What is already in place (use it, don't rebuild it)
- **Replay path (wired):** `/api/library-build` → `loadAuthoredLibraryBuild(id)` →
  `draftToBuildGraph` → strict `validateBuild` → `generateStepInstructions`. Guided mode loads
  `build-drafts/<id>.json` by id (filenames already match library ids).
- **Authoring ops:** `lib/builder/operations.ts` (`addRootTile`, `addEdgeSnappedTile` with
  half-thickness fold correction, `mirrorBuilderTiles`, `evaluateReviewReadiness`).
- **Hard physical gates:** `tests/no-overlap.test.ts` (0 pairs with prism penetration > 0.03,
  no floating) and `validation.ts` (0.03 hairline, overlap = `error`). These are FIXED — do
  not relax them.
- **Reference data:** semantic encodings in `lib/reference-encoder/examples/*` give BOM + step
  order + techniques + prose. Photos in `public/reference-frames/*` are the visual target.

## Prompt (paste verbatim)

```text
You are working in the Magnatiles build kit repo. Decision: hand-author each guided library
build to MATCH its real MAGNA-TILES reference photos, save as build-drafts/<id>.json, and let
guided mode replay it (the replay path is already wired: /api/library-build ->
loadAuthoredLibraryBuild -> draftToBuildGraph -> validateBuild -> generateStepInstructions).

Build TO the photos. Do not invent geometry. Ground truth is public/reference-frames/<id>/*.jpg.
Supporting spec is the BOM + step timeline in lib/reference-encoder/examples/* . If you can view
images, open the reference frames and match them. You will be checked against the photos by a
human reviewer regardless.

HARD GATES (fixed, do not weaken):
- tests/no-overlap.test.ts: 0 tile-pairs with prism penetration > 0.03, no floating tiles.
- validation.ts: status must be "pass" (overlaps are errors; 0.03 hairline). No widening.
- Human signoff: you may NOT check verification/SIGNOFF.md. The reviewer compares your render
  to the reference photo and either signs off or returns geometric corrections.

STEP 0 — Visibility helper.
Add scripts/render-draft.ts (reuse verify-builds.ts internals): given a draft id, boot the app,
load that one build via guided mode, and capture 3 angles + per-step screenshots into
verification/<id>/ WITHOUT the pass/fail gate, so every iteration is visible for review.

BUILD ORDER — smallest first, one at a time, fully finished before moving on:

1. SMALL CAR RAMP (build-drafts/small-car-ramp.json). Reference:
   public/reference-frames/small-car-ramp/{bom,wedge,support,test}.jpg ; encoding: the
   small-car-ramp segment in lib/reference-encoder/examples/car-ramps-reference.ts.
   BOM (exact): 5 small-square, 2 right-triangle, 2 isosceles-triangle.
   TARGET SHAPE (from the photos): a TRIANGULAR-PRISM WEDGE, not a wall or a stack.
     - Two right-triangles stand vertically as the two side walls of the wedge, parallel,
       spaced one square-width apart along z. Their hypotenuses define a shallow incline
       (low at the front/approach end, high at the back).
     - Square tiles lie across the two triangle sides as the sloped DRIVING DECK, folded to
       the incline angle so a car could roll down.
     - At the HIGH end: a square LANDING sits flat on top, with isosceles-triangle side
       support(s) (the green piece in test.jpg).
     - It must read as a ramp a toy car rolls down. Compare your render directly to test.jpg.
   Author the draft so draftToBuildGraph(draft) is overlap-free (no-overlap anchor green),
   validates "pass", uses exactly the BOM, and matches test.jpg. Render via render-draft.ts and
   iterate until it matches. Commit. Then STOP and request reviewer comparison before build 2.

2. MEDIUM CAR RAMP, then 3. LARGE CAR RAMP, then 4. JET AIRCRAFT — same loop: read that build's
   reference frames + encoding segment, author the draft to match the photos, render, iterate to
   overlap-free + pass + photo-match, commit, request review.
   Notes: Large ramp's reference BOM lists XL squares not in the Classic-100 catalog — approximate
   with large-square and record the substitution in NOTES, or ask the reviewer. Jet frames:
   public/reference-frames/jet-aircraft/{bom,body-balance,nose-attach,wing-attach,
   tail-ordering-tip,top-fin,final-front,final-side,final-rear}.jpg.

GUARDRAILS: no stubs; no weakening tests/oracle/anchor; commit per build with a clear message;
update verification/PROGRESS.md per build with the render path and pass/overlap status. Do not
batch all four blind — finish and get each one reviewed before the next, because the reviewer's
corrections on the ramp will inform the harder builds.

DONE (per build): authored draft matches the reference photo (human signoff in SIGNOFF.md),
overlap-free (anchor green), validates "pass", honest structure-derived instructions, replays
correctly in guided mode.
```

## Reviewer notes (for James / the vision-capable reviewer — not the agent)
- The review loop is the safeguard: after each `scripts/render-draft.ts` run, compare
  `verification/<id>/` to `public/reference-frames/<id>/` and either sign off or hand back
  specific corrections ("slope too steep", "landing should sit flat on top, not vertical").
- Start with the small ramp on purpose — 9 tiles, an unambiguous wedge. If Codex can nail that
  against `test.jpg`, the loop works and the harder builds are the same loop with more tiles.
  If it can't match even the ramp, that tells you Codex can't see well enough and the authoring
  should move into the in-app builder (you as eyes+hands) instead.
- The large ramp's XL squares are a real catalog gap — decide approximate-vs-descope when it
  comes up; don't let it silently substitute and break geometry.
