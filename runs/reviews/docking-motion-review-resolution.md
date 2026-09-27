# Docking and state-continuous assembly review

Full engineering loop, runtime physics and acceptance changes. Plan: `runs/2026-09-26-docking-transfer-plan.md`. The active verified-build goal is not complete. This increment remains on draft PR #4; no production promotion or merge.

Claude Opus was attempted once for the plan and once for code review. Both returned `Failed to authenticate: OAuth session expired and could not be refreshed`. Fresh GPT-5.5 high-effort read-only CLI reviews substituted. The implementing lane ran all tests.

## Plan findings

The plan reviewer required explicit body/joint state, retention of the prepared-transfer guard, a separate swept rotation validator, an operation on existing parts for pickup, and actual moving-part docking poses. These requirements are implemented for support, new-panel insertion, gravity seating and pickup/lowering. Combining independently prepared worlds remains unverified until a continuous transfer is implemented. Solver warm-start caches are not serialized; body reference geometry, poses, velocities, modes, CCD, release perturbation markers, original anchors, both break histories and popped joins are retained.

## Code findings

| Finding | Disposition | Fix and verification |
|---|---|---|
| CRITICAL: companion constraint could carry load without being tested for breakage | Accepted, fixed | Both anchors use the unchanged timestep-aware break law. Both constraints are removed together, and both prior distances survive snapshots. The regression rotates about the coincident primary anchor while tearing the secondary; it asserts primary separation below 0.01 inches and joint removal. |
| WARNING: source wedge pickup/handoff/lowering/release lacked explicit tests | Accepted, fixed | All seeds 0/17/53 run even when an earlier seed fails. The source regression asserts the first four insertions pass, the fifth pickup/docking/lowering pass, the two-panel to one-panel handoff occurs, and the actual free release is rejected for table penetration. Playback at 100% equals that terminal failure pose. |

`docking-motion-code-review-followup.txt` clears both findings and gives MERGE-OK for the foundation increment. It does not accept a full source replica. Later presentation compaction retains actual first/terminal poses, keeps only real recorded keyframes and caps each phase at 32; its test verifies every retained frame came from the original trace. Every physics substep still runs the checks. Exact unchanged poses reuse an existing clearance result; uncertain rotating intervals still subdivide and fail closed.

## Remaining goal work

The wedge's low deck gradually exceeds the fixed-table tolerance after release; attachment while held is not a free-standing certificate. The transformed launch transfer is still rejected. Full fidelity, medium passive turns, jet release, large assembly and the exact snail source remain outstanding.
