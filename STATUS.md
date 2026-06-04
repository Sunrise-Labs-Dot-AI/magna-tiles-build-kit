# Status: where it stands and what's next

This is a completed research exploration, archived in public. The summary is honest: the kit is a working build-and-verification system, but it does not faithfully reproduce the source video build. This document records what works, what does not, why, and what a serious next attempt would do differently. The deepest version of the "why" is in [research/diagnosis.md](research/diagnosis.md).

## What works

- **An un-gameable physics gate.** `gateBuild` ([lib/engine/gate.ts](lib/engine/gate.ts)) passes a build only if it clears every check: a no-overlap pre-filter at a 0.03 hairline tolerance (admits face-to-face contact and float noise, never real overlap, and is never widened to make a build pass); magnetic-join validity (every joint is a real edge-to-edge magnetic connection with adequate support); a Rapier stand test (the build is simulated and must stand with bounded displacement and no popped joints); and a roll test for functional ramps (a test object must roll to the bottom without falling off).
- **A tile macro / attach system.** [lib/magnetic-tiles/](lib/magnetic-tiles) provides a tile catalog, an edge-attachment system, and macros that compose tiles into larger assemblies.
- **Overlap impossible by construction.** Rather than detecting overlap after placement, the attach system places tiles so that real overlap cannot occur. The gate's pre-filter is a backstop, not the primary defense.
- **A recognizability scorer.** [lib/recognition/score.ts](lib/recognition/score.ts) combines a structural score with a geometric, multi-view silhouette IoU ([lib/recognition/silhouette.ts](lib/recognition/silhouette.ts)) against a target shape. The geometric path is designed to be hard to game.
- **A parametric generator + hill-climb optimizer.** [scripts/generate-jet.ts](scripts/generate-jet.ts) generates connected candidate builds from a template and hill-climbs toward a higher combined objective.
- **A video-to-3D reconstruction + interactive viewer.** [scripts/reconstruct-jet.ts](scripts/reconstruct-jet.ts) and [lib/recognition/jet-reference-model.ts](lib/recognition/jet-reference-model.ts) produce the jet target, viewable from any angle in [public/jet-model.html](public/jet-model.html).
- **A vision-critic harness.** [lib/verification/visual-judge.ts](lib/verification/visual-judge.ts) and [scripts/vision-critic.ts](scripts/vision-critic.ts) render a build and ask a vision model whether it structurally matches a reference, returning actionable differences. It fails closed when no model key is present.
- **A library of ~9 builds:** ramps (small / medium / large), house, castle, dog, snail, rocket, jet, authored as JSON in [build-drafts/](build-drafts) with generated renders in [verification/](verification).
- **The jet milestone.** The jet was taken from a box-with-fins to a gate-valid, recognizable wide-delta-wing jet via a "coplanar lateral extension" fold. Widening flat wings by extending coplanar tiles laterally (rather than tilting them) was the research report's key finding, and it produced a recognizable, gate-valid result.

## What doesn't work (the key limitation)

**The output does not faithfully match the source video build.**

Root cause, per [research/diagnosis.md](research/diagnosis.md): the reconstruction **target** ([lib/recognition/jet-reference-model.ts](lib/recognition/jet-reference-model.ts)) was hand-authored by a model eyeballing video frames, not a measured reconstruction. Vertex coordinates were typed in by eye and revised across commits as the model re-looked at frames (including one fuselage shape that was wrong until a human caught it). Because the target is an uncalibrated guess, the whole pipeline optimizes toward an approximation, and **no measured video signal ever enters the loop**. A perfect recognition score therefore means "matches our guess of the build," not "matches the build."

The diagnosis is blunt about the second-order cause: large language models were over-relied on as a 3D-reconstruction engine, a geometry/fold-angle solver, a combinatorial placement optimizer, and a visual judge, four roles they cannot fill reliably. The research design that opened the project had already said so. The result was roughly 25 commits of propose / wrong / re-propose, which is a human-interrupted random walk, not convergence, because there was no error signal from the video to converge against.

A secondary, real-but-not-dominant ceiling: the reconstruction generator transcribes a fixed macro sequence rather than searching the placement space (no MCTS, beam search, or constraint solver on that path). If the target were correct, the generator could likely produce a recognizable output, so this is the lesser of the two gaps.

## What's next

A serious next attempt would replace the eyeballed pieces with measured ones. From [research/magna_tiles_system_design.md](research/magna_tiles_system_design.md) and [research/diagnosis.md](research/diagnosis.md):

1. **Replace the target with a real reconstruction.** Run the clean video frames through structure-from-motion (COLMAP, free and open source; DUSt3R / MASt3R for research-grade multi-view reconstruction), or use a human-encoded ground truth, to get a calibrated geometry. Derive tile placements analytically from that, instead of by eye. This is the single highest-leverage change.
2. **Add a real search / constraint solver.** Replace transcribed macro sequences with MCTS or a CP-SAT constraint solver over tile placements, so the system searches the space rather than restating a guess.
3. **Add a learned / perceptual scorer measured against the real frames.** A CLIP or VLM perceptual score computed against the actual video frames (not a hand-authored render) gives the loop a real error signal.
4. **Consider a part-grammar prior.** A part grammar (for example ShapeAssembly) would give structured priors over how recognizable objects decompose into parts, instead of a flat macro library.

What a language model can legitimately do in that next attempt: write the integration code (attach math, macros, the gate) once the geometry is externally sourced, translate a correct part list into macro calls, and write the analysis. What it should stop doing: typing vertex coordinates from frames, iterating geometry without a real error signal, and acting as the visual judge of render-versus-video.
