# Call-site audit before finer contact integration

Read-only implementation preparation while the loaded-contact full regression suite runs. No runtime, fixture or test code changed. This elaborates the already reviewed finer-contact plan; it does not change its matrix or acceptance criteria.

## Native integration versus caller sampling

`lib/engine/rapier-world.ts` subdivides requested steps using `MAX_COLLISION_TIMESTEP_SECONDS`. Three assembly routines also explicitly sample at the old eight substeps per 120 Hz reporting interval:

- `lib/replication/support.ts`: local `substeps = 8`, loop duration, reporting-rest conversion, and swept fingertip checks.
- `lib/replication/seating.ts`: `SEATING_SUBSTEPS = 8`, release loop, elapsed seconds, rest conversion and motion sampling cadence.
- `lib/replication/held-motion.ts`: `dt = reporting/8`, post-carry duration `900*8`, rest conversion `/8`, sampled deformation, clearance and separation checkpoints.

If a finer profile qualifies, merely changing the engine's maximum step would leave those routines observing only the old outer endpoints. Their outer step and time/rest conversions must use the selected collision rate so intermediate rest, deformation and fingertip checks remain observed. Preserve physical seconds and 90 reporting rest steps. Keep motion recording cadence expressed in physical time, rather than accidentally changing its meaning through a larger raw step count. The continuous native solid guard remains mandatory at every integration step.

## Profile identity and matched controls

`vendor/rapier-contact/profile.json` contains the configured 120 Hz reporting ERP, native collision-step values, and explicit contact/collision frequencies. `lib/engine/backend-identity.ts` embeds the profile digest. A selected change must update these consistently, without rebuilding or modifying the unchanged native/WASM artifact. `PHYSICS_MODEL_VERSION` also names the old 960 rate; make the selected contact/collision values explicit and reject previous saved states. The default upstream numerical profile remains unchanged; only the selected application profile changes.

`tests/physics-backend.test.ts` and `tests/fixtures/unpatched-contact.ts` contain hard-coded contact frequency 120. The configured comparison must apply the selected values to both patched and upstream worlds. The separate static, locked corner-contact control uses default worlds and should retain that matched control setup.

Independent collision-rate loops in triangle, closed-loop and rigid-contact tests currently name 960/1920. If the selected maximum step becomes finer, those labels would describe reporting requests instead of independent native rates. Parameterize the current-profile refinement checks at its actual native rate and twice that rate. Preserve the original physical pass/fail criteria and archive historical results. Angular-alias rejection tests must express a complete hidden rotation relative to the selected collision step; kinematic interpolation checks must assert the full correctly subdivided trajectory and its physical endpoint, rather than the obsolete fixed count of eight samples.

## Historical experiment and configured-profile verification

The diagnostic runner deliberately requires one native step per labeled integration step. Once the runtime cap becomes finer than a historical row's requested rate, the engine will subdivide that request. Such a row must fail as mislabeled; do not remove the count check or call the subdivided result a coarse-rate reproduction.

Retain the original 216-cell experiments at their exact pre-promotion code checkpoint with their full inputs, failures and hashes. Reproduce them from that checkpoint. Under a promoted runtime, regenerate qualification for the **selected profile's rate pair**, both solver counts, all seeds and all six fixtures: 72 cells. That verifies the actual selected runtime plus its next finer rate under the final validator. It does not claim to rerun all the earlier coarse candidates. The reviewed plan already separates historical selection evidence from final configured-profile validation; preserve that boundary in production report generation and artifact checks.

## Generation budgets remain requirements

A selected finer runtime affects the structural planner as well as reconstruction. The prior five-step staircase took about 154 seconds against the unchanged four-minute budget. A doubled or quadrupled collision rate creates a concrete performance-regression concern; do not treat the existing 25/25 structural benchmark as proof under a changed runtime. Re-run all 20 constructive and five rejection outcomes before promotion, preserving the computation budget and Unlimited-pieces semantics. Record experiment wall time separately from simulated time. If performance fails, investigate and independently review an optimization that preserves the full collision proof; do not increase the budget or weaken the physics gate to obtain a passing result.
