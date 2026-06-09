# Codex Handoff — Validated Structural Macro Library

## Why
The two-session builder/reviewer loop works (Codex can see; the reviewer is calibrated and
trustworthy), but the Builder can't converge complex builds: it sculpts ~37 loose tiles by
qualitative nudges, so every correction perturbs the whole and it *regresses* (medium ramp
peaked at iteration 3 / score 72, then slid back to 38 — a random walk, not convergence).

The fix: give the Builder validated structural PRIMITIVES that are guaranteed overlap-free, so
a complex build is "compose 3-4 named pieces and angle them," and a reviewer correction changes a
piece's PARAMETER (length / slope / anchor) instead of jostling individual tiles. Corrections can
no longer shatter the rest of the build, so the loop converges.

## Prompt (paste verbatim — run this FIRST, before resuming the medium-ramp builder loop)

```text
You are building a validated structural macro library for the Magnatiles build kit so complex
builds can be composed from sound primitives instead of hand-placed loose tiles. Build on the
existing geometry layer: lib/magnetic-tiles/edge-attachment.ts (makeAnchorTile, attachTile,
basis), recipe-compiler.ts, and the existing recipes (recipes/small-car-ramp.ts) as references.

DELIVERABLE: lib/magnetic-tiles/macros.ts exporting parameterized primitives, each returning
{ tiles, connections } with roles/steps/subassemblyId set, placeable at a given origin +
orientation so they compose in world space:

- wedgePrism(params): a triangular-prism ramp segment — two triangle side faces + a sloped
  square "driving deck" laid on the hypotenuse (+ optional floor). Params: deck length (# squares),
  slope set by the side-triangle shape (right vs isosceles vs equilateral), width, origin,
  facing/lean direction. This is the core ramp unit.
- wallGrid(params): a flat rows x cols grid of squares, vertical or horizontal. For rear-support
  walls and box faces.
- box(params): a rectangular block from square faces (open or closed), w x h x d in tiles. The
  "turn box"/platform unit.
- A compose/anchor helper so one primitive can be positioned relative to another (origin +
  orientation, or attach edge-to-edge), and an existing-style mirror for symmetry.

HARD CONTRACT (each primitive AND any composition must satisfy, enforced by tests):
- Zero raw overlaps: no tile-pair with prism penetration > 0.03 (reuse the no-overlap anchor's
  method, no magnetic-hinge excuse).
- validateBuild => status "pass".
- Correct, predictable BOM (tile counts) for given params.
Do not weaken the 0.03 hairline or any check to make a macro "fit" — fix the macro's geometry.

TESTS: tests/macros.test.ts must, for representative params of each primitive, assert
overlap-free + validates pass + expected BOM. Add a COMPOSITION test that assembles a multi-segment
build (lower wedge + turn box + upper wedge leaning the opposite way + rear wall) and asserts the
whole thing is overlap-free + passes.

PROVE IT ON A KNOWN-GOOD: re-express the already-APPROVED small car ramp
(build-drafts/small-car-ramp.json, James-approved at commit 2cbff9b) as a composition of macros
(one wedgePrism + a small landing). Confirm the macro-built version is overlap-free, validates
pass, and is structurally the same as the approved draft. If the macros can't reproduce the
known-good ramp, they're wrong — fix them, don't fudge the test.

GUARDRAILS: no stubs; commit the macro library + tests as their own reviewable diff BEFORE using
it for any build; the macros are an authoring TOOL — they do not auto-approve anything, the
two-session reviewer loop still gates visual correctness.

DONE: macros.ts + tests green (each primitive overlap-free/valid/correct BOM; composition test
passes; small ramp reproduced from macros). Then STOP — the medium-ramp builder loop resumes using
these primitives.
```

## How the Builder loop changes after the macros exist
Update the BUILDER session (docs/codex-builder-session.md) to author by COMPOSING macros, and to
respond to reviewer corrections by changing macro PARAMETERS, not raw tiles. Add these rules:

- Build the medium ramp as: `lowerWedge` (front approach) + `turnBox` (raised center) + `upperWedge`
  (leaning the opposite way, anchored on top of the box) + `wallGrid` rear support. Position/anchor
  the pieces; let the macros guarantee each piece is internally sound.
- A reviewer correction maps to a parameter/anchor change ("upper ramp should lean back more / sit
  further behind the turn" => adjust the upperWedge orientation/origin), never a loose-tile nudge.
- ANTI-REGRESSION RULE: track the best reviewer score so far and the commit that produced it. Never
  build forward from a state that scored lower than the best. If a change regresses the score,
  revert to the best commit's draft and apply the correction a different way. (This stops the
  iter-3 -> iter-4 backslides.)

## Reach for the harder builds
- Large ramp = a big `wedgePrism` + tall `wallGrid` rear wall + `box` platform — same primitives.
- Jet = `box` fuselage + mirrored wing/tail triangle fans (may need one new primitive, e.g.
  `panelFan`/`wing`); add primitives only as a build needs them, each with the same hard contract.
