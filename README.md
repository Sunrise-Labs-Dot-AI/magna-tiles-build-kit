# Magna-Tiles Build Kit

A workbench for turning magnetic-tile ideas into inspectable 3D assemblies, testing them, and producing instructions. Next.js 16, React 19, TypeScript, Three.js, and Rapier.

**Status: active experiment.** The `/design` lab now uses intent contracts, independent measurements, and evidence-guided repairs for towers, open containers, tunnels, and staircases. It includes an unlimited-pieces setting and an inspectable multi-family benchmark. The earlier two-car downhill sprint also works in simulation; turning courses remain unsolved. Arbitrary prompt generation, reliable video reconstruction, and real-world physics calibration remain open problems. A passing simulation is not proof that a real build works.

## Try it

```bash
npm ci
npm run dev
```

Open [http://localhost:3000/design](http://localhost:3000/design) and try:

- `an open top box 2 tiles wide`: an independently measured and repaired structural build.
- `a tunnel 2 tiles wide and 4 tiles long`: a braced tunnel with an explicit clear-passage contract; enable Unlimited pieces.
- `a tower with 3 levels and at most 30 pieces`: a finite-budget build with actual floors.
- `a staircase with 5 steps`: a larger constructive case; enable Unlimited pieces and allow several minutes for testing.
- `a downhill racecourse for two side by side cars`: the working baseline.
- `a zigzagging downhill racecourse for two side by side cars`: six candidates are evaluated and the closest is shown with explicit failures.

The Design Lab shows the pieces, dimensions, interpreted requirements, route checks, recorded car motion, and assembly steps. Turn on piece and edge labels to follow the joins. Export downloads the model, instructions, assumptions, and all check results as JSON. No model key is needed for this bounded planner.

The existing build library is at `/`; the manual workbench is at `/builder`.

For structural requests, review the interpreted contract and assumptions, inspect the repair trace, and follow the completed assembly groups. Unlimited pieces disables selected-set limits and prompt piece caps, not physics or compute safeguards. See [the harness specification](docs/intent-harness.md) for semantics, API tools, budgets, and reproducible evidence.

## What is actually checked

1. Input geometry and inventory limits.
2. Raw tile intersections and magnetic connection geometry.
3. A Rapier structure test using inch-scale gravity, with displacement measured at tile corners as well as centers.
4. Continuous driving surfaces, car width, lane count, separation, descent, and requested turns.
5. Simultaneous unpowered four-wheel car proxies following free dynamics. Waypoints judge progress; they do not steer the cars.
6. Each completed assembly step standing on its own.

Unsupported prompt terms are surfaced as unverified requirements. Failed or unverified checks prevent a candidate from receiving “Simulation passed.” The legacy generated-build endpoint and selected library builds now also return live physics verdicts instead of relying on stored labels.

The magnetic model still uses ideal hinge constraints with a separation-based break heuristic. Magnet strength, friction, mass distribution, and car behavior have not been measured against physical hardware. See [docs/design-lab.md](docs/design-lab.md) for the exact scope and next work.

## Development

```bash
npm test
npm run benchmark:harness
npm run lint
npm run build
npm run verify:builds
```

| Area | Path |
|---|---|
| Intent contracts, catalog compiler, independent evaluation, repair search | `lib/harness/` |
| Agent-facing solve/evaluate APIs | `app/api/solve-build/`, `app/api/evaluate-build/` |
| Candidate planning, route checks, car tests, instructions | `lib/planner/` |
| Design Lab UI and endpoint | `app/design/`, `app/api/design-build/` |
| Physics gate and rigid-body model | `lib/engine/` |
| Tile catalog, geometry, attachment, macros | `lib/magnetic-tiles/` |
| Manual editor and authored drafts | `lib/builder/`, `app/builder/`, `build-drafts/` |
| Reference video encoder | `lib/reference-encoder/` |
| Recognition and visual judging | `lib/recognition/`, `lib/verification/` |

The optional reference timeline drafting and vision critic require `OPENAI_API_KEY`; see `.env.example`. They do not provide measured 3D reconstruction. The original jet target was estimated from video frames, which is why matching that target did not reproduce the real build.

## Research history

The initial public release was an archived exploration. Its useful research remains in [research/diagnosis.md](research/diagnosis.md), [research/magna_tiles_system_design.md](research/magna_tiles_system_design.md), and [docs/research/system-design/](docs/research/system-design). Earlier descriptions of an “un-gameable” gate or physically proven builds overstated the evidence. [STATUS.md](STATUS.md) describes the current boundary.

## Attribution and license

Reference videos belong to their creators. The primary jet reference is **“Magna-Tiles Idea: Jet Aircraft” by JD’s Curious Company** on YouTube; the project also studied that channel’s ramp and snail builds. Extracted frames and source videos are not redistributed here. Generated renders and original tile measurement photos are included.

Magna-Tiles and Magnatiles are trademarks of their respective owner. This independent project is not affiliated with or endorsed by them. [MIT license](LICENSE).
