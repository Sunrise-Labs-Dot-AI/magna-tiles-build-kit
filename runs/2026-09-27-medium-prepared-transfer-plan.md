# Medium ramp: prepare, transfer and join modules in one world

**Not ready to implement.** The initial review requires the corrections below. A subsequent strict-contact inspection also refuted the planned lower-to-support attachment: that candidate edge has a 0.415-inch transverse gap and only 2.672 inches of longitudinal overlap, so it fails the existing closure test. The two upper-to-support edges pass. The lower move shown in the footage may be an independent placement before the blue turn connects the modules. Resolve that geometry/connection contract from fitting footage and exact catalog closure before implementing a lower attachment or changing source geometry. A broad edge-finder result cannot supply this evidence. The numbered implementation proposal below is retained for review history, not authorization to invent that join.

## Goal and evidence

Continue from the component-pickup increment into the actual medium construction transition: prepare both four-piece wedges, construct the five-square support, place the upper wedge on that support, move the lower wedge beside it, then attach the blue turn. The existing 37-piece geometry is a candidate and still fails source shape and passive turning. A passing construction sequence does not promote those gates.

The inspected 51.5/52.5/53.5/54.5-second Henry frames show this transfer order. The upper wedge already exists at 50 seconds; its exact preparation grips/order are not shown. Those inspected frames are construction evidence, never fresh heldout fidelity evidence. The source hash and PNG hashes are in `runs/diagnostics/2026-09-27-medium-upper-inspection.json`.

The zero-offset support experiment failed because the support's front side reached the lower wedge before an earned join. Static inspection confirms the candidate's final graph contains one lower-to-support join and two upper-to-support joins. These are three separate cross-component joins, not permission to activate all of them during the first transfer. The lower-to-support join must stay absent until the lower wedge actually arrives.

In-memory preparation of lower, upper and support passed on all three seeds before the final shared magnetic-separation guard. The stricter rerun is ongoing; use its result as the prerequisite, not the older pass. The preparation proposal places the upper wedge at horizontal offset (-9,0,6) and the support at (0,0,6), retaining all 13 panels in the latest world. These workspace positions are proposed handling choices. Subsequent placements must move bodies continuously; no jump back to source coordinates.

## Engineering loop and boundary

Use the full engineering loop for new runtime contracts, lineage/state handling and source instructions. Get an alternative-model plan review before implementation and adversarial code review before publishing. Use the documented GPT-5.5 substitute while Claude subscription review is unavailable, sequentially under the user's tool map. Finish and commit the preceding component-pickup increment before changing runtime hashes again. Keep PR #4 draft; no production promotion.

## Explicit contracts

1. Separate a prepared module's identity from its latest workspace. Add optional `transfer.afterStageId`; when absent, preserve the existing small-ramp dependency on `preparedStageId`. When present, select that exact latest workspace with `selectWorkspace`, requiring lineage for the prepared module and every declared installed stage. Never merge saved physical states. Reject stale owners, mismatched seeds, incomplete lineage or divergent histories.
2. Permit multiple `installedStageIds` only for a single prepared-transfer operation. Their nonoverlapping tile sets plus the moving module must exactly cover the selected workspace and the transfer stage. The moving IDs must exactly match the independently prepared source module. No omitted obstacles, additional parts, duplicate ownership or inferred partitions. A subsequent ordinary cumulative stage can depend on the single completed transfer stage as before.
3. Add a bounded horizontal `constructionOffset` to a construction plan for target placement in the ongoing workspace. It changes only the nominal assembly target and never rewrites inherited EngineState or source observation geometry. Reject it together with `workspace.offset`; validate finite x/y/z, abs(x/z) <= 12 and y === 0. Use (0,0,6) for the medium transfers and following turn insertion, so the installed support never teleports. Default zero preserves current small behavior. Floor rebasing must preserve the complete floor-relative physical state exactly.
4. Allow a prepared transfer to acquire its single pickup grip from a fully released workspace, or retain the existing validated one/two-hand moving-module grip. Use the existing hand-transition checks for accessibility, withdrawal, identity and at most two hands, then run an actual one-hand support trial before lift. Reject an implicit regrasp, hidden old hand or unsupported handoff. Only that panel becomes kinematic during motion. Evidence must distinguish acquired and retained grips; a newly acquired grip must not be described as retained.
5. Allow exactly declared independent obstacle components, including the lower wedge while the upper moves. The moving IDs must equal one complete component. `componentContacts` must prove all components' internal contacts, complete coverage, raw separation and no unearned magnetic contact before transfer. Keep every non-hand body dynamic throughout.

## Connections and component changes

- Initialize a transfer from the selected actual workspace's connections and complete EngineState, not the nominal target's fixed-to-fixed connections. The upper transfer must not introduce the candidate's future lower-to-support edge merely because both panels are present.
- Determine the exact desired cross joins from the nominal target involving the moving module. Preserve every existing internal/fixed connection. Build a target proposal using actual existing connections plus only those proposed cross joins. A target proposal is never physical state.
- The docking search uses the proposed post-join component partition. Compute that partition by merging only groups connected by the intended cross joins; retain all untouched groups exactly. This lets upper+support close while lower remains separate. A caller cannot supply arbitrary merged groups to evade independence checks.
- Preserve the existing actual separated checkpoint, continuous lift/rotation/translation, fingertip/solid sweeps and exact physical contact-arrival check. All desired joins remain absent from the live state until arrival earns their exact directed and physical edge identities. Extra, missing, duplicated, broken or already-attached cross joins fail.
- After earned arrival, append only the earned authored joins and commit only the corresponding component merge. Require connected stabilization and free release under that partition; every untouched component remains present/dynamic. The upper transfer ends with two groups; the subsequent lower transfer earns its own join and ends with one 13-panel group.
- Keep whole-stage policies and matching seed lineage. Failure in any phase or seed creates no prepared successor; no successful seed can be mixed with another policy or an earlier failed branch.

## Source candidate integration

Bind the previously inspected construction frames through the existing source extraction/manifest/ledger process, preserving their inspection history. Do not alter scored pixels, fitting/holdout roles or source dimensions. Add separate proposed upper-preparation, upper-transfer and lower-transfer stages around the existing support and turn stages. Keep existing measured-stage IDs and geometry stable. Detailed hand choices and workspace offsets must be labeled proposals.

Reuse the physically checked lower-wedge sequence for upper preparation with its actual catalog orientation; keep all 37 tile identities, shapes, poses in the source model, inventory and source connections unchanged. Publish a new stage only after the complete inherited-state sequence passes all three seeds. Do not replace the observed prepared-upper move with four individual insertions onto the support.

After both transfers, insert the blue turn as one ordinary panel in the same ongoing world. Earn its named source contacts and check handoff/free release. If a proposed grip, release or contact fails, retain the failure and diagnose the minimal cause; do not alter the source target or loosen a limit to manufacture a pass.

## Required proof

- Generic three-component fixture: build all modules independently in one workspace, move one from the latest state, earn its exact joins to only one neighbor, freely release with the untouched component retained, then join the remaining component. Assert body identities, actual poses, velocities, local hinge frames, joint/break history, floor-relative state and seed continuity at every phase.
- Exercise released-to-one-hand acquisition and retained small-ramp transfer. Check actual body types, independent obstacle poses and complete playback coverage. Compare first/last phase frames to actual predecessor/terminal state.
- Reject stale prepared-state selection after a later workspace owns the same parts; missing required stage history; multiple independent states disguised as one; extra/omitted/duplicate parts; malformed/both offsets; changed floor-relative states; incomplete moving component; fabricated merged partitions; pre-attached future joins; extra/missing arrival contacts; blocked grips; failed support/release; mixed policy/seed states. Include a nonmoving/nonmoving future join in a target and prove it remains absent until its own earned transfer.
- All source stages through the blue turn must pass the complete sequence on seeds 0/17/53 before any new source assembly claim. Preserve all rejected attempts. Source fidelity and passive car behavior stay separately visible.
- Update UI verification for the additional checkpoints using stable stage identity/title, retaining model downloads, correct part labels, actual assembly playback, failed/unverified later stages and mobile layout. Visually inspect the upper transfer, lower transfer and turn release.
- Full tests, type checking, lint, final source/fixture regeneration, artifact integrity, production build, browser verification and exact-head preview checks before publishing the increment. Resolve accepted adversarial review findings and record evidence.

## Not completion

This milestone still leaves canopy construction, source shape, measured materials, passive turning, jet reconstruction, large-ramp work and the missing 3D snail source. Keep the full goal active and continue into those requirements.

## Review corrections required before implementation

1. Apply the same explicit construction target offset in clearance preflight and execution, without changing observation poses or inherited state. Add a counterexample that distinguishes offset-aware planning from the old unoffset result.
2. Expose independently falsifiable preparation, upper transfer, lower placement/transfer and blue-turn stages. Preserve measured stage identities, but never award the blue-turn assembly claim from a successful earlier subset.
3. Derive component partitions from actual groups and intended/earned cross joins through one explicit helper. Docking's target closure uses the proposed post-join partition. Handoff and live pre-arrival motion use the original independent groups while cross joins remain absent. Only earned arrival may commit the corresponding merge for connected stabilization and free release. Untouched groups never merge implicitly.
4. Replace the invalid lower-to-support attachment assumption with a reviewed, footage-grounded contact/placement contract. A diagnostic of strict closure across all source candidates should precede further reliance on their auto-proposed connection lists. The upper transfer's two closed contacts remain a viable next physical subtask, with the lower wedge retained as an independent obstacle.
