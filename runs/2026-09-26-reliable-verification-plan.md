# Reliable verified builds: continued implementation

User direction: keep building the harness until it reliably creates verified builds. PR #4 is a checkpoint, not completion. Full engineering loop is required because this changes physics, generation and acceptance behavior.

## Intended outcome

A candidate can earn simulation verification from evidence rather than being permanently hardcoded unverified. Source fidelity, release physics, assembly, material calibration and car behavior remain separate. No physical validation claim without physical measurements. First close a complete small-ramp lane; then generalize the verified primitives to medium turning courses and the other source targets. Never substitute easier targets for the requested builds.

## Implementation sequence

1. Diagnose persistent motion in minimal source-derived supports and compare numerical solver settings, finite-thickness contacts, joint geometry, and sleeping. Correct numerical/modeling bugs only with a failing minimal regression. Do not add angular motors, rigid clamps, damping or support tiles to force source candidates to pass. Record experiments and retain collapse rejection tests.
2. Add evidence-backed assembly validation: explicit held parts, at most two hand contacts, per-part insertion paths checked for collision, closure operations and release checkpoints. Derive instructions from the validated sequence. A source-held module need not stand unsupported but cannot conceal an arbitrarily supported entire model.
3. Fit the small-ramp geometry using newly designated fitting/construction observations, preserving rigid catalog tiles and verified BOM. Keep the previously inspected holdout diagnostic, reserve new useful views before tuning, and lock the new evidence with explicit provenance. Broaden camera fitting only if synthetic and measured fixtures expose a solver issue.
4. Replace permanently unverified fidelity/assembly logic with explicit coverage and evidence requirements. Coverage must include every part through visible source measurements or construction constraints; at least two distinct final withheld views, silhouette/edge constraints, and fixed-camera post-release comparisons are required. Incomplete evidence must remain unverified, contradictory evidence fail. Replayed/duplicate views and weak constraints cannot manufacture coverage.
5. Generalize bounded candidate search/repair around those checks without using held-out errors in optimization. Demonstrate repeated successful independent runs on an accepted source lane before claiming reliability. Continue to medium passive turning with source geometry and measured or explicitly assumed vehicle dimensions.

## Acceptance and verification

- Existing 248 tests, structural 25/25 benchmark and collapse/unsupported negatives stay passing.
- New tests demonstrate meaningful failure before each correction and verify the same constraint independently afterward.
- Reliability means repeated release perturbations, completed validated assembly and passive car variations where applicable, not a single nominal simulation.
- Report exact counts and residuals. Strict verification fails if any required target remains unresolved. Never lower projection, overlap, displacement, rest or vehicle contact thresholds to pass.
- Source media stays local and hashed. Existing source partitions are historical; explicitly label previously inspected measurements and keep fresh holdouts outside fitting.
- Code, reports, instructions and UI stay synchronized. Refresh generated artifact hashes after validator changes. Review and push updates to PR #4, watch CI; do not merge or deploy production.

## Immediate bounded increment

Begin with solver/contact diagnostics and a general assembly-path validator on the small ramp. Record actual evidence and advance remaining phases across goal continuations; do not mark the goal complete at a diagnostic PR.

## Review-resolved contracts (before implementation)

The first independent review returned BLOCK with two critical and three warning findings. The following contracts resolve the ambiguity. Review substitute: Claude Opus attempted once, failed `OAuth session expired and could not be refreshed`; fresh GPT-5.5 high Codex CLI used instead.

### Verification promotion

Source simulation verification requires source identity, inventory, raw geometry, source fidelity, final release, fixed-camera settled shape, and complete assembly all PASS. Functional targets additionally require passive function PASS; static targets carry explicit functional applicability=false rather than treating any UNVERIFIED as success. Material calibration is a separate physically-validated status: simulation verification names the exact assumed parameter fingerprint and never implies physical verification. Unknown applicable checks prevent promotion, contradictions fail, and changing any acceptance input invalidates the result. A positive synthetic evidence fixture will prove the predicate is reachable before any real-source promotion is enabled.

### Holdout provenance

New observations will carry an evidence revision and role (historical diagnostic, construction, fit, reserved holdout), frame/video digest, stage, reservation timestamp and baseline candidate/fit-input digests. A sealed evaluation manifest will bind the final candidate before holdout scoring. Duplicate source frames, near-identical camera views, post-fit relabeling and known historically inspected frames cannot satisfy independent coverage. No code can prove a human never saw a frame; the evidence explicitly states that boundary. Existing observations remain historical, and may contradict a result, but cannot satisfy a fresh reliability claim.

### Assembly contract

An operation identifies already-present parts, exactly one added part or an independently validated subassembly, final rigid pose, a piecewise rigid insertion trajectory, attachment edges, and any held contact. Contacts identify a single existing tile and approach point/direction; at most two hand contacts including the inserted part, and no entire-model support flags. The simulator may temporarily fix the contacted tile for that held checkpoint, and every claimed release must remove all temporary supports. Contact access and insertion swept volumes are separately evaluated. A sweep PASS only means the supplied fixed-orientation translation is collision-free, never whole-assembly approval. Every piece and join must be accounted for; multi-piece groups require recursively validated operations. Unsupported closure, trapped parts, omitted parts and arbitrary hold-everything fail. Unsupported rotations or missing hand evidence remain UNVERIFIED rather than approximated as safe.

### Differential diagnosis and increment boundary

Current experiments compare the identical rigid geometry under independently varied contact skin, time step, solver iterations, and length units. A numerical correction needs a minimal closed support fixture reproducing motion while all material constants and target polygons remain fixed; a source candidate alone cannot establish a physics bug. Raw intersection rejection, free-hinge collapse and unsupported-span rejection must remain active. No changes to magnet torque, friction, damping or geometric tolerances are authorized by these experiments.

Increment 1 contains a minimal proven solver/contact correction if supported, continuous translational insertion checks with adversarial tests, and explicit small-ramp operation paths. **No source verification promotion is enabled in increment 1.** The goal remains active, and later increments must complete the above evidence and promotion contracts. The small ramp's visual contradiction cannot be cleared by the physics fix. Increment 1's exact acceptance is reduced numerical jitter in the same fixture, unchanged negative rejection, correctly detected blocked/trapped insertion paths, and reproducible per-part assembly-path evidence. Independent review, tests, artifact regeneration and preview checks are required before updating PR #4.
