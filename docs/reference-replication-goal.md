# Reference replication goal

User direction, 2026-09-23: replicate the ambitious sourced video builds. The structural grammar benchmark is useful infrastructure, but does not meet this goal.

## Fixed targets

| Target | Recorded source inventory | Current draft | Source |
| --- | --- | --- | --- |
| Jet aircraft | 40: 16 squares, 9 equilateral, 10 right, 5 isosceles triangles | 23 pieces | [JD's Curious Company](https://www.youtube.com/watch?v=WDtC_9se3ds) |
| Henry's small ramp | 9: 5 squares, 2 right, 2 isosceles triangles | 8 pieces | [Henry's ramps](https://www.youtube.com/watch?v=vxwBYubszZ8), 00:17–00:42 |
| Henry's medium ramp | 37: 15 squares, 18 equilateral, 4 isosceles triangles | 11 pieces | Same video, 00:45–01:46 |
| Henry's large ramp | 51: 42 squares, 6 equilateral triangles, 3 XL squares | 10 pieces | Same video, 01:55–03:08 |
| 3D snail | Unknown until the exact source is recovered | 42 pieces | Source filename/URL missing from saved notes |

Source counts and timestamps above come from legacy annotations, not a fresh inspection of the videos. Recheck the source BOM cards before treating them as ground truth. Never adopt the candidate's own `expectedInventory` as the target. Preserve XL identity until its dimensions are confirmed; the current catalog equates XL with six-inch large squares without enough source-specific evidence.

## Definition of done for each build

1. Recover the source and pin frame timestamps for the BOM, each meaningful assembly transition, and final views. Hash the video and frames. Record occlusions and uncertain joins explicitly.
2. Fit catalog tiles to measured observations from those frames, with camera calibration and reprojection error. Reserve at least one useful final view from fitting for independent comparison. Do not score against `jet-reference-model.ts`, an AI-authored geometric guess.
3. Match the verified piece inventory, visible geometry, connections, proportions, and final pose. Added supports or a simpler lookalike are separate variants, not a passing replica.
4. Run overlap, magnetic connection, nominal and perturbed release checks. Recheck source-derived shape constraints after settling. If a demonstrably real build fails the simulator, investigate the model with a minimal fixture rather than changing the target or forcing a pass.
5. Generate numbered pieces and joins, preserving meaningful source assembly stages. Check every completed release group. Record steps requiring a hand or off-model subassembly; hand access and individual joining motions remain separate limits.
6. For ramps, reproduce the demonstrated car path and turns using passive vehicle contact. A straight-line ball test does not establish this. Record vehicle assumptions and loaded structure behavior.
7. Publish the model, build instructions, source-versus-render comparisons, and independent fidelity/physics/assembly results. Claim success only when each required result is verified.

Physical magnetic calibration remains necessary before calling a passing simulation a real-world guarantee. A single hand-authored replica also does not establish general text-to-build capability. The eventual generator must solve new briefs using the same measured geometry and physics checks.

## Immediate work and blocker

Start with the jet as the recognizability target and Henry's medium ramp as the functional target. Use the small ramp to calibrate the ramp primitive, then scale to the large ramp; recover the exact snail source before reconstructing it. The jet notes contradict each other about fuselage shape/orientation, so resolve that from video rather than selecting whichever description is convenient.

The current checkout contains neither `sample-videos/` nor `public/reference-frames/`. A search of saved uploads did not locate the media, and direct YouTube retrieval was unsuccessful. Original uploads or accessible video files are needed to carry out the source-fitting and visual verification work. Do not replace this missing evidence with renders of existing guesses.

## Reproducible baseline

Run `node --import tsx scripts/audit-reference-replicas.ts` from the repo root. It inspects the actual shipped drafts, counts their tiles independently of their saved metadata, compares the legacy source inventories, and reruns the existing physics gate. Results are in `verification/reference-replication-baseline.json`, with target and candidate fingerprints. Successful command completion means the diagnostic report was written, not that replication passed.

This audit is deliberately a baseline, not a new reconstruction algorithm. Source fidelity and assembly matching remain unverified even if a file exists or a physics check passes. None of these five builds is currently established as a faithful replica.
