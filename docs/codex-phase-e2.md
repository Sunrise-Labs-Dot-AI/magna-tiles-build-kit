# Codex Handoff — Phase E2: Make the physics engine the verification gate

Run in a **NEW session** (builds directly on the E1 engine; main only). E1 delivered a credible
headless physics engine (`simulate` / `rollTest`) that I independently verified: it passes the
small ramp (settles, ball rolls) and correctly rejects the bogus iteration-13 medium (collapses)
and jet (47 invalid connections + collapse). E2 makes that engine the **source-of-truth gate** and
demotes the geometric/structural proxies to cheap pre-filters.

**The one non-negotiable:** when the engine becomes the gate, the jet and medium library builds WILL
fail — they're genuinely bogus. That is correct. Do NOT weaken the engine to keep them (or the test
suite) green. A failing build is a wrong build, not a wrong gate.

```text
Make the physics engine the source-of-truth verification gate for Magna-Tiles builds, demoting the
geometric/structural proxies to pre-filters. Work on `main`; commit discretely. Build on lib/engine
(simulate, rollTest) from Phase E1.

STEP 1 — A single engine gate.
Add gateBuild(build) -> { passed: boolean, reasons: string[] } that decides, in order:
  (a) cheap PRE-FILTER: raw no-overlap check + connection validity (validateMagneticBuild). Fast-fail
      obviously-broken builds before spinning up physics.
  (b) simulate(build).stands must be true (no collapse, no popped joints).
  (c) if the build is functional (a ramp): rollTest(build) must pass (reachedBottom && !fellOff).
      Non-functional/recognizable builds (jet, animals) gate on (a)+(b) only — physics cannot judge
      RESEMBLANCE, so "looks like a jet" stays a human signoff, noted in the verdict reasons.

STEP 2 — Gate tests/verification on the engine; demote the proxies.
- The shipped-build gate becomes gateBuild. Replace, AS GATES, the prompt-set / library
  "validateBuild status === pass" assertions and the reference-acceptance silhouette/subassembly/
  role checks with gateBuild. Keep no-overlap + validateBuild ONLY as pre-filters inside gateBuild
  (advisory), not the final word. The hollow proxies (regex instruction matches, silhouette bounds)
  are demoted to advisory or removed — they are not gates.
- The verify harness (extend verify-builds.ts or add verify-physics.ts) gates on gateBuild and exits
  non-zero on failure.

STEP 3 — Let the bogus builds fail honestly (do NOT weaken the engine).
- jet (47 invalid connections + collapse) and medium iteration-13 (collapse) will FAIL gateBuild.
  Correct. Mark them as "not engine-valid — pending re-authoring (E4)" and exclude them from the
  shipped/engine-valid set (or mark expected-fail). The small ramp PASSES and is the one engine-valid
  build today.
- ABSOLUTELY DO NOT tune MAGNET_HOLD_FORCE, the break constants, mass/friction, or the collapse
  thresholds to make the bogus builds pass. If a build fails the gate, fix the build (later, E4), not
  the gate. Any constant change must still reproduce the full E1 calibration suite.

STEP 4 — Keep + grow calibration.
- The E1 engine-calibration suite must stay green. Register the small ramp as an engine-valid anchor;
  add any other physically-confirmed builds as anchors as they appear.

STEP 5 — Spec/DoD update.
- Update docs/codex-stabilization-spec.md: "buildable / verified" now means gateBuild passes
  (engine: stands, and rolls if a ramp), superseding "validateBuild status pass." Honestly flip the
  jet and medium per-build checkmarks to reflect engine-fail-pending-reauthoring. Note that
  resemblance for recognizable objects remains a human signoff on top of the engine gate.

GUARDRAILS: the engine is the gate; proxies are pre-filters/advisory only; never weaken the
engine/constants/thresholds to keep builds or tests green (failing builds are wrong builds); the E1
calibration suite stays green; main only; commit discretely. Report which builds pass vs fail
gateBuild and why.

DONE: gateBuild is the single verification source of truth (engine stands + rolls; proxies are
pre-filters); tests + verify harness gate on it; the bogus jet/medium honestly fail and are marked
pending-reauthoring while the small ramp passes; E1 calibration green; spec updated; zero engine
weakening. npm test / lint / build green (with the bogus builds excluded/expected-fail, not faked).
```

After E2: the engine is the honest gate, exactly one build (small ramp) is engine-valid, and the
3D builds get re-authored against the engine in a later phase (E3 sandbox UI / E4 re-author).
