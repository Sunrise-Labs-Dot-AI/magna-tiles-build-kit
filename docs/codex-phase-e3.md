# Codex Handoff — Phase E3: Interactive physics sandbox (the engine with a UI)

Run in a **NEW session**; main only. E1 built the headless physics engine (`lib/engine`:
rapier3d-compat, `simulate`/`rollTest`, calibrated constants). E2 made it the gate (`gateBuild`).
E3 is the **engine with a front-end** — built on the existing `/builder` workbench. It is both the
play surface and, more importantly right now, the **authoring surface** for re-building the 3D
models (E4) in live physics where floating/unstable construction is caught as you build.

**The one correctness trap:** the sandbox MUST run the *same physics as the gate*. If the UI uses a
different binding or a second set of constants, you get a new lie — "stands in the sandbox" while
`gateBuild` fails (or vice versa). Share the constants and the world/joint/break model with
`lib/engine`; do not fork a second physics.

```text
Build the interactive physics sandbox by upgrading the existing /builder workbench (app/builder) to
real physics. Work on `main`; commit discretely. Build on lib/engine (the headless engine + gateBuild)
and the existing builder construction tools (lib/builder, edge-snap, storage).

SHARED-PHYSICS REQUIREMENT (critical): the sandbox must use the SAME physics as the headless engine —
same constants (lib/engine/constants), same magnetic-edge joint + finite-break model, same
masses/frictions/thresholds. Use @react-three/rapier (already a dependency) for the live in-browser
binding, but factor the world/body/joint construction so the SAME logic + constants drive both the
headless engine and the UI. Do NOT create a second set of physics constants. If the sandbox and
gateBuild ever disagree on a build, that is a bug in the shared model to fix — never reconcile it by
forking constants or weakening the engine.

DELIVER (enhance app/builder):
- Live physics viewer: tiles render as the real bodies. An explicit "Test stability" / run control
  steps gravity with the magnetic-edge joints — unstable builds visibly tip/collapse; stable ones
  settle. Default to a paused EDIT mode (so you can place tiles), with run/reset to simulate.
- Construction by snapping (reuse the existing edge-snap tools): a tile is added ONLY by attaching it
  edge-to-edge to an existing tile — unattached/floating tiles are impossible to create. Confirm this
  is the construction model.
- Functional test in-UI: for ramps, a "Roll a ball" control runs rollTest live (spawn a ball at the
  top of the drive surface, watch it roll to the bottom or fall off).
- Readiness = gateBuild: replace the old proxy readiness ("draft needs repair / joins not on magnet
  edges", from evaluateReviewReadiness) with the engine gate verdict (pre-filters -> stands -> ramp
  rollTest). The UI's status must match the real gate. Recognizable-object resemblance stays a human
  note on top.
- Save -> engine-gated draft: saving writes build-drafts/<id>.json (already wired) and surfaces the
  gateBuild verdict so it's clear whether the saved build is engine-valid. The guided library already
  replays drafts.

GUARDRAILS: share physics constants/model with lib/engine (single source of truth); never weaken the
engine to make the sandbox agree; main only; commit discretely. The headless engine, the E1
calibration suite, the E2 gate, and the independent raw-overlap anchor must all stay green.

DONE: /builder is a real physics sandbox — snap tiles together, run gravity to see it stand or fall,
roll a ball down ramps, readiness driven by gateBuild; saving produces an engine-gated draft; the
sandbox shares the headless engine's constants/model (sandbox verdict agrees with gateBuild);
npm test / lint / build green; E1 calibration + E2 gate + raw-overlap anchor all still green.
```

After E3: this is the tool for E4 — author the medium/large/jet in the sandbox with live engine
feedback, save, and they pass `gateBuild` by construction rather than being authored blind and gated
after the fact.
