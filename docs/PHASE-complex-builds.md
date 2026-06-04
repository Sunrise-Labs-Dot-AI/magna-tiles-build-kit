# Phase: Complex Builds — Plan & Continuation Handoff

Durable handoff so work continues across compaction/fresh sessions. Claude orchestrates; Codex
(codex:codex-rescue agent) does the heavy lifting; Claude is the visual/resemblance gate.

---
## ⮕ RESUME HERE (current state @ commit bc682e4)

**Library = 8 builds, all engine-valid (gateBuild passes; ramps also roll), clean & recognizable:**
small/medium/large car ramp, jet, house, rocket, castle, dog. `npm test` = 153 pass / 1 skip, GREEN.
Tree is clean & committed. Builds live in `build-drafts/*.json`, replayed by guided mode at `/`.

**🚫 BLOCKER — Codex plugin is broken.** The codex@openai-codex plugin (v1.0.4) errors on a
`gpt-image-2` entry in its tool manifest; every `codex:codex-rescue` dispatch fails before doing
real work. Until James updates/fixes the plugin, the "offload to Codex" loop is unavailable.
Verify it's fixed by running a trivial codex:codex-rescue task before relying on it again.

**In-flight goal (Phase 2 below): complexity ramp-up with non-90° joins.** Two things were attempted
and are NOT done:
1. **Angled-join flushness — DEFERRED (do NOT re-grind).** The rocket nose-cone apex isn't perfectly
   flush (cosmetic; James: "pretty good"). Multiple miter-offset attempts in
   `lib/magnetic-tiles/edge-attachment.ts` converged but oscillated (0.156 penetration → 0.066 gap
   acute → 0.045 penetration obtuse) and never cleanly hit the strict ≤0.03/≤0.02 threshold across
   all fold angles in the discrete convex-hull prism model; one attempt also broke a test file. ALL
   that churn was discarded back to last-green (68c3a05). DECISION: accept the minor apex bug; the
   builds all pass gateBuild (≤0.03) and James deemed it fine. Do NOT spend more cycles on the
   synthetic flushness test. If a real future build (not a synthetic angle test) shows a visibly bad
   angled join, revisit then with that build as the anchor. The 0.03 hairline gate is unchanged/sacred.
2. **SNAIL build — NOT started.** First complex target. Reference frames in
   `public/reference-frames/snail/` (faceted ~circular SHELL = radial fan of triangles with angled
   rim folds, + square BODY/foot, + raised HEAD with antennae). Needs a radial-fan/disc macro +
   arbitraryFold for the rim. Must pass gateBuild (stands) + read as a snail. Do the join fix FIRST.

**NEXT ACTIONS when Codex is back (in order):** (a) redo the angled-join flushness fix + test;
(b) build the snail; (c) more complex builds (dinosaurs from official 2D BOMs in
`docs/research/magnatiles-reference.md`; more as James supplies YouTube URLs).

**Tooling gotcha:** `render:draft` gets flaky from repeated runs (zombie `next` servers pile up on
its fixed port 3211). Before rendering: `pkill -f "next start"; pkill -f "next-server"`. If it still
times out, render via a one-off playwright script on a fresh port (proven workaround — see the dog:
spawn `next start -p 3212`, playwright click the build's library-card title, screenshot `.canvas-wrap`).
Also run `npm run build` first so `next start` serves current code. Dev server for review:
`npm run dev` → http://localhost:3000 (currently NOT running; restart for review).
---


## Where things stand
- **4 builds done** to the "clean & sound" bar, all gate-valid (stand; ramps roll): small / medium /
  large car ramp, jet aircraft. Stored in `build-drafts/*.json`, replayed by guided mode (`/`).
- **Foundation (photo-true):** tile geometry centralized in `lib/magnetic-tiles/catalog.ts` — right
  triangle 45-45-90 (legs 76.2, hyp 107.76), isosceles base 76.2 / equal side ~143, small square
  76.2, large & XL square 152.4. Magnet model = **2 magnets per edge near corners**
  (`lib/magnetic-tiles/magnets.ts`), rendered in the viewer.
- **Physics engine = the gate** (`lib/engine`): `gateBuild` = raw no-overlap + valid magnet joins
  (pre-filter) → `simulate().stands` → `rollTest()` for ramps. Calibrated + proven to REJECT the
  iter-13 build, a thin tower, and an unsupported-center-seam span. NEVER weaken it.
- **Macro library** (`lib/magnetic-tiles/macros.ts`): primitives for every tile type; join/fold
  helpers with edge-class rules (SHORT 76.2 / HYP 107.76 / LONG 152.4, like-to-like only);
  composites (box, openBox, cube, triangularPrism, rampSegment, steppedRiser, triangleTent,
  wedgePrism, wallGrid, guardRail); ports (`attachByPort`); `mirrorMacro`. Contract-tested.
- 141 tests green. Dev server: `npm run dev` → http://localhost:3000.
- **Sandbox limits:** Codex CANNOT run git or `render:draft`. Claude commits every step and renders.

## Decisions (James)
- **Bar = clean & sound, recognizable** builds — NOT faithful copies of elaborate YouTube refs.
- **Cadence = autonomous** — Claude drives, surfaces only genuine forks.

## Immediate fix — large car ramp
The rear wall sits IN the roll path, blocking the ball/car. Redesign so the wall is the HIGH-END
support BEHIND the top of the ramp and the deck slopes DOWN to OPEN ground (clear, unobstructed
descent). Keep large-square panels (sound, no seam) + gate pass.
- Also a `rollTest` fidelity gap: it passed a wall-obstructed ramp. Improve `rollTest` to require a
  CLEAR descent path (ball travels the full slope to open ground, nothing blocking in front) without
  breaking calibration (small/medium ramps still pass). Secondary, but do it so the gate stays honest.

## Next: complex builds (autonomous loop)
Target set, ordered by tractability — each composed from macros, gate-valid (stands; functional ones
roll), clean, recognizable (Claude render-review), rendered. Add new primitives just-in-time
(roof, fin, nose-cone), each contract-tested.
1. **House** — box body + gable triangle roof + door opening.
2. **Rocket** — vertical stacked body + nose cone (triangles) + fins.
3. **Castle** — box keep + corner towers + battlement triangles.
4. **Animal** (stretch) — dog or dinosaur (organic; hardest).
- Optional parallel track: official **2D builds** (dinosaur / butterfly / dog) — exact BOMs from
  `docs/research/magnatiles-reference.md`, flat, low physics risk, good for library + prompt coverage.

## Per-build loop protocol
1. Dispatch Codex (background): compose from macros, pass `gateBuild`, keep suite green, never weaken
   gates, commit-or-list-files. FENCE file scope to that build's draft (+ macros if adding a
   primitive). Run ONE build-authoring agent at a time when it touches shared files (macros/tests) —
   parallel agents on the same files collide.
2. Watcher (git-status stable ~80s) → Claude verifies green + gate, commits, renders
   (`npm run render:draft -- <id>`), reads final-iso/side/front.
3. Claude reviews resemblance: clean+recognizable → accept, add to
   `verification/engine-valid-builds.ts`, move on; else one crisp correction, repeat.
4. Surface only genuine forks to James.

## Guardrails
- Photos + physics are ground truth. NEVER weaken engine / gateBuild / validateBuild / constants /
  0.03 hairline to make something pass — fix the BUILD.
- Claude commits each step (sandbox blocks Codex git); Claude renders (sandbox blocks Codex render).
- Keep calibration negatives green: iter-13 rejected, thin tower tips, unsupported-span rejected.

## Key commands
- `npm test` / `npm run lint` / `npm run build`
- `npm run render:draft -- <build-id>` (Claude only; dev server must be free / port 3000)
- gate check: vite-node a tiny script calling `gateBuild(draftToBuildGraph(draft))`

## Open / optional
- Medium ramp raised landing has a minor see-through gap (cosmetic).
- Prompt→build (north star): once the library is richer, map a prompt → nearest library
  build/template (roadmap Phase 2). Not started.

## Phase 2: Complexity ramp-up (current)
Goal (James): ramp up build complexity using real source material (YouTube / official cards),
including NON-90-degree joins.
- **Angled-join flushness bug (fix first):** the rocket nose-cone apex join isn't flush (red
  triangles meeting at the apex show a gap; real magnets would sit flush). Same class of issue
  affects any faceted/angled build, so fix the fold/half-thickness/attach math so non-90 joins seat
  flush. Foundational for everything below. Touches macros.ts / edge-attachment.ts.
- **Source material on hand:** snail sample video → frames extracted to
  `public/reference-frames/snail/` (faceted round shell + square body/foot + raised head with
  antennae — heavy angled joins). Official MAGNA-TILES build cards (dinosaurs/butterfly/etc.,
  exact BOMs) are fetchable via the URLs in `docs/research/magnatiles-reference.md`.
- **First complex target: SNAIL** — needs a radial fan / faceted-disc macro for the shell (ring
  of triangles around a center, angled rim folds to approximate a circle) + body squares + angled
  head/antennae. Must pass gateBuild (stands) and read as a snail. Likely several iterations.
- **Then:** dinosaurs (official 2D BOMs), and more as James supplies source (YouTube URLs welcome).
- **Tooling note:** `render:draft` got flaky (zombie `next` servers on its fixed port 3211 from
  repeated runs). Fix it (kill the server's process group / use a free port) OR render via a direct
  one-off playwright script (proven workaround). Claude renders; Codex is sandbox-blocked from it.
