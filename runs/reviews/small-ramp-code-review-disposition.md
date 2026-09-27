# Assembly/source evidence code review

Claude Opus authentication failed once (expired OAuth refresh); fresh independent GPT-5.5 substitute reviewed the increment. Initial verdict BLOCK; review at `small-ramp-code-review.txt`.

| # | Finding | Disposition and fix |
|---|---|---|
| 1 | Two held panels can leave no dynamic body | ACCEPT transparency and regression; REJECT banning two real hand contacts holding two panels. Such a ban also forbids the necessary one-panel first insertion. Clarified the plan: each hand controls exactly one panel, with a maximum of two. The record now exposes dynamicTileCount and explicitly denies free stability when zero. A suspended hinged pair passes only while both panels are held; removing the second hand causes failure. Every next insertion removes its old hand first, moving modules have one hold, and every released stage has a mandatory free checkpoint even if it inserts zero parts. |
| 2 | Freeze absent from evaluation | ACCEPT. Added locked candidate-freezes.json, wired actual build digest + candidate freeze + ledger history into ReplicaReport.holdoutCoverage, and made failures block fidelity. Frozen small geometry evaluated against reserved frames; these are duplicate fitting view families and correctly receive no independent coverage. |
| 3 | Reserved PNGs unbound | ACCEPT. Registered both reservations in sources.json and frame-manifest.json and included them in the local source byte-hash verification. Reservation source/time/partition/path/digest must match the verified extraction. Added mismatch regressions and actual extracted-file corruption probe. |

Additional implementation audit: release-only stages now run their free checkpoint outside the insertion loop; a regression covers reuse with zero insertions. Candidate digest changes after freeze also fail.

Independent fresh verification in `small-ramp-code-verification.txt` marked all three ADDRESSED, explicitly agreed that banning two independent hands on two panels was incorrect, and found no additional concrete blocker. Preview QA and full executable checks remain in the implementation lane.
