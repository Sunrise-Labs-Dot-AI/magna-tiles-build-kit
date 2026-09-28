# Retain the lifting hand through an insertion

## Trigger and bounded proposal

The medium lower-wedge experiment successfully places one side and the upper deck, then lifts the actual two-piece prefix 0.85 inches while holding only the upper deck. That continuous motion passes all three seeds. The current pickup contract then requires a *different* installed support panel, forcing the roof hand to release. With only the side held, the deck swings 0.968–0.970 inches and fails. This is a real failed proposed handoff, not permission to relax displacement or restore a nominal pose.

Proposal: permit a pickup to keep the same single-panel hand as the support hand for the next insertion. A person can lift with one hand, keep holding, and insert with the other. The existing code currently rejects this through `support[0] === hand.tileId`, independent of physical checks.

- Keep the current distinct-panel handoff path unchanged. For a retained hand, require the pickup and support grip definitions to be numerically identical after normalizing omitted approach offsets to the default path. Introduce a shared helper comparing tileId, proxy, localPoint, localOutward and every normalized path coordinate; use it for prepared transfer too. No epsilon, object identity or JSON-property ordering may change this identity check. A same-tile different grip is a regrasp and remains unsupported.
- Run the same continuous held motion with the same one-panel clamp, dynamic neighbors, fingertip/table/solid checks, actual predecessor state and bounded pickup height. Preserve the recorded pickup motion and every failure.
- After pickup, branch around only the redundant two-panel handoff, avoiding duplicate same-tile hand definitions and held IDs. Record exactly one retained support ID. Continue the ordinary one-panel support trial before collecting the incoming piece, then the full insertion, connection, lowering and all-hands-free stage checkpoint. Never hold the incoming panel during pickup or use a third hand.
- Before pickup, if inherited/prior heldHands includes another hand, require a recorded access/withdrawal and retained-one-panel support transition using the actual current pose/state. Check that the removed hand can leave while the identical retained hand stays, then carry the resulting state into the lift. Do not silently drop a grip at the motion boundary. If acquisition of a new pickup grip would need a third hand, reject this bounded proposal unless an explicit prior release transition already frees that hand.
- Use the unchanged medium four-piece candidate only as a diagnostic integration case. Passing it does not establish source hand motion, shape fidelity or a full 37-piece assembly.

## Acceptance

Add a source-independent two-panel pickup fixture where retaining the same grip passes and the forced other-panel handoff fails or is unsupported. Test identical-grip success, changed same-tile grip rejection, missing/duplicate/third hand rejection, absent pickup panel, height bounds, obstructed withdrawal (including two held hands inherited from a prior operation or predecessor), recorded one-hand support before lift, normalized default/explicit approach identity, reordered object properties, actual state carry and mandatory final free release. Rerun existing distinct-hand pickup/small-ramp tests. The fresh medium proposal must pass all three seeds before integration; failed attempts stay visible.

Full engineering loop: new assembly state transition. Get a fresh alternative-model plan review, implement after the collision-performance evidence is complete, run focused and full checks, then a code review and fresh source evidence if integrated. Preserve all physical limits and the draft PR boundary.

## Review disposition

Fresh GPT-5.5 review identified four required changes, all accepted: mandatory withdrawal/support before pickup for prior held hands; shared normalized numeric grip identity; an explicit branch preventing duplicate hands in the retained path; and an inherited-two-hand negative/recorded-transition test. The edited bullets and acceptance list were reread against assembly.ts, prepared-transfer.ts and grip.ts. Implementation must also keep actual failed support states in the playback record.
