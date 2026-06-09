# Magnatiles Build Kit — Core Stabilization Spec (Definition of Done)

This document is the single source of truth for "done" on the core-stabilization task.
Keep it current: when a criterion is met, check it and link the evidence screenshot/test.

## Mission & scope
Make the library builds and prompt mode produce **correct, product-quality** builds,
instructions, and per-step visuals — proven by rendering each build in the running dev
server and verifying it against its target. IN SCOPE: jet aircraft, small/medium/large car
ramp, prompt mode, the physics gate, and the verification harness. OUT OF SCOPE (record ideas
in NOTES, do not build): new build families, YouTube/reference-encoder features beyond what
the 4 builds need, PDF/export, the free-build sandbox. Do not start out-of-scope work.

## What "product quality" means here
A build is correct only if ALL hold:
1. **Looks right:** the rendered 3D model is recognizable as its target (a jet reads as a
   jet with fuselage + symmetric wings + pointed nose + tail fin; a ramp reads as a
   continuous climbable incline with support + side guards).
2. **Is buildable for real:** `gateBuild` passes. The gate fast-fails raw overlaps and invalid
   magnetic connections, then requires the physics engine to stand; ramps must also pass
   `rollTest` (`reachedBottom && !fellOff`). `validateBuild` is advisory/pre-filter context,
   not the source of truth for "verified."
3. **Uses only tiles in the build's declared inventory preset:** no unsupported shapes; BOM matches the reference where one exists.
4. **Instructions match the structure:** step text names the actual parts ("sloped driving
   surface", "fold the nose"), not generic "Build the next layer". Step order is valid
   (supports before the tiles they hold).
5. **Per-step visuals are correct:** scrubbing steps in the viewer shows progressive, correct
   assembly that ends at the finished model.

## Verification protocol (the core of this task)
Verification is **rendering + looking**, backed by deterministic assertions. "npm test passes"
is NOT acceptable as proof on its own.

- **Dev-server screenshot harness** (`scripts/verify-builds.ts` or similar): boot the app
  (`next build && next start`, or `next dev`), drive a headless browser (add Playwright as a
  devDependency) to load each library build and a fixed prompt set with deterministic seeds,
  wait for the Three.js canvas to settle, and capture multi-angle + per-step screenshots into
  `verification/<build-id>/`. Generate a `verification/contact-sheet.md` linking every image.
  Inspect these against the target before claiming a build correct.
- **Engine gate** (`gateBuild`): raw no-overlap and magnetic connection validity are
  pre-filters only; `simulate(build).stands` is required for every build; ramps additionally
  require `rollTest(build)` to reach the bottom without falling off. Recognizable-object
  resemblance (for example, "looks like a jet") remains human signoff on top of the engine gate
  because physics cannot judge resemblance.
- **Advisory structural checks:** reference silhouette, role, subassembly, regex-instruction,
  and monotonicity checks may remain as diagnostics, but they are not gates.
- **Regression fixtures:** convert each `bug-reports/*.md` into a test case that asserts the
  reported defect no longer occurs. They must all go red→green.
- **No-cheating rule:** if a test/validation check is itself wrong, fix its logic and write
  down why. Never weaken a real check, delete a failing test, or widen a tolerance to hide a
  defect.

## Per-build acceptance criteria
For EACH of the four, attach an evidence screenshot path when checked.

### Jet Aircraft  (`prompt: "Jet Aircraft"`, library id `jet-aircraft`)
- [x] Generator actually uses `JET_AIRCRAFT_RECIPE` (verify `compiledRecipeFor` no longer
      returns `null` for aircraft; the imported recipe is reached). Evidence: `tests/reference-acceptance.test.ts`, `verification/jet-aircraft/final-default.png`
- [x] family === "aircraft"; renders with central fuselage, mirrored symmetric wings,
      pointed nose, tail/fins. Evidence screenshot: `verification/jet-aircraft/final-default.png`
- [ ] engine-valid: **fails gateBuild** with invalid magnetic connections / not standing. Status:
      `engine-fail-pending-reauthoring` for E4. Resemblance still needs human signoff after this
      passes.
- [x] instructions name real parts (fuselage/nose/wings/tail) and order is valid. Evidence: `verification/contact-sheet.md`
- [x] per-step scrub renders correct progressive assembly. Evidence: `verification/jet-aircraft/step-01.png` through `step-07.png`

### Small / Medium / Large Car Ramp  (`small|medium|large-car-ramp`)
- [x] family === "ramp"; correct recipe used per size (small/medium/large map to the right
      `*_CAR_RAMP_RECIPE`). Evidence: `tests/reference-acceptance.test.ts`
- [x] small ramp is engine-valid: `gateBuild` passes and `rollTest` reaches the bottom without
      falling off. Evidence: `tests/engine-gate.test.ts`, `tests/engine-calibration.test.ts`
- [ ] medium ramp is engine-valid: **fails gateBuild** / pending E4 re-authoring.
- [ ] large ramp is engine-valid: **fails gateBuild** / pending E4 re-authoring.
- [x] instructions use ramp language and describe the actual structure. Evidence: `verification/contact-sheet.md`
- [x] per-step scrub renders correct progressive assembly. Evidence: `verification/small-car-ramp/`, `verification/medium-car-ramp/`, `verification/large-car-ramp/`

## Prompt-mode acceptance
Define a fixed set of ~8 representative in-scope prompts in `verification/prompt-set.ts`
(aircraft and car-ramp wording variations). Generic non-core families are out of scope for
this stabilization pass and should be recorded in NOTES rather than repaired here. For each:
- [x] maps to a sensible family and renders a recognizable experimental draft.
- [ ] engine-valid prompt output: current prompt-generated builds are expected-fail until E4
      re-authoring. They are excluded from the shipped/engine-valid set.
- [x] instructions are build-specific and step order is valid.
- [x] screenshot captured in `verification/prompts/<slug>.png` and reviewed.

## Definition of Done (hard gate — all must be true AND evidenced)
- [x] `gateBuild` is the single source-of-truth verification gate: pre-filters for raw overlaps
      and magnetic connection validity, then engine `stands`, then ramp `rollTest`.
      Evidence: `tests/engine-gate.test.ts`.
- [x] The only current engine-valid shipped build is `small-car-ramp`. Jet, medium, large, and
      prompt outputs are excluded/expected-fail pending E4 re-authoring rather than faked green.
      Evidence: `verification/engine-valid-builds.ts`.
- [x] Instructions are assert-matched to geometry; no in-scope prompt falls back to generic
      "Build the next layer" copy. Evidence: `tests/prompt-set.test.ts`, `verification/contact-sheet.md`.
- [x] `scripts/verify-builds.ts` exits non-zero on unexpected `gateBuild` failure or instruction-step
      mismatch; known bad builds are recorded as expected-fail, not treated as shipped-valid.
      Evidence: `npm run verify:builds`.
- [ ] `verification/SIGNOFF.md` records human approval of each build's renders.
      Evidence: pending James review.
- [x] Contact sheet exists and shows final + per-step renders.
      Evidence: `verification/contact-sheet.md`.
- [x] `npm run lint`, `npm run build`, `npm test` all green — with the strengthened tests.
- [x] Reference acceptance uses `gateBuild` for shipped validity; silhouette/subassembly/role checks
      are advisory diagnostics, not gates.
- [x] Every `bug-reports/*.md` has a corresponding green regression test.
- [x] `verification/PROGRESS.md` documents each milestone with evidence.
- [x] NOTES section lists any out-of-scope follow-ups discovered (not implemented).

## NOTES (out-of-scope follow-ups discovered during the task)
- Generic prompt families such as castle, garage/house, animal, tower/lighthouse, rocket,
  and bridge still need their own visual/structural stabilization pass before they should
  be included in the hard prompt-mode gate.
- Large car ramp as filmed is unblocked by the `builder-xl` inventory preset: the reference uses
  Builder XL product-line "XL square" pieces outside Classic-100. `XL_SQUARE_EDGE` is still an
  assumed, unverified single source of truth because the exact edge length is unpublished in the
  sourced research; correct it when a real measurement is found.
