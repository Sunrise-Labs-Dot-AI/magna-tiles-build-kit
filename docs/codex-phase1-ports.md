# Codex Handoff — Phase 1: Connection-Port System + `switchbackRamp` composite

Run in a **NEW session** (foundational composition change; keep it out of the build loop). **Pause
the medium-ramp hand-tuning loop** — Phase 1 re-authors the medium ramp as a parametric composite,
so further origin-guessing is wasted.

## Why
Every medium-ramp iteration has sound *pieces* but a wrong *composition*: the switchback keeps
collapsing into "a ramp beside a wall" because macro positions are hand-tuned absolute origins
(guessed). Ports make composition **relational** — pieces snap by named connection points, so the
switchback is structural by construction, not a coordinate guess. Ports are also the substrate for
prompt→build (Phase 2/3): a prompt becomes "attach these macros by these ports," which an LLM can
emit reliably; coordinates it cannot.

Staged so the foundation lands and verifies before the composite uses it. You may stop after Step 2
for James to verify, then continue to Step 3.

```text
Implement Phase 1: a connection-port system for the Magnatiles macros, then a switchbackRamp
composite that proves it. Work on `main` only; never detach. Contract-test everything. Never weaken
a test, the 0.03 hairline, or the validation oracle. Build on lib/magnetic-tiles/macros.ts
(wedgePrism, wallGrid, box, smallLanding, guardRail, attachMacroToEdge, mirrorMacro) and the
existing edge-attachment/basis math. Commit Steps 1-2 first, then Step 3 separately.

STEP 1 — Named ports + port-based attach.
- Give each macro a set of NAMED PORTS. A port = a stable name + the connection FRAME (anchor
  position + orientation/edge) derived deterministically from the macro's own tiles. Examples:
    wedgePrism: lowEdge, highEdge, leftDeckEdge, rightDeckEdge, baseFloor
    box: top, bottom, front, back, left, right
    wallGrid: baseEdge, topEdge, leftEdge, rightEdge
    guardRail / smallLanding: the edges they attach by
- Add attachByPort(parent, parentPortName, child, childPortName, { foldAngle?, flip? }) that
  repositions/reorients `child` so its named port frame MATES with the parent's named port frame
  (this generalizes attachMacroToEdge to first-class named ports). Composition becomes a tree of
  port attachments; macro positions are DERIVED — no absolute origins anywhere in a composed build.
- Reuse the existing single-tile edge-attachment + basis math; do not reinvent the geometry.

STEP 2 — Prove on a known-good (regression anchor; commit Steps 1-2 here).
- Re-express a known-good build using ONLY ports (no absolute origins): the approved small car ramp
  (build-drafts/small-car-ramp.json) and/or the existing wedge+box+wedge+wall composition fixture in
  tests/macros.test.ts. Assert: overlap-free (raw penetration > 0.03 == none), validateBuild "pass",
  and it reproduces the known-good (same BOM, and structuralSignature match for the small ramp). If
  ports cannot reproduce a known-good build, the ports are wrong — fix them, do not fudge the test.

STEP 3 — switchbackRamp composite (separate commit).
- Build switchbackRamp({ lowerLength, upperLength, slope, towerHeight, withGuardRails }) that
  assembles lowerWedge + turnBox + upperWedge + short tower + guardRails ENTIRELY via attachByPort:
    * the upper wedge attaches to the turn so it climbs in the OPPOSITE direction from the lower
      wedge BY CONSTRUCTION (mirror/fold across the turn — not a tuned origin);
    * the tower attaches UNDER the upper wedge's high end (not behind it as a backdrop wall);
    * guardRails attach to the upper wedge's deck-edge ports (slope-parallel).
- CONTRACT TEST (strict): overlap-free + validateBuild "pass"; AND a STRUCTURAL assertion that the
  result is actually a switchback: the upper wedge's drive/slope direction OPPOSES the lower wedge's
  (opposite sign along the drive axis), and the tower's footprint sits under the upper wedge's high
  end rather than behind the lower wedge. This encodes "switchback, not straight ramp" as a test.

GUARDRAILS: main only/no detach; never weaken the hairline or oracle; prove on a known-good before
the composite; commit ports+proof first, composite second; report what landed.

DONE: macros expose named ports; attachByPort composes relationally with zero absolute origins in a
composed build; a known-good build is reproduced via ports; switchbackRamp assembles a
provably-switchback ramp that is overlap-free + "pass"; full suite green with no weakened assertions.
```

## After Phase 1 lands
Re-author the medium ramp in the builder loop as `switchbackRamp({...})` — reviewer corrections
become parameter tweaks (lowerLength / upperLength / slope / towerHeight), which should converge in
a couple of iterations instead of oscillating. The large ramp and jet later compose via ports too.
The still-missing equilateral brace cluster remains deferred until a `brace` macro exists.
