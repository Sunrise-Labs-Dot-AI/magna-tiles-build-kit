# Account for observed interchangeable source panels

The plan passed independent review. Integration into the active validator waits until the frozen numerical qualification is complete. An isolated prototype under scripts/reference and pure accounting tests may be prepared meanwhile; neither is imported by the active validator or included in its frozen input graph. No native simulation may run alongside timed qualification. This increment removes an unnecessary serial-identity requirement from piece accounting; it does not accept source poses or a replica by relabeling counts.

## Concrete evidence and current failure

The reviewed fitting sequence in `diagnostics/2026-09-27-small-source-set-proposal.json` establishes the complete installed five-panel wedge at 27 seconds and four-panel launch at 32.5 seconds. Same-shape/color side panels cannot be uniquely tracked to the candidate's arbitrary negative/positive side IDs. The current schema supports only exact source-part-to-candidate mappings, so it incorrectly makes those unobservable serial identities a prerequisite for complete installed-set accounting. Candidate pose, join and image checks are separate and remain required.

## Representation and validation

Extend the source-piece ledger with observed interchangeable sets. Each set has a stable sourceSetId, a single catalog shape, a positive exact observed count and an explicit list of candidate tileIds. The set means the complete listed set was observed installed, with member identity permutations unresolved. It never assigns a specific source member to a candidate side. The enclosing record retains the existing source/frame hashes, fitting/construction partition, timestamp, stage, reviewed basis and observation lock.

Require exact count equality with distinct candidate IDs of the declared shape. Require every member to exist in the bound stage. A candidate ID can belong to only one source identity or set across the replica; exact mappings and interchangeable sets may not overlap. A stable sourceSetId must retain the same shape, count and complete candidate membership across all records. This first increment does not support splitting a set across stages: a stage that lacks the complete set must use a separate partial accounting claim, without reusing or reassigning member identities. Reject conflicting, malformed or duplicate records rather than finding a convenient matching permutation.

For complete installed-set coverage, the disjoint union of exact observed mappings and complete observed sets must equal the stage tileIds exactly. Inferred/proposed mappings and minimum-visible counts cannot fill a missing member or upgrade coverage. Results explicitly distinguish exact observed tile IDs from observed-set members; include the unresolved sets in report data and copy. Preserve all existing source-byte verification and fail/unverified distinctions. Do not change image landmarks or pose/connection acceptance to consume these sets; a later source-geometry constraint system must resolve or quantify its own pose ambiguity.

Use a versioned ledger representation with explicit validation and an unambiguous migration of existing records. Existing exact records retain their meaning. Ensure malformed set fields cannot be silently ignored as schema1 data. The source ledger is locked and any migration must archive the prior ledger/lock and record why it changed using the existing provenance mechanism.

## Small-ramp adoption

Use only the previously reviewed fitting/construction frames and counts. Keep the exact rear/deck/launch-square mappings from the reviewed proposal. Replace the two proposed yellow-side serial mappings with one observed two-member isosceles set, and the two proposed green-side serial mappings with one observed two-member right-triangle set. Describe these as installed sets, never calibrated poses or uniquely tracked panels. Bind the completed launch source checkpoint to the existing 32.5-second frame; retain the 31-second image as transition/instruction evidence. Any construction contract that references frame31 keeps its explicit transition semantics. Preserve the nine-panel build geometry, inventory, connections, physical parameters, stage support and construction operations exactly.

The final nine-panel source record remains partial until its own complete installed set is supported. Do not infer it by adding two earlier modules or by subtracting the BOM. No new or historical holdout is reclassified. Source fidelity, settled shape, material calibration, assembly and function verdicts do not become passes from this accounting change.

## Verification and delivery

Add targeted tests covering a complete observed set, exact-only compatibility, missing/extra member, duplicate within/across sets, overlap with exact/inferred/proposed identities, changed shape/count/membership across stages, unknown members, partial stage subsets, malformed schema fields, wrong source/frame/partition/hash and unverified local source. Demonstrate that a complete piece set still cannot grant fidelity or replica acceptance. Use the existing tests for source accounting and bindings; do not rerun expensive physics merely to prove an unchanged geometry label.

Independently review the implementation and concrete source records, verify the replica build payload and construction operations are byte-identical to the frozen pre-increment values, then regenerate affected reports with current provenance before publishing. Any broader final qualification required by validator identity must be run honestly; historical outputs cannot be restamped. Keep this increment separate from a hinge-model change.
