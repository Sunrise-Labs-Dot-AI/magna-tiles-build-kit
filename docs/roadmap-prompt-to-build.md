# Roadmap — User Prompt → Realistic Build + Instructions

## North star
A user types a prompt ("a fire truck", "a tall castle", "a ramp for my cars") and gets a
**realistic, physically-valid Magna-Tiles build** with **step-by-step instructions**.

## The hard truth this plan routes around
Blind end-to-end generation (prompt → raw tile geometry) was the original approach and it
**failed**: it produced overlap-free-but-unrecognizable junk, because nothing could see the result
or reason about structure. We are NOT going to get to the north star by "making the generator
smarter." We get there by building a **vocabulary of validated, composable, parametric parts** and
teaching an LLM to map a prompt into a *composition* of those parts — never into freeform geometry.
Coverage grows with the vocabulary; quality is gated by the oracle + vision judge + human.

## Where we are today (assets to build on)
- **Honest geometry floor:** strict `validateBuild` + the `no-overlap` anchor (raw 0.03 hairline).
  Nothing physically impossible can pass. This stays the hard gate at every phase.
- **Render + see:** the screenshot harness, and a confirmed result that **Codex can see images at
  runtime** (the reviewer vision self-test passed). So perceptual feedback is available.
- **Macros:** validated `wedgePrism / wallGrid / box / smallLanding` + `attachMacroToEdge` —
  primitives that are provably overlap-free and can reproduce an approved build tile-for-tile.
- **Two-session builder/reviewer loop** with calibration against human-approved builds.
- **Instructions already mostly work:** `generateStepInstructions` derives honest, structure-named
  steps from a build's tiles/steps/roles. Compose from macros that carry step metadata and
  instructions come almost for free.
- **In flight:** Magna-Tiles physical research (real dimensions, magnet rules, set composition) to
  replace guessed constants.
- **Approved builds so far:** small car ramp (1). Medium ramp in progress (~70/100).

## Core strategy: a ladder, not a leap
Each rung ships a usable product and is built from the rung below. Generation is always
"prompt → composition of validated parts," never "prompt → geometry."

### Phase 0 — Bootstrap the vocabulary (in progress)
Finish the hand-authored hero builds (ramps, then jet) via the macro + review loop. This is not a
detour from the goal — each approved build (a) becomes a **template**, (b) becomes a **calibration
exemplar** for the vision judge, and (c) **forces the macro vocabulary to grow** (ports, a
guardRail/brace macro, etc.). *Deliverable:* 3–5 approved builds + the macros they required.

### Phase 1 — Make the parts parametric & relational (the efficiency unlock)
- **Connection ports:** give each macro named attach points (`wedge.highEdge`, `box.topFace`, …)
  and compose via `attachMacroToEdge`, NOT absolute origins. Geometry becomes *derived*, not
  guessed — this is what collapses the iteration count.
- **Composite templates:** `switchbackRamp({segments, length, slope})`, `gabledHouse(...)`,
  `foldedBoxWithWings(...)` — each a whole build as ~3–5 parameters, assembled from primitives via
  ports, guaranteed overlap-free by the oracle.
*Deliverable:* every hero build re-expressed as a parametric template; new sizes/variants are free.

### Phase 2 — Prompt → template (first real "prompt → build")
Replace the dead procedural generators behind `prompt.ts` with template selection:
- LLM (reuse the existing OpenAI integration) classifies the prompt to the nearest template family
  and extracts parameters (size, count, color, proportions).
- Instantiate the template with those params → a real, human-approved *structure*, sized to the
  prompt, with auto-generated instructions.
- **Graceful degradation:** out-of-vocabulary prompts return "I can build X / Y / Z — want one of
  those?" rather than emitting garbage.
*Ship gate:* this is the first honest prompt→build — narrow coverage, but every output traces to an
approved structure. **This is the minimum viable north-star product.**

### Phase 3 — Prompt → composition (real generative coverage)
LLM decomposes a prompt into a *composition* of parametric templates/primitives
("fire truck = long box cab + box body + wheel motifs"), assembled relationally via ports,
oracle-validated, vision-judged. Coverage expands to novel combinations, still bounded by the
vocabulary (bounded = reliable).
*Ship gate:* users can get plausible builds for prompts no one pre-authored.

### Phase 4 — Closed-loop self-correction
Prompt → compose → render → **vision judge against the *intent*** ("does this read as a {prompt}?",
anchored on the approved-exemplar library) → self-search parameters to maximize the score → human
spot-check only. Human load drops from "author each build" to "spot-check + grow the library."
*Ship gate:* quality and coverage improve without proportional human effort.

## Cross-cutting invariants (true at every phase)
- The geometry floor (`validateBuild` + no-overlap anchor) is never weakened to ship coverage.
- The vision judge is only trusted as far as it reproduces human verdicts; calibration set grows
  with every approved/rejected build.
- Instructions are derived from the composition's step/role metadata — not hand-written per build.
- Research-grounded real dimensions/physics replace guessed constants underneath all of it.

## Honest risks / unknowns
- **Phase 4's intent-judge is the hardest open problem** — "looks like a fire truck" is a vaguer
  judgment than "matches this photo." Mitigation: anchor on the exemplar library; keep human
  spot-check; don't over-promise arbitrary-prompt quality early.
- **Coverage is bounded by vocabulary.** The product must set expectations and degrade gracefully,
  not pretend it can build anything.
- This is multi-phase engineering. Resist the urge to jump to Phase 3/4 before the parts
  (Phase 1) and the first reliable mapping (Phase 2) exist — that's the leap that already failed.

## Immediate next step
Finish Phase 0 (medium + large ramp, jet) **while** starting Phase 1's connection-ports work, since
ports are what make both the remaining hero builds *and* all generation converge.
