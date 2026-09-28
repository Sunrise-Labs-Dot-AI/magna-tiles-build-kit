# Steady a receiving panel during prepared-module transfer

Next implementation increment after source-stage accounting and its frozen evidence are published. The current compact four-wall prefix builds both wedges and the support on all three seeds, but upper transfer fails at contact on seed 0 with the rear-deck grip and all seeds with a short-side grip. At the declared 52.5-second construction view, one hand holds the upper wedge while the other touches the green support. This motivates testing a receiving-panel grip; it does not establish the exact source grip, hidden support count or a successful proposed path.

## Bounded capability

Prepared transfer currently accepts exactly one moving-panel grip. The underlying held-motion machinery already distinguishes one pickup panel from an optional installed-panel support. Extend the prepared-transfer contract to permit exactly one moving-panel grip and optionally one grip on a panel of the intended receiving component. Every grip still holds only one physical panel. Do not add multiple moving-panel clamps, group freezing, extra fixtures or hidden supports.

Resolve the moving and receiving hands by component membership rather than array order. The receiver must be the component joined by the declared cross connections; a hand on an unrelated bystander must fail. Reject duplicate panels, more than two hands, two moving grips, absent panels and ambiguous receivers. Existing one-hand callers must preserve their behavior and outputs.

Derive exactly one `movingHand` whose tile is in `movingIds`, and optionally one `receiverHand` whose tile belongs to the neighbor group established by the declared cross connections. Reject every hand outside those roles. Use the derived moving identity for target alignment, waypoints, access checks, docking and held motion; never assume the incoming array's first hand is the mover. Test both input orders. For this increment, explicit receiving support means its grip appears in `operation.hands`; legacy one-hand callers contain no receiving grip and gain none implicitly.

Acquisition must happen on the actual released workspace, with both fingertips' paths checked against all existing bodies and the table. A held receiving panel stays at its actual acquired pose; it must not reset to its nominal model pose. Preserve every body's velocity, reference frame, joint frame, mode, failure history and independent-component membership. The handoff support trial must validate the actual two-panel hold before any lift. During carry, only the one moving panel follows the measured path; the receiver's one gripped panel is stationary and all other panels remain dynamic.

The current withheld-cross-connection rule remains unchanged. Carry must begin separated, move continuously, earn exactly the declared contacts at actual arrival and pass the component-contact audit. Keep the receiving grip through connected stabilization only as explicitly declared. Withdrawal and mandatory free checkpoints must restore every panel to dynamic behavior, retain only earned joints and establish sustained rest before publishing terminal evidence. No pass can survive a failed acquisition, intermediate support, collision, missed contact or failed release.

## Independent verification before source probes

Use an independently authored prepared-component fixture with one receiving support and an unrelated table component. Build all modules panel by panel before transfer. Exercise two accessible grips, record exactly two held panels during carry, prove every other body stays dynamic, and prove the bystander is neither held nor joined. Compare predecessor bodies, modes, velocities, local frames and joints across acquisition, carry, stabilization and release. The terminal world must retain all panels and exactly the earned cross connections on seeds 0/17/53.

Assert actual engine body modes, not only reported hand counts: exactly the moving gripped panel is kinematic and exactly the receiving gripped panel is fixed during carry. Connected stabilization holds exactly the two declared panels; the subsequent free checkpoint has no non-dynamic bodies. An accessible grip on a second panel of the moving component must still fail as two moving grips. This must not become a way to freeze the moving module under another role name.

Negative cases must include an inaccessible receiving grip, a grip on the unrelated component, third-hand acquisition, two moving grips, an altered retained grip, receiver-pose reset, stale state and failed/omitted free release. Keep the existing one-hand transfer and table-placement regressions. Test actual failure behavior and state continuity rather than only input-shape mirrors.

Then rerun the compact medium prefix from fresh individual panels with one explicit proposed receiver grip chosen from the declared green support. Retain earlier failed probes. A passing prefix may be published only as a bounded simulation hypothesis; source-stage accounting remains partial, and neither the old candidate's passes nor a new 13-panel pass can certify the full 37-piece topology. The closed six-face support and its separate table-contact failures remain unresolved and must not be bypassed or reclassified.

Any published compact-prefix pass must include `carry.heldTileIds.length === 2`, the specific receiving tile identity, the actual mode assertions above and complete terminal free-release evidence per seed. The existing release criteria remain unchanged.

## Frozen constraints and publication

No changes to contact gap/angle/overlap limits, collision/table tolerance, catalog dimensions, magnetic assumptions, solver settings, durations or rest requirements. No scored pixel, uncertainty, holdout role or independent-source credit changes. Hidden support faces and canopy correspondence require their own source evidence; count arithmetic and physical success cannot establish them.

Require independent adversarial review of the implementation and actual evidence. Run the applicable state/transfer/contact regressions and broader suite, regenerate fixtures and all source reports under one final validator hash, compare unaffected source results, build and inspect the workshop, and verify the exact-head draft preview. Do not merge or promote production. If the added receiving grip fails, preserve the failure and investigate the actual deformation/contact result before adding more capabilities.
