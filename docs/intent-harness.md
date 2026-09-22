# Intent-driven construction harness

## Goal and boundary

The target for this iteration is 20 parameterized structural briefs across towers, open containers, through tunnels, and staircases, plus five briefs that must be rejected. This is a constructive grammar with independent acceptance checks—not a claim that every arbitrary sentence, every physically possible structure, or every piece budget can be solved.

The fixed corpus is `lib/harness/benchmark.ts`. Run `npm run benchmark:harness`. The command exits nonzero if any expected outcome fails and checkpoints the complete evidence in `verification/harness-benchmark.json`: interpreted contract, chosen construction program, tile geometry, instructions, release measurements, stage verdicts, and a content fingerprint. Failed cases stay in the corpus.

The three-level / 30-piece tower is a finite-inventory case. Other constructive cases use unlimited inventory, including larger staircases that would otherwise exceed the Classic 100 set. Rejections cover contradictory height limits and unsupported functional features. Adversarial unit tests separately exercise finite versus unlimited limits, missing panels, misleading metadata, malformed contracts, time exhaustion, and unusable passages.

## Architecture

1. `contract.ts` extracts complete supported clauses into a typed contract. Exact dimensions, lower/upper bounds, cell counts, floors for requested levels, and piece caps are explicit. Unknown clauses remain unresolved; unsupported details cannot silently disappear.
2. `compile.ts` constructs catalog tiles from a parameterized program. No tile is stretched. Programs vary dimensions, diaphragms, real six-inch panels, support bases, and assembly grouping. Every connection is rebuilt from actual edge geometry after edits.
3. `measure.ts` independently measures geometry. It ignores the program, saved bounds, title, role labels, and caller-supplied pass flags. It checks envelopes, roofs, wall coverage, floors, open containers, tunnel passages, and ascending stair treads.
4. `evaluate.ts` runs input/inventory checks, overlap and magnetic-connection validation, nominal gravity release, three additional deterministic release perturbations, settled-shape intent checks, and every completed assembly prefix.
5. `solve.ts` uses failed evidence to queue repairs. It never edits the contract to make a candidate pass. Unspecified footprint dimensions may grow; explicit cell counts and inch limits remain acceptance requirements.
6. `assembly.ts` can move release points to tested stable prefixes, starting with the ground-contact floor. Instructions explicitly say to hold a group until all of its pieces are joined. This is not evidence that each individual join is stable unattended.

The acceptance function also accepts externally authored tile graphs. New generators can call the same evaluator; they do not need to be trusted or use the built-in construction programs.

Each additional release uses a 0.28-inch drop, bounded initial linear/angular velocity perturbations (±0.03 in/s and ±0.015 rad/s), and up to 900 steps at 120 Hz. Corner displacement is sampled every four steps and at the end; the allowed maximum is 0.95 inches. Broken joints fail a trial. This is a specific tested release envelope, not a sweep over friction, loads, or material properties.

## Meaning of the contract

- A nominal cell is three inches. Its layout is checked on the undeformed catalog construction; literal inch limits and functional features are rechecked after settling. A discrete tile count is not treated as a second sub-inch deformation limit.
- Towers are closed, upright shells taller than both footprint dimensions. A request for levels/stories additionally requires intermediate floors.
- Containers have a continuous floor, four walls, an open top, and a clear cavity.
- Tunnels have side walls, a roof, a continuous passage floor, and two open ends. The default clear passage is **2 × 2 inches**; it may be elevated on a braced support base. Requested nominal width/length describe the outer layout, not clearance. These assumptions appear in the returned contract. An agent can specify larger `passage.width` / `passage.height`; the evaluator checks those actual dimensions. Unsupported requests such as a ground-level entrance are not silently reinterpreted.
- Staircases require the requested count of ascending, approximately three-inch risers, with tread coverage sampled across their depth. Unspecified tread run may grow for support.

Coverage is sampled at no more than 0.5-inch intervals, with a 0.03-inch contact/seam tolerance. The tolerance matches existing prism contact handling; it does not excuse a missing panel. Stair transitions permit the 0.36-inch joint seam created by adjoining closed tile bays. The cavity obstruction check conservatively uses tile AABBs, so a rotated but actually clear tile can cause a false rejection. This is a known limitation, not a proof of exact solid clearance.

## Unlimited pieces

The Design Lab checkbox passes `unlimitedPieces: true` through the UI, API, solver, inventory evidence, and engine gate. It disables **both** selected-set inventory limits and prompt-specified piece caps. Turning it off restores both checks. Unlimited does not disable overlap, intent, connection, release, or assembly checks.

Compute budgets are separate and visible: currently 250 tiles and 1,500 connections per evaluated candidate, bounded search attempts, and a four-minute request analysis deadline. The constructible cell dimensions are 1–8. A compute limit yields `budget-exhausted`, never “infeasible” or “solved.” There is no claim of infinite compute; large unverified candidates must not be represented as successful builds.

## API

```sh
# Build from a supported brief
curl -X POST http://localhost:3000/api/solve-build \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a tunnel 2 tiles wide and 4 tiles long","unlimitedPieces":true}'

# The same endpoint also accepts {"contract": <IntentContract>}.
# Independently evaluate any proposal:
# POST /api/evaluate-build {"contract": <IntentContract>, "build": <BuildGraph>}
```

`/api/design-build` integrates this structural harness into the existing 3D viewer, numbered joins, inventory display, and JSON export. Racecourses still use the earlier experimental course planner.

Outcomes are `solved`, `unsupported`, `infeasible` (directly contradictory bounds only), `search-exhausted`, or `budget-exhausted`. Search exhaustion is not proof that the request is physically impossible. Incomplete physics trials cannot pass. `evaluate-build` returns HTTP 503 with `budget-exhausted` if its deadline expires.

The routes use Node.js, a 300-second Vercel function duration, and a shorter internal deadline to leave response time. Deployments need Fluid Compute or an equivalent duration allowance; see [Vercel's duration configuration](https://vercel.com/docs/functions/configuring-functions/duration). No API key or paid model call is needed for this bounded planner. Unauthenticated CPU-intensive endpoints should be rate-limited before inviting public use.

## Evidence and remaining work

The fingerprint binds the complete contract, model version, and tile graph. Process-local caches are bounded, content-addressed, and return copies; they cannot substitute a stored user `passed` flag for validation. Editing geometry or the contract invalidates the relevant evidence. Stage-only edits may reuse identical full-structure release results but must pass the new assembly prefixes.

This is simulation evidence, **not a real-world guarantee**. Magnet force/torque, friction, tile mass, hinge behavior, and load capacity remain uncalibrated. Three release seeds are not exhaustive reliability testing. Human hand access, manipulation inside a held group, and assembly under car loads are not modeled. Geometry coverage is sampled rather than proven over all points.

Remaining milestones: physical calibration fixtures; explicit vehicle/passenger clearance and load contracts; richer constructive grammars; a continuous turning-course generator with passive car contact; and measured multiview video reconstruction. A requested zigzag or video reconstruction is not fixed by making the structural benchmark pass.
