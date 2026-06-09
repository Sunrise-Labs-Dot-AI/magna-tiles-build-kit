# Magnatiles Physics Engine — Design & Plan

## The bet
Stop certifying builds with stacked proxies (no-overlap, topology, a vision score) — every proxy is
necessary-not-sufficient and the stack keeps green-lighting garbage (the iteration-13 "floating
arms" build passed validation, no-overlap, the switchback assertions, AND the vision reviewer at
88). Replace proxy verification with **simulated reality**: model the tiles as real physical objects
and let physics decide. A build that can't support itself falls; a ramp a car can't roll fails.
Those signals can't be gamed because they ARE the requirement, not a stand-in for it.

## Architecture: one engine, two surfaces
A single physics core; the sandbox is the core with a UI, verification is the core run headless.

### Core (headless-capable)
- **Tiles = rigid bodies** with the corrected real dimensions (catalog), thickness, mass.
- **Connections = magnetic-edge joints**: a tile attaches ONLY along a valid shared edge, hinges
  over the real angle range, and holds with a **finite force** (joint breaks/pops if exceeded). A
  tile attached to nothing is impossible by construction — that kills the "floating arm" failure.
- **Gravity + collision** (rapier): step the world; structures settle, stand, or collapse for real.
- **Construction API**: `addTileBySnap(parentTile, parentEdge, shape, childEdge, foldAngle)` — the
  same operation whether driven by UI clicks or a build script.
- **Simulation queries (the real gates)**:
  - `simulate(build)` → `{ stands, maxDisplacement, poppedJoints }` (drop under gravity, step, measure).
  - `rollTest(build)` → `{ reachedBottom, fellOff, path }` (spawn a ball/car at the top of a ramp).
- Tech note: the core uses rapier **directly** (`@dimforge/rapier3d-compat`) so it runs headless in
  Node/tests. The React wrapper (`@react-three/rapier`, already a dependency) is for the UI surface
  only — do not try to run it headless.

### Surface A — Sandbox UI ("Minecraft meets Magna-Tiles")
The core + Three.js renderer + interaction: click to snap tiles edge-to-edge, drag, watch unstable
builds fall in real time. The product build-mode.

### Surface B — Headless verification
The same core in tests/CI: load a build → run `simulate` + `rollTest` → pass/fail. This REPLACES the
proxy gates as the source of truth. (no-overlap / validateBuild stay only as cheap pre-filters.)

## Calibration discipline (or it becomes another lying gate)
The magnet hold force is unpublished (research §2), so it — plus friction and mass — are **assumed,
flagged constants tuned until the sim reproduces KNOWN real outcomes**. The calibration suite the
engine MUST reproduce:
- the approved small car ramp **stands** (settles, no popped joints) and a ball **rolls top→bottom**;
- a deliberately tall 1-tile-wide tower **tips over**;
- the iteration-13 "floating arms" medium ramp **FAILS** (can't assemble / collapses / ball falls off).
If the engine can't reproduce known reality, it is not trusted. Physics is far more calibratable than
a vision rubric — but the discipline is the same: match known outcomes before trusting new verdicts.

## What transfers (this is a new layer, not a rewrite)
Corrected catalog dimensions, magnet-edge matching geometry, macros/ports (construction helpers),
and the Three.js renderer all carry over. Physics bodies, magnet joints + force model, and the sim
queries are the new layer.

## Honest limits
- **Magnet force is the crux** — budget real time for physics tuning (force, friction, stiffness).
- **Physics validates stability and FUNCTION, not RECOGNITION.** It kills floating arms and gives a
  real gate for ramps/towers. "Looks like a jet" has no functional test and stays a human judgment —
  though the engine guarantees the jet is at least a real, connected, standing object.
- **Multi-week build.** Not a session.

## Phasing
- **E1 — Core engine + calibration (headless).** Tiles, magnet joints, gravity, `simulate` +
  `rollTest`, calibrated against the known-outcome suite (incl. must-REJECT the iteration-13 build).
  *This is the first handoff below.*
- **E2 — Swap verification to physics.** The harness/tests gate on `simulate`/`rollTest`; the proxy
  checks demote to pre-filters. The floating-arms build now fails; the small ramp passes.
- **E3 — Sandbox UI.** Live edge-snap construction + real-time physics in the browser.
- **E4 — Re-author the 3D builds in the engine** (medium/large/jet) — incoherence now impossible,
  stability/function gated; jet resemblance still human-reviewed.

## Phase E1 handoff (paste into a NEW session)

```text
Build the headless core of a physics engine for Magna-Tiles. Work on `main`; commit discretely;
never weaken a test or fake an outcome. Use rapier DIRECTLY (@dimforge/rapier3d-compat) so it runs
headless in Node/vitest — NOT the @react-three/rapier wrapper. Build on the existing tile geometry
and corrected catalog dimensions.

DELIVER lib/engine/ with:
- Tile rigid bodies: each tile a thin rigid body with its real catalog dimensions, thickness, and a
  mass constant. 
- Magnetic-edge joints: connect two tiles ONLY along a valid shared edge (reuse the existing
  edge-matching geometry); model the join as a hinge with the real angle range and a FINITE break
  force (a single named, flagged constant MAGNET_HOLD_FORCE = assumed, to be calibrated). A tile
  cannot be added except by snapping to an existing tile's edge.
- A rapier world with gravity + collision, and a step loop.
- simulate(build) -> { stands: boolean, maxDisplacement: number, poppedJoints: string[] } : drop the
  build under gravity, step until settled or collapsed, report whether it held together and stood.
- rollTest(build) -> { reachedBottom: boolean, fellOff: boolean } : spawn a ball at the top of a
  ramp's drive surface, simulate, report whether it rolls to the bottom along the surface.

CALIBRATION (this is the trust anchor — a strict test suite the engine MUST reproduce):
- the approved small car ramp (build-drafts/small-car-ramp.json): simulate().stands === true with no
  popped joints, AND rollTest().reachedBottom === true && fellOff === false.
- a deliberately tall, 1-tile-wide tower fixture: simulate().stands === false (it tips).
- the iteration-13 floating-arms medium ramp (recover it from git: build-drafts/medium-car-ramp.json
  at commit 7b18c1e): simulate()/rollTest() must FAIL it — it should not stand and/or the ball falls
  off. THE ENGINE MUST REJECT THE BUILD THAT EVERY PROXY AND THE VISION REVIEWER PASSED. This is the
  acceptance criterion that proves the engine is a real gate.
Tune MAGNET_HOLD_FORCE / friction / mass until ALL calibration cases reproduce. Document the
constants as assumed+calibrated (single source of truth). Do NOT tune them to make a desired build
pass — tune them to reproduce the KNOWN real outcomes above.

GUARDRAILS: headless only this phase (no UI); rapier direct, not the React wrapper; constants are
flagged assumed+calibrated; never fake a simulation outcome; the iteration-13 rejection is
non-negotiable. Commit discretely; report what the calibration suite shows.

DONE: lib/engine/ core with simulate() + rollTest(); calibration suite green — small ramp
stands+rolls, thin tower tips, iteration-13 build is REJECTED; constants documented as calibrated;
npm test / lint / build green.
```
