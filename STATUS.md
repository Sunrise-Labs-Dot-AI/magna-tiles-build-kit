# Current status

Updated 2026-09-26. Development has resumed from the archived exploration.

## Footage reconstruction workshop

`/references` now exposes source-informed 40-piece jet and 9/37/51-piece Henry ramp candidates, stable part/edge numbers, construction snapshots, five measured camera comparisons, and independent evidence for source shape, geometry, release, assembly and cars. Forty-five extracted frames are bound to two local source hashes. The original 3D snail source remains missing.

All four candidates preserve the inspected BOM and pass raw geometry checks. **None meets full replica acceptance.** The small ramp passes perturbed release and an inferred passive car route; its source-shape comparison fails, and held-module assembly remains unverified. Jet/medium source comparisons fail. The large ramp now passes all three release trials; the medium ramp still misses the sustained-rest window, and its turn does not pass. See [the reconstruction report](docs/footage-reconstruction.md) for precise boundaries and reproduction commands. Ten continuous insertion paths now cover the small ramp’s three construction stages, with an interactive part-by-part preview. Grip access and closure remain unverified. The historical jet now fails the corrected contact model; its geometry is preserved and its stale engine-valid status was removed. The same audit corrected the historical snail’s stale label and the legacy large ramp’s stale failed label; all nine cards now have live-gate consistency coverage.

## Intent-driven structural harness

The new structural path handles parameterized towers, open containers, through tunnels, and staircases. It parses a reviewable contract, constructs catalog geometry, measures requirements independently, runs three release perturbations, checks settled shape and completed assembly prefixes, and repairs failed candidates without changing the contract. The Design Lab exposes unlimited pieces, the contract, and repair evidence. Agent tools can solve a contract or evaluate an externally authored tile graph.

The reproducible acceptance corpus passed **20/20 constructive briefs and 5/5 required rejections**; recorded outcomes are in `verification/harness-benchmark-summary.json`. The recovered full per-tile report, including models, instructions, and measurements, is checked in at `verification/harness-benchmark.json`. Run `npm run benchmark:harness` to reproduce rather than trusting stored success labels. See [docs/intent-harness.md](docs/intent-harness.md) for precise scope, passage assumptions, and limitations.

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
- **Physical assembly.** Each completed instruction group is simulated; hand access and the transient process of holding and joining its individual pieces are not.

## Next engineering milestones

1. Replace the broken switchback macro with a road generator that solves tile surfaces, shared edges, elevation, supports, and guard walls together. Establish a continuous two-turn single lane before doubling it.
2. Test passive car turns with actual wall contact and banked surfaces. No hidden steering forces or waypoint attraction.
3. Compare a small physical fixture set against simulation: cantilever collapse, hinge sag, ramp friction, and loaded turns. Fit a compliant magnetic connection model to those measurements.
4. Test several release offsets, car sizes, masses, and friction values. Report the tested envelope instead of a single nominal pass.
5. For video reconstruction, fit catalog tiles jointly to multiple calibrated views, show confidence and occlusion, and require review of uncertain placements before assembly validation.

See [docs/design-lab.md](docs/design-lab.md) for implementation details and acceptance gates.
