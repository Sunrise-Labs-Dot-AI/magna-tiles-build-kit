# Design Lab: verifiable course planning

## Contract

`POST /api/design-build` accepts `{ "prompt": "a downhill racecourse for two side by side cars", "inventoryPreset": "classic-100" }`. `builder-xl` is also supported. The response contains the interpreted brief, a candidate BuildGraph, instructions, lane waypoints, check results, recorded car trajectories, candidate search results, and model assumptions.

`simulation-passed` requires every implemented check to pass. `needs-repair` retains useful geometry and explains failures. This label must not be translated into “physically proven” or “real-world verified.”

The grammar is deliberately bounded. It extracts lane count, turn count, and downhill intent, and flags tokens outside its vocabulary. Vocabulary coverage is not a general semantic proof. Additional requirements need explicit parsers and checks before they can be treated as supported.

## Pipeline

1. Parse an explicit brief, including the assumed vehicle (2.5 × 1.1 inches, 40 g, 0.22-inch wheel radius).
2. Generate a reproducible set of candidates. The straight course uses the authored large rigid ramp. Turning courses currently vary the existing switchback tower height and guard rails, with a duplicated assembly for two lanes.
3. Reject invalid inventory, overlaps, impossible joins, and structural failures.
4. Sample every lane segment at no more than 0.08-inch intervals against the actual convex tile faces. Check width, turns, descent, and lane separation.
5. Only after prerequisites pass, release both car proxies together under gravity. Four revolute axle joints per chassis constrain wheels without motors. Ordered checkpoints measure success, without applying forces. Export the sampled chassis centers used by replay.
6. Check cumulative assembly groups in chronological order. Unsupported groups remain unverified rather than receiving a false pass.

The selected result is the candidate with the most passing checks minus failed checks. The first candidate passing all prerequisite checks ends the bounded search. Assembly checks can downgrade that result. This is a small deterministic search, not a general constraint solver or an optimization guarantee.

## Physics scope

Catalog coordinates are inches. Gravity is `9.81 / 0.0254` inches/s²; mass is kilograms. Tile colliders include thickness. Connected tile pairs retain collision response. A displacement check evaluates corners as well as centers. Headless worlds are disposed after each test.

The existing magnetic model creates ideal revolute constraints. Its break rule derives from separation and separation rate, not a measured constraint impulse or a full magnetic field model. Existing hold, stiffness, and damping constants are fixture-tuned assumptions. Correcting gravity does not turn them into calibrated SI measurements.

The old gate's ball roll test remains a straight-ramp regression check. It cannot certify a zigzag. The planner's ordered routes and car proxies add functional evidence, but also have limits: spherical wheels, no rolling-resistance calibration, no perturbation sweep, and no guaranteed real-world wall-guided turns.

References: [Rapier joint documentation](https://rapier.rs/docs/user_guides/javascript/joints/) describes available motion constraints; [the Classic 100 product](https://magnatiles.com/products/magna-tiles-classic-100-piece-set) provides manufacturer inventory context. Neither validates this app's physical coefficients.

## Assembly and replay

Piece labels P1…Pn map to the stable order in `build.tiles`; edge labels are one-based versions of the catalog edge indices. Instructions enumerate actual graph joins. The sprint's assembly sequence builds the supported slope, adds the launch box, then adds the rear wall. Checking only the final model previously missed unstable intermediate groups.

Replay renders recorded car centers, not scripted travel along a route. Lane lines show desired checkpoints. Tile movement is not currently replayed. The export includes assumptions and failures alongside geometry so a failed candidate is not mistaken for a certified plan.

## Acceptance cases

- A nominal two-car sprint passes structure, surface, width, lane, car, inventory, and cumulative assembly checks.
- The requested zigzag remains rejected until all its turns and actual car motion work.
- Missing road tiles fail the surface check even when a route line is present.
- Oversized cars fail surface clearance.
- Reversed uphill checkpoints do not attract or propel vehicles.
- Unrecognized requirements such as a loop prevent a full pass.
- Rotating a tile at a fixed center is detected as displacement.
- Malformed geometry fails before entering WASM; distant or locked loose tiles do not snap.

## Next implementation gate

Implement one continuous two-turn lane with physically supported transition surfaces and passive walls. Require no raw intersections, matched road edges, a monotonic route with the requested turns, unattended stability at every completed assembly group, and car completion without motors or steering. Then duplicate lanes, check cross-lane contacts, and sweep release offsets and car parameters. Physical fixture measurements are required before claiming real buildability.
