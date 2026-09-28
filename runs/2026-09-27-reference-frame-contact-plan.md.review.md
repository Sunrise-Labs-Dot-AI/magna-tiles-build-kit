# Contact plan review disposition

Initial review: BLOCK with three concrete gaps. All gaps are addressed before production dependency or engine changes. Final focused verification cleared all three plan gaps; see reference-frame-contact-plan-followup.txt.

| Finding | Disposition | Plan edit | Verified |
|---|---|---|---|
| Solver-induced motion can inflate contact allowance | ACCEPT | Freeze pre-step velocity/radius/gravity allowance, absolute cap, separate motion failure, require initial geometric/anchor equivalence and nonempty contacts | Main-task reread |
| Temporary probe in normal test set | ACCEPT | Delete every scratch test before full tests/CI; only /tmp diagnostic results | Scratch file removed; no production dependency change |
| Browser/headless version split | ACCEPT boundary audit; reject mandatory sandbox migration | Resolve/document both versions, verify /builder diagnostic labeling separately from /references recorded headless replay, make no collider/version parity claim | Existing diagnostic boundary retained; no source acceptance comes from browser sandbox |

The third finding identifies a real boundary to test. Forcing parity itself would be unrelated scope because this sandbox already uses a separately labeled diagnostic implementation, and the recorded reference replay does not run it. The plan now makes that distinction explicit and includes QA of both surfaces.
