# Current status

Updated 2026-09-27. Development has resumed from the archived exploration.

## Footage reconstruction workshop

`/references` now exposes source-informed 40-piece jet and 9/37/51-piece Henry ramp candidates, stable part/edge numbers, construction snapshots, five measured camera comparisons, and independent evidence for source shape, geometry, release, assembly and cars. Fifty-four extracted frames are bound to two local source hashes. The original 3D snail source remains missing.

All four candidates preserve the inspected BOM and pass raw geometry checks. **None meets full replica acceptance.** The 9-piece small ramp now passes complete construction through all three source stages and all three perturbation seeds, including the launch-module rotation, docking and unsupported release. Its proposed straight car route also passes. The source-shape comparison still fails (23.3 px RMS), and real grips, magnets and vehicles remain uncalibrated. The workshop exposes both the selected complete sequence and rejected attempts with their recorded motion.

The 37-piece medium and 51-piece large ramps pass all three release trials. The medium ramp now passes lower-wedge preparation, upper-wedge preparation, five-square support construction, upper transfer, lower-wedge table relocation and blue-turn insertion across all three seeds, ending with 14 released parts in one workspace. Five later stages remain unverified, beginning with the lower canopy walls; its passive turn still fails. The large ramp's assembly and route remain unverified. The 40-piece jet still fails release and source-shape checks. See [the reconstruction report](docs/footage-reconstruction.md) for source and measurement boundaries.

Pickup and lowering now measure only the gripped component, retaining unrelated released modules as dynamic obstacles. A released prefix must first pass an actual one-hand acquisition trial. The medium workshop now exposes the six passing stages with source-frame bindings and actual recorded motion. The wedge preparation method is explicitly proposed: the footage already shows the wedges assembled. Upper transfer adds only its two earned support joins. Lower relocation moves the four-panel wedge about six inches, proves table bearing and free rest, and retains both independent components without adding joins. The bridge adds exactly one blue panel to the actual 13-panel state, earns two measured contacts, merges the two components and passes hand withdrawal and free rest. Numbered instructions for passing stages use actual terminal joint records from all three seeds; later-stage joins remain labeled as unverified proposals. Exact contact checks distinguish closed edges from broader legacy nearby-edge proposals. The unchanged source models contain 16 proposed jet joins and three proposed medium joins that fail exact closure, so the green raw-geometry result is not an exact-join certificate.

Ordinary continuation now preserves the actual predecessor's old joints after components have connected. Unearned nominal old joins stay absent. Unplaced future panels cannot change the next insertion's path span or the continued workspace's floor. A new eight-panel physical fixture passes all three seeds, preserving six old joints and earning two incoming-panel joins; detailed comparisons remain identical when future wall/roof proposals are placed far away and below the table. A separate proposed two-panel canopy diagnostic reaches 16 released panels and 21 joints on all three seeds, without source-motion or complete-canopy credit. The footage inspection shows interleaved walls and roofs, an upright blue panel, and a compact green support footprint that the elongated-support candidate does not establish. Exact hidden counts and the full source-to-part mapping remain unresolved; the old all-walls-first canopy stages have not been promoted.

The headless runtime retains Rapier.js 0.19.2, f32 precision, catalog solids, materials and original solver settings, with a reviewed Parry finite-polyhedron contact correction. A separate continuous solid-sweep guard rejects intersections or uncertifiable intervals. The [vendored package](vendor/rapier-contact/README.md) includes pinned sources, patch, licenses, reproducible builds and an identity that invalidates old physical states. Independent contact matrices and 72 convergence trials pass. Regression coverage is 620 passing tests with one skipped across all 54 files on the continued-prefix runtime; lint has zero errors and 38 existing warnings. The structural benchmark passes all 25 outcomes: 20 constructive cases and all five required rejections. The earlier collision-only optimization lets the five-step staircase finish in 154 seconds under the unchanged four-minute budget and preserved all four source reports' physical results. Subsequent assembly changes require continuous grips, accessible hand transitions and insertion paths that clear both tiles and fingertips.

The historical library remains separate from source reconstruction. The current nominal gate passes house, castle, dog, historical snail, medium ramp and rocket. Historical jet, small ramp and large ramp fail; the large ramp's platform release cannot be certified. Their geometry is retained and labels follow live gates. The generated sprint seats its platform and rear walls on finite support faces as a separate variant. The historical snail's nominal pass does not identify or reproduce the missing 3D source.

## Intent-driven structural harness

The new structural path handles parameterized towers, open containers, through tunnels, and staircases. It parses a reviewable contract, constructs catalog geometry, measures requirements independently, runs three release perturbations, checks settled shape and completed assembly prefixes, and repairs failed candidates without changing the contract. The Design Lab exposes unlimited pieces, the contract, and repair evidence. Agent tools can solve a contract or evaluate an externally authored tile graph.

The current reproducible acceptance corpus passes **20/20 constructive briefs and 5/5 required rejections**; recorded outcomes are in `verification/harness-benchmark-summary.json`. The recovered full per-tile report, including models, instructions, and measurements, is checked in at `verification/harness-benchmark.json`. Run `npm run benchmark:harness` to reproduce rather than trusting stored success labels. See [docs/intent-harness.md](docs/intent-harness.md) for precise scope, passage assumptions, and limitations.

## Demonstrated in simulation

The Design Lab at `/design` produces an authored ten-piece downhill sprint from a supported prompt, runs two unpowered car proxies together, and returns a 3D model, a piece list, numbered joins, three assembly steps, recorded car traces, and individual check results. Each completed step passes the structure simulation.

This is a bounded candidate planner, not unrestricted text-to-3D. It searches six existing switchback variations for turning courses. None currently passes the zigzag request. Their failures include intersecting supports, discontinuous road geometry, and too few turns. The app exposes those failures and labels the result “Needs repair.”

The existing manual editor, authored library, recognition scorer, and reference encoder remain available. Selected library builds and legacy prompt responses now include live physics verdicts.

## Corrections to the original implementation

- The catalog is in inches; gravity previously treated a meter as ten catalog units. The conversion is now 39.37 inches per meter.
- Artificial collision skin was removed from finite-thickness tile hulls in both browser and headless physics. Closed supports now settle without opposing contact/hinge constraints. Generated stepped risers have explicit rear bracing.
- Linked tiles now collide. Disabling contact between every connected pair allowed invalid folding behavior.
- Structure displacement includes tile corners, so a rotating tile cannot pass solely because its center stays put.
- Headless simulation worlds are released after use.
- Snapping has a smaller capture distance, orientation-aware ranking, a check against the intended edge, collision rejection, and protection for locked tiles or tiles with attached children.
- Invalid geometry and inventory overruns are rejected before expensive physics work.
- A test that referenced a missing historical git commit has a self-contained replacement fixture. The parametric jet seed now correctly fails its structure test under the corrected model. Existing authored library fixtures are separate from that generated seed.

## Still unproven or unsupported

- **Real magnet behavior.** Ideal hinges and a separation-based break heuristic are not measured magnetic force, torque, or magnet polarity.
- **Vehicle realism.** Cars are rigid chassis with four axle-constrained spherical wheels. They have no suspension, steering, axle friction calibration, or measured tire properties. Their nominal dimensions are explicit assumptions.
- **Reliable zigzags.** The current switchback macro has geometry and support problems. It does not yet provide a valid two-turn course or guide cars through turns.
- **Unrestricted prompt fidelity.** Four structural families now have explicit measurable contracts and constructive repair search. This is not arbitrary structure synthesis; unresolved clauses fail closed. Course requests use the earlier experimental planner, and other object families still use unverified legacy templates.
- **Video reconstruction.** The existing target was estimated from frames, not recovered through measured multiview geometry. The earlier [diagnosis](research/diagnosis.md) still applies.
- **Physical assembly.** The small source candidate has continuous individual-panel grip, placement, transfer and free-release checks. Other source contracts remain incomplete or fail. Grips are explicit fingertip proxies, not measured human handling.

## Next engineering milestones

1. Replace the broken switchback macro with a road generator that solves tile surfaces, shared edges, elevation, supports, and guard walls together. Establish a continuous two-turn single lane before doubling it.
2. Test passive car turns with actual wall contact and banked surfaces. No hidden steering forces or waypoint attraction.
3. Compare a small physical fixture set against simulation: cantilever collapse, hinge sag, ramp friction, and loaded turns. Fit a compliant magnetic connection model to those measurements.
4. Test several release offsets, car sizes, masses, and friction values. Report the tested envelope instead of a single nominal pass.
5. For video reconstruction, fit catalog tiles jointly to multiple calibrated views, show confidence and occlusion, and require review of uncertain placements before assembly validation.

See [docs/design-lab.md](docs/design-lab.md) for implementation details and acceptance gates.
