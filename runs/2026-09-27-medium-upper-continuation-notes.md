# Next medium-ramp transition: investigation notes

These are unapproved implementation options, not new source or acceptance claims. Complete the current hand-transition increment before changing its validation hash again.

## Local inspection

`runs/diagnostics/2026-09-27-medium-upper-inspection.json` records original-video identity and extracted PNG hashes for 51.5, 52.5, 53.5 and 54.5 seconds. All four were inspected during this increment; none is independent heldout evidence. The upper wedge already exists at 51.5, is placed onto the green support at 52.5, and the lower wedge is moved beside it at 53.5. The blue turn is attached at 54.5. Exact grips and earlier upper-wedge construction are not established. Existing 50-second construction footage already includes the upper wedge beside the support construction.

Before publishing new stage claims, create explicit reviewed extraction/ledger bindings and preserve the observed preparation/transfer order. Do not substitute four direct upper-panel insertions onto the support for the demonstrated prepared-module transfer, or label an unmeasured preparation pose as observed.

## Current representation limits

- `preparedStageId` identifies both the module's construction and the predecessor workspace. An upper module prepared before the support cannot reuse that stale workspace after the support is built: the latest state correctly owns all those parts.
- The evaluator permits only one installed source stage. A transfer involving separately prepared lower and support modules needs their common latest workspace, never a merge of independent saved states.
- Prepared transfer currently requires two previous module hands, one retained hand and exactly two components. The next scene contains lower wedge, support and upper wedge. A released upper module would need a checked acquisition before lift; the existing ordinary transition helper supplies only accessibility, and a one-hand physical support trial remains required.
- After the upper wedge joins the support, the lower wedge is still separate until the blue turn is added. Contact and closure checks need an explicit, earned merge of only the joined component groups, retaining other groups as dynamic obstacles. Requiring the entire world to connect at this intermediate point would be wrong; accepting arbitrary disconnected parts would also be wrong.
- The current support workspace is displaced by six inches in Z. Before transferring into the source pose, either verify a placement nearer the eventual support footprint or model the later relocation explicitly. No teleport from workspace coordinates to a nominal source stage is acceptable.
- Ordinary pickup and controlled lowering currently pass every placed ID as the moving prefix. Preparing a lifted upper wedge beside released modules needs motion restricted to its declared component while all other components remain dynamic obstacles. Do not classify those unrelated parts as carried or remove them from the world. Test their full state continuity and unchanged expected resting poses during the new module's lift.

## Bounded next options to review

Test a zero-offset support workspace in memory with the current exact grips and all previous parts present. Separately plan an explicitly framed upper preparation stage, followed by support construction and an upper-module transfer from the latest shared workspace. A transfer option may need a distinct latest-workspace stage reference in addition to the prepared module's identity. Require exact part coverage, matching seed, lineage of every prerequisite, latest ownership, unchanged predecessor EngineState and no mixed-policy states.

Generalize multiple independent obstacle groups only with negative tests for missing groups, fabricated merges, stale branches, pre-attached cross joins, lost obstacle bodies and hidden hands. Retain the exact intended upper-to-support contact set and earn those joins from the recorded arrival before adding the turn. Every new physical operation must pass all three seeds without changing source parts or tolerances. Get alternative-model plan review before implementing this representation change.
