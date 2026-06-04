# Magna-Tiles Build Kit

A web app and toolchain that explores a hard question: given a reference (a YouTube build video or a build spec) of a magnetic-tile construction, can you programmatically produce a build that is both **physically valid** (it would actually stand and hold together as real Magna-Tiles) and **recognizable** (it reads as the thing it is supposed to be), and then guide a person through building it?

Stack: Next.js 16, React 19, TypeScript, Three.js + react-three-fiber, and Rapier physics.

> **Status: archived research exploration.** This is a completed exploration being put down as a public archive, not a maintained product. It works as a build-and-verification kit, but it does **not** faithfully reproduce the source video build. The honest reasons are written up below and in [research/diagnosis.md](research/diagnosis.md). See [STATUS.md](STATUS.md) for the full what-works / what-doesn't / what's-next.

## What it does

- **Free build / library:** a Three.js viewer renders a library of authored builds (ramps, house, castle, dog, snail, rocket, jet) tile by tile, with step-by-step instructions and remaining-tile counts.
- **Guided build:** a reference encoder turns a YouTube build video (or a local file) into a reviewable, timestamped sequence of assembly actions. An optional model pass drafts a first timeline from selected frames; without a key it falls back to a deterministic heuristic.
- **The gate:** an un-gameable physics gate that decides whether a build is real. A build only passes if it clears every check (see below). Overlap is made impossible by construction in the tile-attach system, not merely flagged after the fact.
- **The recognition layer:** a scorer that measures whether a build is recognizable, combining a structural score with a geometric, multi-view silhouette IoU against a target shape. A parametric generator plus a hill-climb optimizer searches the tile-placement space toward a higher score.
- **Video to 3D:** a reconstruction pipeline (`scripts/reconstruct-jet.ts` + `lib/recognition/jet-reference-model.ts`) and an interactive viewer ([public/jet-model.html](public/jet-model.html)) that renders the reconstructed jet target from multiple angles.
- **Vision critic:** a harness that renders a build and asks a vision model whether the render structurally matches a reference photo, returning actionable differences.

### The gate (what "physically valid" means here)

A build passes `gateBuild` ([lib/engine/gate.ts](lib/engine/gate.ts)) only if it clears all of:

1. **No-overlap pre-filter** at a 0.03 hairline tolerance. The tolerance admits face-to-face contact and float noise, never real overlap, and is never widened to make a build pass.
2. **Magnetic-join validity:** every connection is a real edge-to-edge magnetic joint with adequate support; no floating or illegally-attached tiles.
3. **Rapier stand test:** the build is simulated and must stand (bounded displacement, no popped joints).
4. **Roll test (ramps only):** a test object must roll to the bottom of a functional ramp without falling off.

The gate validates physics and connectivity. It deliberately does **not** certify visual resemblance, which is left to the recognition layer and human signoff.

## How to run

```bash
npm install        # install dependencies
npm run dev        # start the Next.js app at http://localhost:3000
npm test           # run the Vitest suite
npm run lint       # run ESLint
npm run build      # production build
```

Scripts and generators (run with `tsx`):

```bash
npm run verify:builds          # gate every authored build and report pass/fail
npm run render:draft -- <id>   # render a build's step + final views to verification/<id>/
npm run judge:all              # run the vision critic across builds (needs OPENAI_API_KEY)
npm run judge:build -- <id>    # vision-judge a single build

tsx scripts/reconstruct-jet.ts        # build the jet reconstruction target
tsx scripts/generate-jet.ts           # parametric generator + hill-climb optimizer
tsx scripts/vision-critic.ts          # render-and-critique loop
```

### Optional model drafting

The reference encoder can draft a first-pass timeline with a model when `OPENAI_API_KEY` is set. Copy `.env.example` to `.env.local`, set the key, and restart `npm run dev`. Without a key, the app falls back to a deterministic heuristic draft. The vision critic and live visual judge also require the key; they fail closed (report "unavailable") when it is absent.

## Architecture

| Area | Path | Role |
|---|---|---|
| Physics gate | [lib/engine/](lib/engine) | No-overlap pre-filter, magnetic-join validity, Rapier stand + roll tests (`gate.ts`, `overlap.ts`, `simulate.ts`, `rapier-world.ts`). |
| Tiles + assembly | [lib/magnetic-tiles/](lib/magnetic-tiles) | Tile catalog/geometry, the macro + edge-attachment system that makes overlap impossible by construction, recipe compiler, instructions. |
| Builder | [lib/builder/](lib/builder) | Build drafts, storage, library operations. |
| Recognition | [lib/recognition/](lib/recognition) | Recognizability scorer (`score.ts`), multi-view silhouette IoU (`silhouette.ts`), the jet video reconstruction target (`jet-reference-model.ts`), pixel critic. |
| Reference encoder | [lib/reference-encoder/](lib/reference-encoder) | Encodes a reference video/spec into reviewable assembly actions; frame sampling, model options, acceptance. |
| Verification | [lib/verification/](lib/verification) | The vision-model visual judge. |
| Scripts | [scripts/](scripts) | Generators, the video reconstruction, renderers, the vision critic, tile measurement. |
| Authored builds | [build-drafts/](build-drafts) | The library of authored builds as JSON. |
| App | [app/](app) | The Next.js UI, API routes, and the [jet-model.html](public/jet-model.html) viewer. |
| Renders | [verification/](verification) | Our own generated step/final renders of each build (not third-party content). |

## Status, in brief

**Works:** the physics gate (un-gameable by construction), the tile macro/attach system, overlap impossible by construction, the recognizability scorer (structural + multi-view silhouette IoU), the parametric generator and hill-climb optimizer, the video-to-3D reconstruction and interactive viewer, the vision-critic harness, and a library of ~9 builds. The jet was taken from a box-with-fins to a gate-valid, recognizable wide-delta-wing jet via a "coplanar lateral extension" fold, which was the research report's key finding.

**Doesn't work / key limitation:** the output does **not** faithfully match the source video build. Root cause: the reconstruction **target** was hand-authored by a model eyeballing video frames, not measured, so the whole pipeline optimizes toward an approximation. No measured video signal ever enters the loop. The post-mortem in [research/diagnosis.md](research/diagnosis.md) traces this stage by stage.

**What's next:** replace the eyeballed target with a real reconstruction (COLMAP / DUSt3R-MASt3R) or human-encoded ground truth; add a real search/constraint solver (MCTS / CP-SAT) instead of transcribed guesses; add a learned/perceptual scorer (CLIP/VLM) measured against the real frames; consider a part-grammar prior. Details in [research/magna_tiles_system_design.md](research/magna_tiles_system_design.md) and [research/diagnosis.md](research/diagnosis.md).

The full version is in [STATUS.md](STATUS.md).

## Research and design documents

This was a literature-grounded exploration. The thinking is preserved in:

- [research/magna_tiles_system_design.md](research/magna_tiles_system_design.md) — the literature-grounded, from-scratch system design.
- [research/review-and-implementation.md](research/review-and-implementation.md) — an adversarial review of that design with implementation notes.
- [research/diagnosis.md](research/diagnosis.md) — an honest post-mortem on why the output stayed far from the video.
- [docs/research/system-design/](docs/research/system-design) — five design memos (search assembler, hierarchical planner, voxel target fitting, parametric optimizer, multi-agent vision loop) plus a build plan.
- [docs/jet-rebuild-target.md](docs/jet-rebuild-target.md) — the jet target derived from the source video.
- [docs/build-loop.md](docs/build-loop.md) — the vision + debug + system-improvement build loop.
- [docs/engine-design.md](docs/engine-design.md) and the other `docs/` memos — engine and reference-encoder design notes.

## Attribution

The reference build videos belong to their creators. The primary jet reference is **"Magna-Tiles Idea: Jet Aircraft"** by **JD's Curious Company** on YouTube; the project also referenced that channel's car-ramps and snail build videos. Frames were extracted **only for research** (to study the build and as a comparison target) and are **not redistributed** in this repository. The extracted stills and the source videos have been removed from this public archive. Please support the original creators by watching their videos.

What this repo **does** include is our own work: the generated renders under [verification/](verification), the interactive [jet-model.html](public/jet-model.html) viewer, and our own physical-tile measurement photos under [docs/research/](docs/research). Magna-Tiles and Magnatiles are trademarks of their respective owner; this project is an independent, non-commercial exploration and is not affiliated with or endorsed by them.

## License

[MIT](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for the "archived exploration" note.
