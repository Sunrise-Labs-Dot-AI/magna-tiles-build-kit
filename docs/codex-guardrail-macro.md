# Codex Handoff — `guardRail` primitive (slope-parallel side rail)

Run in a **NEW session** (focused macro addition; keep it out of the build loop). This is the one
library primitive justified right now: both the medium and large car ramps need a side guard that
runs **parallel to the sloped deck**. A prior attempt used a vertical `wallGrid` and it rendered as
a fin sticking off the tower — that is exactly what to avoid.

```text
Add a `guardRail` primitive to the Magnatiles macro library. Work on `main` only; never detach.
Commit as its own discrete diff. Contract-test it. Never weaken a test, the 0.03 hairline, or the
oracle. Build on lib/magnetic-tiles/macros.ts (wedgePrism, attachMacroToEdge, mirrorMacro, etc.).

INTENT: a low rail/brace that runs ALONG one side edge of a wedge's sloped driving deck, oriented to
MATCH the slope angle (parallel to the deck — NOT vertical). It is the "side guard a car won't roll
off" that the reference ramps show as triangle side guards. The failure to avoid: a vertical panel
standing perpendicular to the deck.

PRIMITIVE: guardRail(params) -> { tiles, connections } with roles/steps/subassemblyId set.
- side: "left" | "right".
- follows the slope: accept either an origin + orientation/anchor, or a reference to the wedgePrism
  it rails, so it inherits the deck's slope angle and length.
- length matched to the deck; low rail height; tile shape configurable (default: the triangle type
  the reference ramps use as side guards).
- provide left/right symmetry via the existing mirror helper.

CONTRACT (tests/macros.test.ts or a sibling; ALL assertions strict):
- guardRail alone: raw overlaps (penetration > 0.03) == none; validateBuild status "pass";
  predictable BOM for given params.
- wedgePrism + guardRail (one side): overlap-free + "pass"; assert the rail sits ALONGSIDE the deck
  edge (does not intersect the deck) AND is oriented to the slope (its tiles are NOT vertical /
  perpendicular to the deck — verify the rail's plane follows the slope, not a 90-degree wall).
- wedgePrism + left + right guardRail (mirrored): overlap-free + "pass"; symmetric.

GUARDRAILS: main only; the rail MUST be slope-parallel (explicit failure to avoid); never weaken the
hairline or any check; commit discretely.

DONE: guardRail is a contract-tested macro that composes onto a wedgePrism as a slope-parallel side
rail (one side and mirrored pair), full suite green, no weakened assertions. Then STOP — the
medium-ramp builder loop uses it next.
```
