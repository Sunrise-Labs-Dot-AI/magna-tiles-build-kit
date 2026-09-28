# Component-local pickup in an occupied workspace

## Outcome and scope

Pickup and lowering now resolve only the gripped component's already-present parts. Other prepared components remain in the complete physical world as dynamic obstacles. Acquiring a grip on a fully released prefix first requires a checked one-hand support trial; its actual terminal state becomes the lift input. Motion reports separately identify the carried measurement group and the physically held panels.

An in-memory medium proposal assembles and releases the four-piece lower wedge, four-piece upper wedge and five-square support sequentially in one 13-panel world across seeds 0, 17 and 53 under clear-first. The support is prepared at its nominal footprint; no later support relocation is needed by this proposal. The original 37-piece geometry and source observations are unchanged. This is preparation evidence only: it does not certify the later upper-to-support transfer or add an unbound source stage to the published candidate.

## Regression evidence

Two tests failed against `9c49b1a` before the fix. The first captured all three unrelated obstacle panels in the pickup moving IDs. The second showed a released prefix entered motion without a preceding one-hand support trial. The original two-support diagnostic passed physically but attributed exactly 0.5 inches of pickup deformation and 0.32 inches of lowering deformation to the stationary obstacle, because its baseline incorrectly moved with the new module.

After the fix, the initial 23 motion/pickup tests and two component-resolution tests pass. The complete occupied-world tests assert exact input/terminal EngineState continuity, only one kinematic pickup panel, every non-hand body dynamic, complete obstacle coverage in every recorded frame, stationary obstacle corners within 0.03 inches, and carried deformation below 0.03 inches. Negative tests cover absent/duplicate component coverage, broken internal contact, wrong-component pickup, blocked acquisition, failed one-hand support and failed predecessor state.

The original zero-offset medium support experiment failed at the fifth support insertion under both policies and all three seeds. Subsequent inspection found that the rejecting legacy edge finder was returning a nearby proposal, not an exactly closed contact: the candidate's lower-to-support edge has a 0.415-inch gap and 2.672-inch overlap. The exact closure thresholds remain unchanged. The corrected independent endpoint check passes the complete two-stage zero-offset preparation across all three seeds; the full three-module zero-offset proposal also passes all three seeds under the same frozen runtime. Both retain compact motion evidence and complete diagnostic inputs. Relocations, if needed, must still be modeled explicitly; no source edge can be called earned merely because the broad matcher proposed it.

## Review and validation

The full engineering loop applies. Independent GPT-5.5 plan review raised three concrete findings: distinguish moving groups from body support, exclude future nominal tiles from component resolution, and test exact motion call boundaries. All were accepted; a fresh independent verifier marked each addressed. Claude's unavailable subscription reviewer remains documented in the preceding increments.

The expanded eight-test pickup/component suite passed before the shared contact correction. A later review found an omitted cross-group contact gap, then the generic gravity fixture exposed an overbroad intermediate fix. The final `closedMagneticConnection` helper uses the established exact closure check and is shared by components, independent insertion endpoints and arrival enumeration. It passes 18 focused tests; the final reviewer reports ADDRESSED with no required findings. Final regression coverage, regenerated source evidence and production/browser checks are complete. The full verified-build goal remains active.

A strict static audit of the unchanged source models finds 68/84 closed proposed jet connections, 15/15 small-ramp connections, 61/64 medium-ramp connections and 107/107 large-ramp connections. The existing geometry report explicitly describes nominal edges; that broad nominal check cannot substitute for this exact closure requirement. See `runs/diagnostics/2026-09-27-source-strict-contact-audit.json`. These are candidate hypotheses, not independently observed source joins. The next medium transfer plan is being revised around this evidence before implementation.

Artifacts: `runs/2026-09-27-component-pickup-plan.md` and its review sidecar; `runs/reviews/component-pickup-*`; diagnostics `component-pickup-before-held`, `component-pickup-before-released`, `component-pickup-red`, `medium-zero-offset`, and `medium-upper-preparation` under `runs/diagnostics/2026-09-27-*`.

Final-runtime preparation diagnostics: `runs/diagnostics/2026-09-27-medium-zero-offset-exact.json` and `runs/diagnostics/2026-09-27-medium-three-module-zero-offset.json`, both bound to `3f363eaec8a592f1957e384646dcb6c70dbc709556670eaa10acaa2d7213317a`. The earlier zero-offset failure is retained as diagnosis of the corrected near-match guard, not an enduring source-geometry conclusion.

## Final publication evidence

Regression coverage is 502 passing tests with one skipped across 48 files. The complete run passed 500 tests and isolated two failures in gravity-seating: an outdated two-hand expectation before the newly required one-hand acquisition trial, and a 30-second roof-fixture timeout during concurrent CPU-heavy runs. After correcting the expectation, all 17 tests in that file passed in a standalone rerun (417 seconds) with the original test limits. No physical or test threshold was relaxed.

Type checking passes. Full lint has zero errors and 38 existing warnings; the later UI-copy and assertion edits also pass focused lint. The final runtime regenerated all four source reports, 72 independent contact trials and 21 generic assembly operations. All source replica objects and independent gate statuses remain identical to the preceding commit; the additional grip-acquisition motion is present in refreshed evidence. Artifact integrity and production build pass. Browser verification passes all four downloads, selected/rejected assembly playback, small pickup/seating/complete transfer, medium retained pickup and nine-part support release, later-stage non-promotion and the 390-pixel mobile view without overflow or browser errors. Medium support release, small transfer release and mobile screenshots were visually inspected.

The UI raw-geometry label is now “Tile shapes & intersections”, matching its scope. The source strict-contact audit remains separately visible in this increment and the main reconstruction report. Creator media remains ignored; original checkout changes are preserved. No source model, measured observation, engine setting, physical threshold or construction contract changed.

The corrected next upper-transfer plan has a CLEAN independent review after adding one-neighbor enforcement and a full actual-arrival component audit. Its implementation is outstanding; keep the full goal active and PR #4 draft. Exact pushed-commit deployment status is checked after publication.
