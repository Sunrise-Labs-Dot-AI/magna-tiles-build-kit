# Physical state continuity, docking and held assembly motion

Progress on the active full verified-build goal. Worktree `magnatiles-footage-replicas`, branch `codex/footage-grounded-replicas`, draft PR #4. Preserve the dirty original checkout; do not merge or promote production.

## Implemented

- Explicit engine state preserves each body's original hull frame, actual pose, linear/angular velocity, body mode, CCD and first-release perturbation marker. Existing magnetic joints retain their original local anchors, both break histories and popped IDs. Continuations reject omitted/reset bodies and omitted old connections. Rapier solver warm-start caches are not serialized.
- New seams between differently rotated body frames use two spherical constraints that leave only hinge-axis rotation free. Both constraint points are tested by the original break law. Default fresh-world hinges retain the revolute representation. Tests compare the free fold with an ordinary revolute fixture and tear the secondary anchor while retaining the primary position.
- Incoming panels dock to actual installed-neighbor displacement, with bounded ±0.03-inch translation proposals and unchanged contact, floor, prism, grip and insertion acceptance. Installed parts, catalog dimensions and source measurements are untouched. Docking displacement is not a temporary animation offset.
- Held translation/rotation drives exactly one pickup panel kinematically. All other parts remain dynamic except an optional one-panel support hand. Actual state continues across approach, attachment, support, seating and release. Prepared module combinations still fail closed until an actual transfer is implemented.
- A separate conservative swept-prism validator checks translation and SLERP rotation. Full vertex-motion bounds certify intervals; uncertain intervals subdivide and reject at their budget. Fingertip arcs, moving obstacles, the fixed table and the two hands are checked. Mid-turn collisions and dynamic-panel collapse have adversarial tests.
- Support/release uses CCD and 960 Hz collision steps, held motion/seating use 480 Hz. Physical duration, 90 reporting-step rest requirement, forces, friction, 0.03-inch raw tolerance and 0.95-inch deformation limit remain unchanged. First-release uncertainty is added once per panel to actual momentum and its marker persists.
- Prefix pickup and a two-panel to one-panel grip handoff are explicit. Bounded finger polylines may reach beneath a lifted side while retaining the same proxy size. Acquisition paths also check their own panel and the other hand.
- Chronological playback includes pickup, support handoff, approach, gravity seating, lowering and release. It retains actual failure poses and omits future parts. Presentation-only keyframe compaction retains actual first/terminal frames; all physics substeps are still checked.

## Source results and immediate next diagnosis

The upper small-ramp deck now inserts and closes after the U support settles, across all three seeds. The lower deck can also be attached after lifting the four-part prefix 0.85 inches from its actual pose, transferring support to one yellow side, and using checked bent fingertip approaches. The complete wedge is lowered 0.32 inches before release. These detailed hand motions are hypotheses, not measurements from Henry's video.

Every seed still rejects the free wedge release. At 480 Hz, early impact exceeded the unchanged floor tolerance. At 960 Hz, the simulation gets beyond impact and shows gradual lower-deck penetration: the first inspected seed reached approximately -0.125 inches against a fixed floor at -0.095 inches around 0.60 seconds. This is a remaining contact/assembly issue, not grounds to relax tolerances, stretch the isosceles tile or grant a pass. The actual failure is recorded in the report and viewer.

The launch's four sideways construction operations still pass all three seeds with state continuity. Its later rotation/combination remains unverified. Nominal small-ramp release passes but is not a substitute for the failed actual assembly release. Source fidelity and car acceptance remain separate.

Next: inspect the actual free wedge's ground contacts and hinge loading, including why the low-deck overhang gradually penetrates while other parts rest. Preserve the passing held assembly as a fixture. Then implement actual prepared-world transfer, with no reanchoring or pose teleport. Continue source-fidelity reachability, jet, medium passive car, large assembly and exact snail-source work.

## Verification and review

The full suite has 345 passing tests and one existing skip across 27 files. Production build, type-check and lint pass; lint retains 38 existing warnings. Structural benchmark remains 25/25; the complete current benchmark is `/tmp/magnatiles-motion-structural-benchmark.json`, with a checked summary under `verification/replication/`. Source reports and artifact fingerprints are regenerated. Desktop/mobile browser checks cover all downloads, stable part labels, actual pickup motion, absence of future parts, actual terminal release poses and gravity placement; no page errors or mobile overflow. Source acceptance remains intentionally non-passing.

Review resolution: `runs/reviews/docking-motion-review-resolution.md`. Claude authentication failed on one attempt per review; fresh GPT-5.5 reviewers assessed the plan, identified two code findings, and cleared their fixes. This is a reviewed foundation increment, not full goal completion.
