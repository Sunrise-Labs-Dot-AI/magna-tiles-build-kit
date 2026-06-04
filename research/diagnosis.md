# Diagnosis: why the output is still far from the video build

*Produced by Codex (GPT-5.x) as an analysis-only, deliberately skeptical review. Saved here by Claude (Codex's sandbox blocked the write). Claude's annotations/corrections are in the footer.*

---

## Blunt Verdict (5 sentences)

The pipeline has no connection to the real video at any stage after the first commit. The "target" (`lib/recognition/jet-reference-model.ts`) is a set of vertex coordinates typed in by Claude while eyeballing frames, confirmed across commits `a8b4f75`, `8416918`, and `c98102d` (including a wrong fuselage shape James caught and reverted in `8416918`). The scorer measures IoU against that guess, not against the video, so a perfect score means "matches Claude's misremembering," not "matches the build." The physics gate (`lib/engine/gate.ts`) enforces only magnetic-attachment validity and explicitly leaves visual resemblance to human signoff, which remains `false` in the current draft. The LLM has been used as reconstruction engine, geometry solver, combinatorial optimizer, and visual judge, four roles it cannot fill reliably, and the research report said so before any of the 25 attempts started.

---

## Stage-by-Stage Error Analysis

### Stage 1: Target reconstruction (jet-reference-model.ts) — error injected: large, foundational.
Introduced in `a8b4f75`, revised in `8416918` ("James's catch") and `c98102d`. Each revision is Claude re-eyeballing frames and retyping coordinates. No photogrammetry / structure-from-motion. The vertex coordinates have no measured ground truth. Consequence: the triangular-prism fix was caught by a human; if one primitive was wrong before a human noticed, the others (wing dihedral, span ratio, tail geometry) are equally suspect with no error bound, and the scorer cannot know.

### Stage 2: Recognizability objective (score.ts + silhouette.ts + pixel-critic.ts) — error injected: medium, compounds Stage 1.
All sub-scores compare to the hand-authored reference model, never to the video frames. Optimizing them to 1.0 produces a build matching Claude's coordinate guess, which already diverged from the video in at least one confirmed dimension. `visualSignoff` is false.

### Stage 3: Generator / tile-attach (generate-jet-reconstruction.ts, macros.ts, edge-attachment.ts) — error injected: medium; a real ceiling but not dominant.
Constrained to the macro vocabulary assembled via edge-attachment fold geometry. The reconstruction generator transcribes a fixed macro sequence from the hand-authored model rather than searching the space (no MCTS / constraint solver / beam search). The tile vocabulary is not the bottleneck; the lack of search is. If the target were correct, the generator could probably produce a recognizable output.

### Stage 4: Verification (gate.ts + human signoff) — error injected: small for what it checks; the check is too narrow.
`gateBuild` validates magnetic connectivity + non-intersection only. It does not check visual resemblance. A perceptual / VLM critic was proposed (05-multi-agent-vision-loop.md) but not built.

**Single biggest source of divergence: Stage 1.** The target is wrong, so every downstream score measures the wrong thing.

---

## The garbage-in problem
Three additive gap components: (1) target error (uncalibrated eyeball guess, structurally unbounded, dominates the gap); (2) generator expressiveness/lack-of-search (real but secondary); (3) gate constraints (negligible divergence). The scorer amplifies the target error by measuring against the wrong reference.

## Designed vs built
| Designed (research report) | Built instead |
|---|---|
| DUSt3R/MASt3R multi-view reconstruction | Claude typing vertex coordinates by eye |
| MCTS / learned search over placements | Fixed macro sequence transcribed from the reference model |
| CLIP/VLM perceptual scorer vs video | IoU vs the LLM-authored reference render |
| Part grammar (ShapeAssembly) | Macro library, no grammar |
| CP-SAT / constraint solver | None; placements hardcoded |
All five were labeled "future/large" in the review and none were built. The substitutes are categorically different, not degraded versions.

## Where LLMs are overestimated
1. Precise 3D reconstruction from images by eye — no camera model, no triangulation, no convergence; needs a human catch every time.
2. Spatial/fold-angle reasoning across 20+ tiles — locally plausible attachments produce globally wrong shapes (the "wide flat wing" failures).
3. Combinatorial placement as a solver — one candidate per iteration, no search/backtracking.
4. Consistent visual judgment "does this look like the video" — inconsistent, uncalibrated against the frames.
5. Convergence via hand-tuning — ~25 commits of propose/wrong/re-propose is a random walk with human interrupts, not convergence, because there is no error signal from the video.

## Bottom line
"Matches the video" is categorically unreachable with the current approach: no signal from the video flows through the loop except the initial uncalibrated eyeballing, so more LLM iterations cannot converge.

**Minimum viable next step:** replace Stage 1 with a REAL reconstruction. Run the clean frames through structure-from-motion (COLMAP free/OSS; DUSt3R/MASt3R research-grade) to get a calibrated point cloud, then derive tile placements analytically rather than by eye. The rest of the pipeline can stay.

**Stop doing with an LLM:** typing vertex coordinates from frames; iterating geometry without a real error signal; using the LLM as visual judge of render-vs-video.

**LLMs can legitimately:** write the integration code (attach math, macros, gate) once geometry is externally sourced; translate a correct part list into macro calls; write this diagnosis.

---

## Claude's annotations (corrections / nuance)
- Mostly accurate and I agree with the core conclusion. Two factual nuances: (a) one generator, `scripts/generate-jet.ts`, *did* run a parametric hill-climb optimizer (so "no search anywhere" is too strong — but the reconstruction path it critiques genuinely is a transcription, and the hill-climb optimized against the wrong target anyway, so the conclusion holds); (b) I could not confirm a `verification/PROGRESS.md` with a `visualSignoff` line — that specific citation may be approximate, though `visualSignoff: false` is the draft default.
- The load-bearing claim is correct and unaffected by those nits: the target is an LLM eyeball-guess, the scorer optimizes toward it, and no measured video signal enters the loop.
