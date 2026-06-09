# Codex Handoff — Phase E4: Re-author the 3D builds against the gate (programmatic)

Run in a **NEW session**; main only. The engine (E1) + gate (E2) + shared-physics sandbox (E3) are
in place and independently verified. E4: re-author the failing 3D builds **programmatically** —
compose via macros/ports/construction API, iterate against **headless `gateBuild` until it genuinely
passes**, save the draft. No UI clicking. James opens the result in the sandbox to confirm + sign off
resemblance. One build at a time; STOP after each for James's review.

**Why this is different:** `gateBuild` is physics, not a proxy — a ramp passes only if a ball
actually rolls down it; any build passes only if it actually stands. You are iterating against a
signal you cannot game.

**THE guardrail (unchanged and absolute):** never weaken the engine, constants, thresholds, or
`gateBuild` to make a build pass. If a build fails the gate, fix the BUILD. Every constant must still
reproduce the E1 calibration suite, the E2 gate, and the independent raw-overlap anchor.

```text
Re-author the failing 3D library builds so each PASSES headless gateBuild, composing programmatically
via the macros/ports/composites + construction API (snap-only, valid connections by construction).
Work on `main`; commit per build. NEVER weaken the engine/constants/gateBuild to pass — fix the build.
Do them in order; STOP after each and tell James to review in the sandbox before the next.

For EACH build: compose -> run headless gateBuild -> read the verdict reasons -> adjust the
composition/params -> repeat until gateBuild PASSES -> write build-drafts/<id>.json -> add the id to
verification/engine-valid-builds.ts (this auto-extends the calibration + raw-overlap anchor) -> render
it (npm run render:draft) -> STOP and tell James: ready for sandbox resemblance review.

1. MEDIUM CAR RAMP — re-author as a CLEAN scaled-up wedge (a longer/taller version of the approved
   small ramp), NOT a switchback. The rollTest gate requires a continuous rideable surface; a
   switchback's ball flies off at the reversal. Use the wedge/guardRail vocabulary. Must pass
   gateBuild: stands + rollTest (ball reaches bottom, doesn't fall off). classic-100 preset.

2. LARGE CAR RAMP — a bigger continuous wedge ramp; declare the builder-xl preset (XL square is
   available). Wide rideable surface + side guardRails + supports. Must pass gateBuild stands +
   rollTest. (If the XL plane geometry makes rollTest fail, prefer a buildable continuous surface
   over faithfulness to the filmed XL build — note any deviation.)

3. JET AIRCRAFT — hardest, and recognition-bound. gateBuild only checks that it STANDS (no function),
   so the engine bar is: a real connected structure (valid magnetic connections, no collapse). The
   current jet has 47 invalid connections and collapses — re-author it. You will likely need NEW
   contract-tested primitives (e.g. a wing / fuselage) added just-in-time, each with the same hard
   contract as the existing macros (overlap-free, validates, predictable BOM). Passing gateBuild does
   NOT mean done — "looks like a jet" is James's resemblance signoff. Get it standing + connected via
   the engine, then hand to James for the resemblance call.

DEFINITION OF DONE per build: gateBuild PASSES (engine-verified, reasons reported); added to the
engine-valid set; draft saved + rendered; the E1 calibration / E2 gate / raw-overlap anchor all still
green; constants untouched. Recognizable objects (jet) additionally await James's resemblance signoff
in verification/SIGNOFF.md before being called shippable.
```

## Notes for James
- gateBuild passing = **engine-valid** (it stands; ramps roll). For ramps that's close to done — you
  just confirm it reads as a ramp. For the jet, engine-valid only means "real standing structure";
  whether it looks like a jet is your eye, in the sandbox.
- The medium/large = scaled-wedge decision reverses the earlier faithful-switchback choice, driven by
  the rollTest functional gate. If you'd rather keep switchbacks, that's a `rollTest` upgrade
  (multi-segment path) first — say so and I'll spec it.
- The jet is the residual hard problem (new primitives + resemblance). Expect it to take longer than
  the ramps and to bounce on your resemblance signoff even after it passes the engine.
