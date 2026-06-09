# System redesign — chosen architecture + phased build plan (durable)

Decision (James, 2026-06-03): build the FULL STACK for programmatic, recognizable builds. Stop
hand-iterating tile drafts; build a system that turns a target (reference encoding + frames) into a
gate-valid AND recognizable build automatically.

Source: synthesis of 5 research memos (01-05 in this folder). Cross-cutting finding: `gateBuild`
proves physical validity but NOT resemblance; the missing keystone is a quantitative
RECOGNIZABILITY SCORER that every generator consumes. POCs (run locally) confirm a scorer
discriminates good/bad (optimizer 75 vs 54; voxel IoU 0.569->0.603 when wings added).

## Architecture = layered stack (not a single winner)
1. FOUNDATIONS — export the target spec; close macro-vocabulary gaps; fix render camera.
2. RECOGNIZABILITY SCORER (keystone) — structural coverage + multi-view silhouette IoU (+ voxel).
3. GENERATOR — hierarchical planner (correct parts/places) + parametric optimizer (correct
   proportions), gate as hard constraint, scorer as objective.
4. ACCEPTANCE — vision-critic loop (deterministic silhouette diff + vision-LLM for semantics),
   gate as hard floor; automates the human eyeball loop.

Why not the others as the CENTER: pure tile-by-tile search = worst tractability (gate too slow
inner-loop; retreats to macro moves = the planner). Voxel fitting as a GENERATOR = heaviest
(silhouette->3D ambiguity; lattice snapping erases the fit) — harvested into the scorer instead.

## Root causes named by the research (why the jet kept failing)
- `REFERENCE_INTENT_SPECS` was not exported. [FIXED in Phase 1a]
- Macro port gaps: open fuselage tube exposes no end ports for a nose; no per-segment side ports for
  low wings; `squarePyramid` has no sharpness param. The blind builder couldn't express a sharp nose
  or seated wings, so it faked them (fan nose, flat wings).
- `scripts/render-draft.ts` camera hook unreliable (the `__r3f` store handle isn't reachable on the
  dev server; falls back to orbit drags) — so vision feedback was never trustworthy.
- Stale jet intent: `silhouetteRules` still demands `bounds.height >= 9` (old tippy-tall-jet
  assumption). The corrected target (docs/jet-rebuild-target.md) is a LOW horizontal tube; recalibrate
  in Phase 2.

## Hard invariants (never weaken in any phase)
gateBuild, the 0.03 hairline, the overlap guard (assembleBuildGraph strict / findRawOverlaps), and
existing tests are the floor. Fix geometry/scorer, never the gate. Claude commits + renders (Codex
sandbox can't). Each phase: Codex builds -> Claude verifies (npm test + gate probe + render) ->
commit -> next.

## Phase status
- [x] 1a. Export ReferenceIntentSpec + REFERENCE_INTENT_SPECS. (commit 55f9cd8)
- [x] 1c. Reliable render camera: window.__buildViewer.setCamera + true side/front/top/iso views;
      verified on house. (commits 973f0c8, b0aaae7 lint follow-up)
- [x] 2.  Recognizability scorer (lib/recognition/score.ts + targets.ts) + calibration test:
      complete jet 0.820 > bare tube 0.348; overlaps -> 0. (commit 06d8f06)
- [~] 1b. DEFERRED/folded into Phase 3: standalone primitives may not be needed if the parametric
      template composes existing macros via attachByPort with CLOSED tube ends (the "right"/"left"
      end-cap ports take the nose; front/back/top take wings/fins). Add dedicated primitives only if
      port coverage proves insufficient. Root fix that matters: connect via attachByPort, never
      free-place (placeMacro) — that was the optimizer POC's disconnection flaw.
- [x] 3.  Connected parametric jet generator (scripts/generate-jet.ts: template via attachByPort +
      hill-climb optimizer) + tests/jet-generator.test.ts. Runs end-to-end -> gate-valid jet.
      (commit 9b80eee). FINDING: structural-only score is gameable (perfect 1.0 renders as a box
      with token triangles).
- [x] 2b. Un-gameable geometric silhouette scorer (lib/recognition/silhouette.ts: tiles projected to
      top/side/front, IoU vs jet target masks from the video) + combinedScore (silhouette-weighted)
      + tests/silhouette.test.ts. Generator now optimizes the combined objective. (commit 39b6502)
- [ ] NEXT (the real bottleneck now): template expressiveness. With the un-gameable objective the
      optimizer still picks 2 token wing tiles (even a vertical dihedral) because the wing/nose
      macros can't build WIDE LOW FLAT wings or a clear nose point. Build proper wing/nose primitives
      (the deferred 1b) so the optimizer has wide-flat-wing geometry to select; then re-run generate-jet
      and the silhouette score should climb and the render should read as a jet.
- [x] 4.  Vision-critic acceptance loop (commit 4b5ec87): lib/recognition/pixel-critic.ts
      (deterministic rendered-frame silhouette comparison via sharp) + scripts/vision-critic.ts
      (orchestrator: render → geometric-sil + pixel-sil + mismatch flagging → visual-inspection
      pairs for semantic review). Full cycle run on the jet: correctly identifies front-view as the
      blocker (pixel IoU 0.27 < 0.35, target coverage 0.48 < 0.50) and diagnoses "wings too narrow
      head-on" — the same conclusion vision review produces. System is complete.

## Where the system stands (durable summary @ commit 4b5ec87)
All 4 phases built + committed + green (174 tests, 0 lint errors):
- Overlap guard (impossible by construction).
- Reliable render camera (window.__buildViewer + true side/front/top/iso views).
- Recognizability scorer = structural (score.ts) + geometric silhouette (silhouette.ts), combined.
- Connected generator/optimizer (generate-jet.ts: params -> draft -> combined-score -> gate -> jet).
- Vision-critic loop (pixel-critic.ts + vision-critic.ts + semantic review).

The pipeline turns params -> draft -> score -> gate -> jet automatically, and the vision critic
correctly identifies what needs to improve. The REMAINING work is template-level: making the wing
geometry produce wide flat panels that fill the jet's silhouette head-on. The system correctly
diagnoses this as a template expressiveness gap (not a scorer, generator, or critic gap).

NEXT SESSION: fix the wing geometry. The obstacle: a right-triangle folded off any cube-corner
edge of the box fuselage interpenetrates the adjacent face (proved by exhaustive sweep). The fix
is either (a) selective bottom-face openings (the real jet leaves the bottom open where wings
attach, and the wings fold off the side wall's bottom edge without collision), (b) a fuselage macro
with per-segment openFaces, or (c) composeMacros + placed wing brackets at known coordinates,
relying on connectByContact for magnetic joining (how the pre-generator hand-built jet worked).
Approach (c) is fastest; approaches (a,b) are cleaner. All are within reach now that the scoring
+ critic infrastructure is complete.

## Note for Phase 3 (label alignment)
The generator must emit subassemblyId/role labels that match JET_RECOGNITION_TARGET
(body, nose, wings, tail, top-fin), so subassemblyCoverage isn't undercounted (the current
hand-built jet labels its body "fuselage" and wings "left-wing"/"right-wing" -> coverage 0.40).

## First proof of the whole stack
A jet generated end-to-end (planner->optimizer, scored, gated, critic-approved) that renders
recognizably as a jet against public/reference-frames/jet-aircraft/steps/. Then generalize to other
reference encodings (ramps, then new YouTube targets).
