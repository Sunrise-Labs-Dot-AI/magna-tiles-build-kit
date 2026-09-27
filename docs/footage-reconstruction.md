# Footage reconstruction workshop

Updated 2026-09-26. `/references` contains four inspectable reconstruction candidates and their separate evidence. **No complete source replica is verified.** The new models are independent of the old AI-authored jet reference model and the 23/8/11/10-piece draft approximations.

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
| Small ramp, 9 | Verified local hashes and BOM | Fails withheld view | Passes all three perturbations | Wedge/final release and ten nominal paths pass; intermediate deck closure and launch grip fail | One assumed car completes the inferred deck route with wheel contact |
| Medium ramp, 37 | Verified local hashes and BOM | Fitting and withheld views fail | Does not reach sustained rest | Four-piece wedge and five-square support pass; combined stages fail | Fails; no successful passive turn demonstrated |
| Large ramp, 51 | Verified local hashes and BOM | No scored camera fit yet | Passes all three perturbations | Released checkpoints pass; insertion and grip checks remain unverified | Not reconstructed/tested |
| 3D snail | Exact source absent | Not assessed | Not assessed | Not assessed | Not assessed |

All real-world material behavior remains **uncalibrated**. Passing a simulator check is not a claim of physical validation. Detailed numbers and failures live in `verification/replication/results.json` and the workshop downloads.

## Continued harness development

The goal is reliable generation of verified builds. The earlier candidate PR is a checkpoint, not the acceptance event. The implementation plan and independent review are in `runs/2026-09-26-reliable-verification-plan.md` and its sidecar. No source verification is promoted by the current increment.

`lib/replication/insertion.ts` checks the complete swept path of fixed-orientation translating catalog prisms against every installed part and the table. It intersects analytic time intervals on the full prism separating-axis set, including thickness edges; collisions between distant endpoints cannot evade the check. The unchanged 0.03-inch contact tolerance applies. Rotating insertions are outside this solver.

`planConstructionPaths` performs bounded direction search in a supplied per-part order, validates each path independently, and retains all installed parts as obstacles. Multi-part moves require a previously planned matching module. Missing parts, duplicate insertions, future module references, and a single arbitrary whole-model insertion fail. These are clearance checks, not hand or stability checks.

The small ramp has five wedge insertions, four separately held launch-module insertions, and one module-joining path. The per-part order is a candidate sequence within the source stages; the generated paths are not measurements of Henry’s hand motions. Select a construction checkpoint and an insertion in the workshop, then move the slider to inspect it. Downloads contain the same coordinates used by the validator.

### Supported assembly and independent source evidence

`evaluateAssembly` now simulates every operation across seeds 0, 17 and 53. A maximum of two hand contacts each controls exactly one panel. A hand cannot fix an entire multi-part module. When one or two panels are each directly grasped, their zero-dynamic-body record explicitly makes no free-stability claim. Before the next insertion, the previous insertion hand is removed. Carried modules have one held panel, with the remaining parts dynamic. Every released stage runs a mandatory free checkpoint, including stages that add no parts.

The fingertip proxy pinches an actual catalog edge with two 0.22-inch-radius spheres, checked along a 1.5-inch approach and the full translation. It checks table clearance, present panels, support-hand clearance and withdrawal. This is a stated proxy, not a measurement of human dexterity, palm clearance or grip force. Rotating transfers remain unverified. The table stays at the complete stage's height; a floating prefix cannot invent support by regrounding itself. Settled geometry is carried into the next insertion and closure rather than restored to the authored pose.

Closure adds stricter contact requirements than the legacy broad magnetic search: transverse edge gap at most tile thickness plus 0.03 inches, alignment within 5 degrees, and longitudinal overlap within 0.21 inches of the shorter edge. A disconnected or merely nearby module cannot pass. All original raw-overlap, peak-motion and rest limits remain unchanged.

A source-independent three-wall U now passes its complete assembly in all three seeds, including final free releases. Reproducible evidence is `verification/replication/assembly-fixture.json`; the build also rejects a stale or edited fixture artifact. Negative tests cover missing/excess grips, blocked approach, unsupported hanging modules, absent joins, premature floating-panel release and omitted operations. The small candidate passes assembly of its three-piece base but its first deck insertion fails strict edge overlap after settling. Its launch-module proposal fails grip clearance. The detailed checks are visible in the workshop and downloads.

The fitting footage at 24.5 seconds shows the small ramp's rear square and two isosceles sides standing before either deck panel is installed. Its instructions now follow that observed sequence. The 34-second historical annotation had lateral corner IDs mirrored; only those IDs were corrected, preserving all pixels and roles. Prior observations and locks remain in `verification/replication/observation-history/`. Correcting this transcription makes the camera physically plausible, but scored RMS remains about 23.3 pixels, above the unchanged threshold. The candidate geometry has not changed.

Camera acceptance now separately requires an observed hemisphere, position above the table, finite positive focal length, nondegenerate axes and positive depth. A perfect pixel residual cannot override an impossible camera. Historical views with no recorded region cannot pass this gate.

The locked evidence-use ledger and candidate-freeze record track source/frame hashes, reservation and inspection order, prior inspection, baseline/current candidate digests and reviewed view families. The actual evaluator uses those records; changing a candidate after freeze fails, and reservation hashes must match verified local extraction records. The newly reserved 36.25- and 40.2-second frames were inspected only after candidate freeze. They match already inspected fitting view families, so neither supplies new independent coverage. The first shows the yellow car descending the orange deck, but does not by itself measure a complete trajectory. The second is a wide shot with the completed small ramp on the left. Source insufficiency is recorded explicitly; no favorable frame replaces a failed heldout measurement.

### Numerical contact correction

The old engine inflated each already finite-thickness tile collider by a 0.006-inch contact skin. At flush, hinge-constrained seams that added competing separation and attachment constraints. Rapier documents that contact skin creates a gap between touching objects ([official documentation](https://rapier.rs/docs/user_guides/javascript/collider_contact_skin/)). Removing this extra margin retains full tile hulls, contact between connected tiles, and all physical constants. It changes neither magnetic torque nor raw intersection tolerances.

A source-independent nine-piece closed support failed to settle with the old margin and reached sustained rest without it. A thirteen-piece support drifted 2.60 inches in the old 7.5-second diagnostic and only 0.266 inches without the margin, including the deliberate 0.28-inch drop. The 9/13-piece fixtures pass all three release seeds after the correction. Full differential results are in `verification/replication/contact-diagnostics.json`; reproduce with `node --import tsx scripts/reference/contact-diagnostics.ts`.

The 51-piece source candidate now passes three releases with peak displacement about 0.270 inches. The medium candidate settles late and still fails the required 90 consecutive rest steps within 900 steps. The jet still fails. The correction also makes the historical 23-piece jet fail its nominal gate; its former stored engine-valid status was stale. A generated two-step riser now uses three explicit rear-bracing squares (13 pieces total) because the old open-ended linkage collapses without the artificial contact margin. No supports were added to source candidates.

## Source record and observations

The original local jet cache was recovered. After searching the project, Documents, Downloads, Movies, Desktop and local media indexes, Henry's exact supplied YouTube video was retrieved in format 399. The exact 3D snail was not found; the separate flat snail was excluded.

| Source | Local path | SHA-256 |
|---|---|---|
| [Jet](https://www.youtube.com/watch?v=WDtC_9se3ds), 1280×720 | `.video-cache/WDtC_9se3ds/source.mp4` | `7df676be56d549cf9b2bd5d4702bf4e92b5508a04db2bd75733b490405e193f7` |
| [Henry's ramps](https://www.youtube.com/watch?v=vxwBYubszZ8), 1920×1080 | `.video-cache/vxwBYubszZ8/source.mp4` | `2d2aca38030161b613d445154154e59a040514543079de9936869ba25d85bfe0` |

`sources.json` records 47 BOM, construction, comparison and functional-inspection timestamps. `frame-manifest.json` binds each PNG to its source hash, timestamp, construction stage and partition. Videos and extracted creator frames stay ignored locally. The PR contains our geometry renders and numeric annotations only. Restoring media on another machine requires the same bytes; a changed download fails the hash check.

Five sparse camera observations contain six camera anchors and at least four scored corners each. RMS tolerance is **2%** and maximum corner error **4%** of the source annotation bounding-box diagonal. Camera fitting has seven parameters and rejects insufficient or degenerate depth anchors. Its optimization and initialization use only camera anchors. Changing check pixels cannot change the fitted camera. Runtime labels, stage membership and exact locked observation content are validated.

The initial topology hypotheses predate the annotations, so this is not a blind reconstruction study. The 388-second fitting view had a mirrored face-index transcription corrected without changing its pixel measurements. Cockpit pitch was fitted from construction geometry before inspecting the 397/416-second withheld views. Geometry was not tuned to their errors. The 416-second frame was rejected because it is dark, cropped and hand-supported, so the jet still lacks a second useful independent withheld view. That exclusion remains recorded, not silently replaced by a favorable frame. Medium has one measured fitting stage and one measured withheld view. Small has one measured withheld view. The large ramp has no scored observation yet.

The evaluator deliberately cannot award full fidelity from these sparse points. It lacks complete silhouette/visible-edge coverage, constraints on every occluded part, and two independent useful final held-out views per target. A passing point comparison never promotes `replication` beyond `not-verified`.

Construction links identify an assembly operation or prepared subassembly; other pieces can appear around it. Only fit/holdout observations claim a specific projected stage snapshot. Source transitions are not treated as views of one static object.

## Findings from the footage

- The jet body is four triangular prism bays of three squares each. Four further squares belong to the two wing pods. The final six-piece cockpit retains two long purple triangles, two green right triangles, a yellow divider and a red floor. A rigid tilt seats its longitudinal tips; hidden joins and pod incidence remain hypotheses.
- The medium candidate allocates eight squares/isosceles pieces to two open-back wedges, five green squares to the elongated U support, sixteen equilateral triangles to four canopy walls, two blue equilateral turn pieces, four yellow cover squares and two red launch squares. The exact canopy/support arrangement is still contradicted by image measurements; matching the BOM is insufficient.
- At 1:46, Henry points along the medium ramp. The inspected close-up does not establish a complete car trajectory. Its roof route is an **inferred functional target**. A successful real passive turn is not asserted.
- The large blue XL edge spans two classic-square widths in the 2:50 construction view, supporting a 2:1 side ratio and the catalog's six-inch interpretation. This relative observation does not calibrate dimensions, magnet spacing or force.
- The catalog's existing 143 mm isosceles equal side is shorter than two three-inch squares. The model retains a 0.37-inch total deck overhang. Actual source-piece measurement is needed; triangle geometry was not enlarged to make the model fit.

## Physics diagnosis

`reference:fixtures` isolates body rings, body-plus-nose, the small wedge and the separate launch. Held stages can also be deliberately simulated without hands as diagnostics, explicitly labeled as such. A separate two-piece fixture clamps one panel and releases the adjoining horizontal panel. It sags to near vertical without breaking the hinge, exposing the current joint's lack of restoring torque. The clamp is never added to a source model.

The new source release check samples maximum corner displacement every step for up to 900 steps at 120 Hz. It requires no broken/rejected joints, peak displacement ≤0.95 inches, and at least 90 consecutive rest steps below 0.035 inches/second linear speed and 0.08 radians/second angular speed. Stage checkpoints use the same check. This is stronger than the historical nominal gate, which could report a low final displacement while the assembly was still moving.

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
