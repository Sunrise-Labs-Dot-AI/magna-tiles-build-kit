# Footage reconstruction workshop

Updated 2026-09-27. `/references` contains four inspectable reconstruction candidates and their separate evidence. **No complete source replica is verified.** The new models are independent of the old AI-authored jet reference model and the 23/8/11/10-piece draft approximations.

## What is implemented

- Rigid, finite-thickness catalog geometry for the jet and three Henry ramps: **40 / 9 / 37 / 51 pieces**, matching the inspected BOM cards. No stretched tiles or extra support pieces are used. Raw overlap tolerance remains unchanged.
- A reusable five-piece isosceles ramp prism; the medium flight uses its four-piece open-back form. Explicit stage snapshots support separate modules and rigid pose changes, including the jet body being assembled upright and then placed horizontally.
- A source evaluation lane, `evaluateReferenceCandidate(build, referenceContract, observations, options)`, in `lib/harness/reference.ts`. It accepts an external candidate with stable part IDs; structural grammar success and candidate signoff fields cannot establish source fidelity. The structural prompt grammar is unchanged.
- Numbered parts and edges that persist across stage changes, candidate join lists, source video links, downloadable geometry/evidence, and a responsive 3D workshop.
- Measured perspective comparisons with separate camera anchors and scored corners; immutable camera alignment after release. Fitting cannot move or stretch individual parts. Both fitting views and withheld views are visible, including failures.
- Passive four-wheel car trials require contact with the named driving tiles. Routes and cars share grounded coordinates. The car has no motor, steering controller or waypoint attraction. Post-run structural checks observe a further second of free motion.
- Source/video/frame hashes, a reviewed observation lock, and generated-artifact checksums. The production build rejects stale models, validator changes, altered verdicts, altered SVGs and incomplete evidence bundles. These are integrity checks, not physical signoff or cryptographic authentication of repository authors.

## Current acceptance boundary

| Target | Source and inventory | Source shape | Release simulation | Assembly | Car function |
|---|---|---|---|---|---|
| Jet, 40 | Verified local hashes and BOM | Fails withheld view; historical views need independent camera-region constraints | Fails three perturbations | Released checkpoints fail; upright rings and separate pods are explicitly held | No flight test or claim |
| Small ramp, 9 | Verified local hashes and BOM | Fails withheld view | Passes all three perturbations | All three stages, including actual transfer and final free release, pass all three seeds | One assumed car completes the inferred deck route with wheel contact |
| Medium ramp, 37 | Verified local hashes and BOM | Fitting and withheld views fail | Passes all three perturbations | Lower wedge and five-square support pass every operation and free checkpoint on all three seeds; six later construction stages remain unverified | Fails; no successful passive turn demonstrated |
| Large ramp, 51 | Verified local hashes and BOM | No scored camera fit yet | Passes all three perturbations | Released checkpoints pass; insertion and grip checks remain unverified | Not reconstructed/tested |
| 3D snail | Exact source absent | Not assessed | Not assessed | Not assessed | Not assessed |

All real-world material behavior remains **uncalibrated**. Passing a simulator check is not a claim of physical validation. Detailed numbers and failures live in `verification/replication/results.json` and the workshop downloads.

## Continued harness development

The goal is reliable generation of verified builds. The earlier candidate PR is a checkpoint, not the acceptance event. The implementation plan and independent review are in `runs/2026-09-26-reliable-verification-plan.md` and its sidecar. No source verification is promoted by the current increment.

`lib/replication/insertion.ts` checks the complete swept path of fixed-orientation translating catalog prisms against every installed part and the table. It intersects analytic time intervals on the full prism separating-axis set, including thickness edges; collisions between distant endpoints cannot evade the check. The unchanged 0.03-inch contact tolerance applies. Rotating insertions are outside this solver.

`planConstructionPaths` performs bounded direction search in a supplied per-part order, validates each path independently, and retains all installed parts as obstacles. Multi-part moves require a previously planned matching module. Missing parts, duplicate insertions, future module references, and a single arbitrary whole-model insertion fail. These are clearance checks, not hand or stability checks.

The small ramp has five wedge insertions, four separately held launch-module insertions, and one module-joining path. The per-part order is a candidate sequence within the source stages; the generated paths are not measurements of Henry’s hand motions. Select a construction checkpoint and an insertion in the workshop, then move the slider to inspect it. Downloads contain the same coordinates used by the validator.

The medium ramp now adds a four-piece lower-wedge sequence and five individual support-square placements. A retained roof grip lifts the lower prefix, lets the opposite side enter laterally, receives the lower deck and lowers the wedge before free release. Grip-aware search requires both finite tiles and fingertips to clear along the exact carried path. The independent support is assembled beside the released wedge in the same world, retaining its actual poses and dynamic bodies. The closure checker distinguishes a first independent part from a later joined insertion and rejects undeclared magnetic contact across modules. All nine placed parts pass the final free checkpoint on three seeds. These hand sequences and relative workspace positions are proposed procedures, not measured source motions; they do not establish the later assembly, fidelity or car result.

### Supported assembly and independent source evidence

`evaluateAssembly` now simulates every operation across seeds 0, 17 and 53. A maximum of two hand contacts each controls exactly one panel. A hand cannot fix an entire multi-part module. When one or two panels are each directly grasped, their zero-dynamic-body record explicitly makes no free-stability claim. Ordinary support transitions retain the previous grips, reject implicit regrasping or acquisition requiring a third hand, and check finger access and withdrawal before changing support. Explicit release steps make the medium support's successive grip changes possible. Carried modules have one held panel, with the remaining parts dynamic. Lowering starts from the actual checked one-hand support state. Every released stage runs a mandatory free checkpoint and checks the remaining hand's withdrawal, including stages that add no parts. The small candidate keeps the same rear and launch-roof grips across placements and passes all three stages under these stricter checks.

The fingertip proxy pinches an actual catalog edge with two 0.22-inch-radius spheres, checked along a 1.5-inch approach and the full translation. It checks table clearance, present panels, support-hand clearance and withdrawal. This is a stated proxy, not a measurement of human dexterity, palm clearance or grip force. The small launch transfer has a checked continuous rotation and now passes final free release across all three seeds. The table stays at the complete stage's height; a floating prefix cannot invent support by regrounding itself. Settled geometry is carried into the next insertion and closure rather than restored to the authored pose.

Closure adds stricter contact requirements than the legacy broad magnetic search: transverse edge gap at most tile thickness plus 0.03 inches, alignment within 5 degrees, and longitudinal overlap within 0.21 inches of the shorter edge. A disconnected or merely nearby module cannot pass. All original raw-overlap, peak-motion and rest limits remain unchanged.

A source-independent three-wall U passes its complete assembly in all three seeds, including final free releases. Reproducible evidence is `verification/replication/assembly-fixture.json`; the build also rejects a stale or edited fixture artifact. Negative tests cover missing/excess grips, blocked approach, unsupported hanging modules, absent joins, premature floating-panel release and omitted operations. The small candidate now completes its five-piece wedge assembly with actual state carried through pickup, docking, support handoff, lowering and free release. Its four-piece launch also passes assembly in the observed sideways construction pose across all three seeds; its continuous rotation, actual named contact arrival, connected support and final free release all pass. The detailed checks are visible in the workshop and downloads.

The fitting footage at 24.5 seconds shows the small ramp's rear square and two isosceles sides standing before either deck panel is installed. Its instructions now follow that observed sequence. The 34-second historical annotation had lateral corner IDs mirrored; only those IDs were corrected, preserving all pixels and roles. Prior observations and locks remain in `verification/replication/observation-history/`. Correcting this transcription makes the camera physically plausible, but scored RMS remains about 23.3 pixels, above the unchanged threshold. The candidate geometry has not changed.

Camera acceptance now separately requires an observed hemisphere, position above the table, finite positive focal length, nondegenerate axes and positive depth. A perfect pixel residual cannot override an impossible camera. Historical views with no recorded region cannot pass this gate.

The locked evidence-use ledger and candidate-freeze record track source/frame hashes, reservation and inspection order, prior inspection, baseline/current candidate digests and reviewed view families. The actual evaluator uses those records; changing a candidate after freeze fails, and reservation hashes must match verified local extraction records. The newly reserved 36.25- and 40.2-second frames were inspected only after candidate freeze. They match already inspected fitting view families, so neither supplies new independent coverage. The first shows the yellow car descending the orange deck, but does not by itself measure a complete trajectory. The second is a wide shot with the completed small ramp on the left. Source insufficiency is recorded explicitly; no favorable frame replaces a failed heldout measurement.

### Gravity placement and observed launch pose

`gravitySeat` adds a bounded release above the target with no new magnetic joints during the fall. Existing installed/internal joints remain active. Table placements require actual ground contact; magnetic placements must earn every named cross-module edge from the actual rested geometry before the normal connected support/release trial. Eight CCD-enabled substeps resolve each 120 Hz interval, with the original physical duration, rest time, forces and tolerances. Per-substep checks cover solid/table penetration, displacement, existing-joint failure and conservatively swept fingertip clearance. Joint-break damping uses the actual integration timestep.

The generic roof fixture has real bearing area on narrower supports and passes all three seeds. A roof with only edge contact fails this rest-before-attachment operation: magnetic capture while falling is a separate model requirement. Unsupported, obstructed, missed-contact, invalid-grip and fingertip-crossing cases fail. Recorded motion retains actual terminal poses on failure.

Fitting frames at 28.75/30.25 seconds show the launch's final back panel flat and final roof upright before both green ends are closed. Frames at 32.5/33 seconds show its subsequent rotation. The verified proposed joining sequence uses that observed pose, with an initial table placement and three supported joins, across seeds 0/17/53. Exact human hand trajectories are not claimed. Transformed initial assembly poses remain distinct from transferring completed modules; the small launch now has a continuous orientation/translation check in a shared workspace. The workshop replays actual settled predecessor/carry positions and saved gravity frames, with future parts absent.

These four construction claims are bound to the replica, stage and canonical extraction manifest. Re-extraction reproduced the earlier fitting PNG hashes. The source evaluator rejects a changed construction frame just as it rejects a changed reserved frame. Reviewed original-photo measurements and their limits are in `docs/research/contact-measurements/`; no tile dimensions or heldout pixels were changed.

The earlier gravity-placement increment and its verification are recorded in `runs/2026-09-26-gravity-seating-increment.md`. Current contact-model results and validation are recorded in `runs/2026-09-26-rigid-contact-increment.md`.

### Rigid table contact and exact rectangular colliders

Independent flat and loaded-base fixtures exposed excessive softness in the previous table contact. The checked 72-trial sweep covers three frequencies, two collision rates, two solver settings and three release seeds. The selected 120 Hz contact frequency must pass the unchanged **0.03-inch peak** penetration limit and a stricter **0.01-inch late** numerical target, plus sustained rest and unchanged break/displacement limits. The higher contact frequency is a numerical rigid-contact setting, not a measured material property. Evidence is in `verification/replication/rigid-contact-fixture.json`; report generation reruns it and the production build rejects stale or edited results. The installed JS 0.19.2 bindings pin Rust Rapier 0.30.1, whose documented default contact frequency is 30 Hz ([versioned source](https://raw.githubusercontent.com/dimforge/rapier/v0.30.1/src/dynamics/integration_parameters.rs)). Length unit, allowed linear error and damping remain unchanged.

A separate rotated-reference hinge fixture exposed a false three-inch penetration reported by the generic convex-hull narrow phase. Square catalog tiles now use exact cuboids with their original reference basis. Triangle prisms are unchanged. Tests verify all square sizes under noncommuting body/reference rotations, Euler fallback, transformed-corner equality, analytic and prior-shape mass/inertia, and actual contact manifolds during free folding. Contacts remain enabled. Saved engine states carry the physics-model version and cannot continue evidence from the superseded collision model.

All acceptance physics now uses collision steps of at most 1/960 second. A separate inclined-panel fixture exceeded the peak floor limit at 480 Hz and passes at 960/1920 Hz across three seeds. Subdivision preserves elapsed time, interpolates kinematic targets and evaluates joint breaks using the actual substep duration. Maximum corner motion and floor penetration are retained from every collision step, including transient failures. Nominal and structural releases now require the same separate linear/angular rest limits as source releases; rolls and cars reject structural floor penetration too. Source geometry, BOM, observations, force thresholds and overlap tolerance are unchanged.

The actual small-wedge free checkpoints remain below 0.005 inches of table penetration in all three seeds. Nominal small/medium/large source releases pass sustained rest; source shape and assembly/function gates remain separate. The historical eight-piece small-ramp draft still moves and the historical rocket exceeds floor penetration, so their stored engine-valid labels have been removed. Neither is the corresponding source reconstruction.

### Earlier contact-skin correction

The old engine inflated each already finite-thickness tile collider by a 0.006-inch contact skin. At flush, hinge-constrained seams that added competing separation and attachment constraints. Rapier documents that contact skin creates a gap between touching objects ([official documentation](https://rapier.rs/docs/user_guides/javascript/collider_contact_skin/)). Removing this extra margin retains full tile hulls, contact between connected tiles, and all physical constants. It changes neither magnetic torque nor raw intersection tolerances.

A source-independent nine-piece closed support failed to settle with the old margin and reached sustained rest without it. A thirteen-piece support drifted 2.60 inches in the old 7.5-second diagnostic and only 0.266 inches without the margin, including the deliberate 0.28-inch drop. The 9/13-piece fixtures pass all three release seeds after the correction. Full differential results are in `verification/replication/contact-diagnostics.json`; reproduce with `node --import tsx scripts/reference/contact-diagnostics.ts`.

At that earlier checkpoint, the 51-piece candidate passed three releases and the medium candidate missed sustained rest. The latest results in the table above supersede those release outcomes. The contact-skin correction also made the historical 23-piece jet fail its nominal gate; its former stored engine-valid status was stale. A generated two-step riser uses three explicit rear-bracing squares (13 pieces total) because the old open-ended linkage collapses without the artificial contact margin. No supports were added to source candidates.

## Source record and observations

The original local jet cache was recovered. After searching the project, Documents, Downloads, Movies, Desktop and local media indexes, Henry's exact supplied YouTube video was retrieved in format 399. The exact 3D snail was not found; the separate flat snail was excluded.

| Source | Local path | SHA-256 |
|---|---|---|
| [Jet](https://www.youtube.com/watch?v=WDtC_9se3ds), 1280×720 | `.video-cache/WDtC_9se3ds/source.mp4` | `7df676be56d549cf9b2bd5d4702bf4e92b5508a04db2bd75733b490405e193f7` |
| [Henry's ramps](https://www.youtube.com/watch?v=vxwBYubszZ8), 1920×1080 | `.video-cache/vxwBYubszZ8/source.mp4` | `2d2aca38030161b613d445154154e59a040514543079de9936869ba25d85bfe0` |

`sources.json` records 51 BOM, construction, comparison and functional-inspection timestamps. `frame-manifest.json` binds each PNG to its source hash, timestamp, construction stage and partition. Videos and extracted creator frames stay ignored locally. The PR contains our geometry renders and numeric annotations only. Restoring media on another machine requires the same bytes; a changed download fails the hash check.

Five sparse camera observations contain six camera anchors and at least four scored corners each. RMS tolerance is **2%** and maximum corner error **4%** of the source annotation bounding-box diagonal. Camera fitting has seven parameters and rejects insufficient or degenerate depth anchors. Its optimization and initialization use only camera anchors. Changing check pixels cannot change the fitted camera. Runtime labels, stage membership and exact locked observation content are validated.

The initial topology hypotheses predate the annotations, so this is not a blind reconstruction study. The 388-second fitting view had a mirrored face-index transcription corrected without changing its pixel measurements. Cockpit pitch was fitted from construction geometry before inspecting the 397/416-second withheld views. Geometry was not tuned to their errors. The 416-second frame was rejected because it is dark, cropped and hand-supported, so that frame supplies no independent acceptance evidence. That exclusion remains recorded, not silently replaced by a favorable frame. Medium has one measured fitting stage and one measured withheld view. Small has one measured withheld view. The large ramp has no scored observation yet.

The evaluator deliberately cannot award full fidelity from these sparse points. It lacks complete silhouette/visible-edge coverage, constraints on every occluded part, and a fully justified useful final view reserved from fitting for each target. The earlier additional requirement for two views was removed to match the user’s definition; historical and fresh evidence remain distinct. A passing point comparison never promotes `replication` beyond `not-verified`.

Construction links identify an assembly operation or prepared subassembly; other pieces can appear around it. Only fit/holdout observations claim a specific projected stage snapshot. Source transitions are not treated as views of one static object.

## Findings from the footage

- The jet body is four triangular prism bays of three squares each. Four further squares belong to the two wing pods. The final six-piece cockpit retains two long purple triangles, two green right triangles, a yellow divider and a red floor. A rigid tilt seats its longitudinal tips; hidden joins and pod incidence remain hypotheses.
- The medium candidate allocates eight squares/isosceles pieces to two open-back wedges, five green squares to the elongated U support, sixteen equilateral triangles to four canopy walls, two blue equilateral turn pieces, four yellow cover squares and two red launch squares. The exact canopy/support arrangement is still contradicted by image measurements; matching the BOM is insufficient.
- At 1:46, Henry points along the medium ramp. The inspected close-up does not establish a complete car trajectory. Its roof route is an **inferred functional target**. A successful real passive turn is not asserted.
- The large blue XL edge spans two classic-square widths in the 2:50 construction view, supporting a 2:1 side ratio and the catalog's six-inch interpretation. This relative observation does not calibrate dimensions, magnet spacing or force.
- The catalog's existing 143 mm isosceles equal side is shorter than two three-inch squares. The model retains a 0.37-inch total deck overhang. Actual source-piece measurement is needed; triangle geometry was not enlarged to make the model fit.

## Physics diagnosis

`reference:fixtures` isolates body rings, body-plus-nose, the small wedge and the separate launch. Held stages can also be deliberately simulated without hands as diagnostics, explicitly labeled as such. A separate two-piece fixture clamps one panel and releases the adjoining horizontal panel. It sags to near vertical without breaking the hinge, exposing the current joint's lack of restoring torque. The clamp is never added to a source model.

The source release check samples maximum corner displacement and table penetration at every collision step for 900 reporting intervals at 120 Hz. It requires no broken/rejected joints, peak displacement ≤0.95 inches, table penetration ≤0.03 inches, and at least 90 consecutive rest intervals below 0.035 inches/second linear speed and 0.08 radians/second angular speed. Nominal and structural releases use these same limits. The historical nominal gate could report a low final displacement while the assembly was still moving; that loophole is closed.

`physics-fixtures.json` records the tests. The subsequent contact-skin experiment above resolves one numerical cause for the support-shell jitter. These results separate fixture behavior from source claims; they do not prove that magnet torque alone causes every candidate failure. Candidate topology, broad nominal edge matching, finite-thickness seating and contact/constraint jitter can also contribute. A measured hinge/cantilever fixture and tile dimensions are needed before changing the material model. No force threshold or overlap tolerance was weakened to pass these models.

The car's dimensions, mass, tire friction and spherical wheel approximation are assumptions. Continuous contact permits a maximum 0.15-second interruption for seams and requires contact at each ordered checkpoint. Turning and off-road failures stay visible.

## Reproduce

```sh
npm ci
npm run reference:check-artifacts  # Works without the locally ignored videos
npm test
npm run lint
npm run build
npm run benchmark:harness
```

With the exact local media restored and `ffmpeg` available:

```sh
npm run reference:extract
npm run reference:report          # Produces failures as inspectable artifacts; exit 0 means report generation only
npm run reference:fixtures
npm run reference:verify          # Intentionally exits 1: no complete replica passes
```

The strict command remains closed until full replica acceptance is implemented and supported. Updating source observations requires reviewing the measurement change and explicitly replacing `observation-lock.json`; `initial-observation-lock.sha256` preserves the first sparse transcription record. Do not tune to withheld measurements or relax tolerances when updating candidates.

Run the built app on port 3008, then `npx tsx scripts/reference/verify-ui.ts`. The browser check uses installed Chrome by default; `PLAYWRIGHT_CHANNEL` and `REFERENCE_PREVIEW_URL` override those choices. It exercises all models, a separately held stage, stable labels, the snail state and a 390-pixel viewport. Screenshots contain no creator footage. Local source overlays are available at `/reference-frames/replication/comparison.html` after report generation; they are not included in Git.

The old audit command still reports the old 23/8/11/10/42-piece drafts. Its rerun is saved separately as `verification/replication/legacy-audit-rerun.json`; the inherited baseline is preserved. It is a diagnostic of historical models, never an acceptance result for these candidates.

## Remaining work

1. Refine the jet pod orientation and medium canopy/turn arrangement against fitting frames, with additional edge and occlusion measurements. Keep the already inspected withheld errors out of that optimization; reserve new independent views before further tuning.
2. Obtain exact source tile/vehicle dimensions and physical hinge/friction fixtures. Diagnose contact jitter separately from missing magnetic torque, and fit any replacement model to measurements.
3. Resolve medium support/deck continuity and then test the inferred passive turn under car-size and friction variations. Do not substitute the passing straight sprint.
4. Add measured large-ramp camera views, per-ring construction checkpoints, and its car route.
5. Locate the exact 3D snail source before reconstruction.

See `runs/reviews/footage-code-review.txt` and its verification/disposition artifacts for the independent review. This PR is a reconstruction implementation with unresolved acceptance gates, not a completed replication milestone.

### Prepared modules in one physical workspace

The five-piece wedge stays present and dynamic while the launch is built six inches beside it. Construction placement is separate from source-stage geometry. A prepared workspace carries the complete body/joint state, floor frame, stage/seed lineage, held hands and explicit independent component groups. Stale histories, omitted obstacles, undeclared disconnection and extra independent components at the final transfer fail closed. Explicit table placement must prove bearing on the incoming part.

The launch retains its last green-side edge grip while the roof hand withdraws. A checked sideways finger path clears the installed wedge. The held trajectory lifts, rotates and translates the module, then pauses at a physically separated approach. Every other body remains dynamic. Actual sampled poses and positive separations certify that checkpoint; a nominal docking proposal cannot supply it. The right-triangle fingertip checker now uses an interior polygon centroid, preventing rounding from flipping a half-space at the triangle's edge-centered catalog origin.

Contact arrival independently enumerates the exact physical edge pairs and retains their directed source/engine identities. This completion kind makes no rest claim. New joins stay absent in the immediate returned body state, then only the earned source definitions enter connected stabilization. Free release is mandatory. The standalone unsupported-hinge regression can reach contact but fails connected/free support, so arrival cannot certify a build.

The September 26 increment established workspace construction, hand withdrawal, continuous transfer, exact contact arrival and connected support. Its final released nine-piece state failed sustained rest; that historical result and review remain in `runs/2026-09-26-prepared-transfer-increment.md`. The September 27 contact correction and bounded docking search now pass the entire inherited-state construction, including final free release, across all three seeds. Playback includes existing workspace parts, active joins and the actual selected or rejected motion. A nominal release is never substituted for the constructed state.

### Finite contact correction and bounded docking search

The headless simulator uses a pinned Rapier.js 0.19.2 package with a narrow Parry finite-polyhedron contact correction. Its separating-axis check retains valid contact normals, replaces provably invalid normals before the original clipping, invalidates stale manifolds and rejects an invalid optional GJK witness. Catalog solids, precision, materials and solver settings are unchanged. Two clean builds produce the same CJS/WASM artifacts; pinned sources, patch, build recipe, licenses and hashes live in `vendor/rapier-contact/`. Engine continuation and workspace histories include the backend identity and cannot reuse an older runtime's state.

A separate continuous solid check covers every moving tile pair and the table at each collision substep. It certifies linear/slerped intervals conservatively and fails closed when an interval cannot be certified. Failure history persists into release, assembly and car reports. This guard concerns tiles and the floor; car and ball collision models retain their separate checks.

Assembly searches at most two whole-stage docking policies: clear-first and support-aligned. Each policy starts with the same selected predecessor state and must pass every seed. A failed attempt contributes no prepared state, and seeds cannot be combined from different attempts. The small wedge selects support-aligned docking; launch construction and final transfer select clear-first. Both rejected and selected attempts remain inspectable in the workshop.

The complete test suite passes 491 tests with one skipped after the subsequent assembly improvements. The contact tests include 198 orientation trials, 1,200 random pairs in both orders, 360 near-parallel pairs in both orders, 50 analytic touching/shallow cases, and 16 cache configurations with 52 movements each. The unchanged convergence criterion passes 72 trials and retains 120 Hz as the lowest passing contact frequency. These are simulation checks; source fidelity and measured real-world materials remain separate requirements. Plan/review artifacts are `runs/2026-09-27-contact-backend-integration-plan.md`, `runs/2026-09-27-finite-gjk-witness-plan.md`, and `runs/reviews/solid-backend-assembly-code-review.txt`. The later grip and medium-construction evidence is indexed in `runs/2026-09-27-medium-initial-assembly-increment.md`.

For the more expensive continuous assembly checks, regenerate with an explicit wall-clock computation budget:

```sh
node --import tsx scripts/reference/rigid-contact.ts
node --import tsx scripts/reference/assembly-fixtures.ts
node --import tsx scripts/reference/verify.ts --report-only --max-ms=900000
```

This changes only the allowed computation time. Simulation duration, rest windows, grip limits, forces and geometric tolerances stay fixed.

The subsequent solid-sweep optimization removes repeated AABB allocations, reuses only already-observed pair gaps, and computes top-level motion bounds once per tile. Recursive bounds remain tied to exact endpoints. Frozen-oracle tests compare full results and budget checkpoints across 600 moving scenes in both pair orders and analytic boundary cases. All four source reports and both physical fixtures retain identical candidate/physical payloads, excluding only generation time and validator hash. The structural benchmark now passes 20/20 constructive briefs and 5/5 required rejections, including the five-step staircase in 154 seconds within the unchanged four-minute budget. See `runs/2026-09-27-solid-sweep-performance-plan.md` for review and measurement evidence.
