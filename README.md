# Magna-Tiles Build Kit v2

A web app where magnetic tiles are a first-class creative medium. Three pillars, one
physics engine, zero LLM geometry:

1. **Plan from a prompt** (`/plan`) — type "a castle with two towers and a red roof" and
   get a physically-verified build plan: a 3D step-through, a tile shopping list checked
   against a Classic-100 set, and printable instructions. Every plan passes the real
   engine gate (no overlaps, valid magnetic joins, a Rapier stand test, a roll test for
   ramps). If no template variant passes, you get an honest failure instead of a wobbly
   guess.
2. **Import from YouTube** (home page → Import video) — paste a Magna-Tiles build video
   URL. The pipeline downloads it locally (yt-dlp + ffmpeg), splits it into motion vs
   stable spans by deterministic frame differencing, and turns each settled placement
   into a timeline step with measured evidence: a representative frame, a
   background-subtracted silhouette mask, and an explainable confidence score. Steps
   below the confidence bar are flagged for human review — the system never silently
   guesses. An accepted reconstruction must pass the engine gate before the app calls it
   buildable.
3. **Build virtually** (`/builder`) — a Minecraft-like building experience. Pick a tile
   shape from the hotbar (keys 1–6), click the ground to lay the first tile, hover a
   magnet dot to see a live ghost preview, cycle fold angles with Q/E, flip with R,
   change attach edge with T, click to snap. Undo/redo, shake test, roll-a-ball physics
   sandbox, save/load, and the build library as starting points. Construction is
   edge-to-edge magnetic attachment only, so overlapping tiles are impossible by
   construction.

Stack: Next.js 16, React 19, TypeScript, Three.js + react-three-fiber, Rapier physics,
yt-dlp + ffmpeg for ingestion, pngjs for pixel work. No native-build dependencies.

## Lineage and the v1 post-mortem

This is the second attempt at the idea. The first
([archived here](https://github.com/Sunrise-Labs-Dot-AI/magna-tiles-build-kit)) built a
genuinely solid physics gate, tile-attachment system, and recognizability scorer, but
failed at its headline goal — faithfully reproducing a build from a video — for reasons
its own post-mortem ([research/diagnosis.md](research/diagnosis.md)) states bluntly: an
LLM eyeballed the 3D target instead of measuring it, and no measured signal from the
video ever entered the loop.

v2 keeps the engine and applies the post-mortem as law ([VISION.md](VISION.md)):

- **The gate is law.** `gateBuild` ([lib/engine/gate.ts](lib/engine/gate.ts)) decides
  what is real. Its tolerances are never widened to make a build pass.
- **No LLM geometry.** Models never type coordinates, judge renders, or act as solvers.
  Deterministic code does geometry. The only optional LLM use is mapping free text to
  discrete template parameters (key-gated, with a deterministic fallback) — the test
  suite passes with no key present.
- **Measured signal or honest failure.** Video ingestion computes real silhouettes from
  real frames; low-confidence steps are flagged, not guessed. Prompts that can't produce
  a gate-valid build return a structured failure, listing per-attempt gate reasons.

What v2 deliberately does *not* claim: automatic 3D reconstruction of a build from
video. Mapping measured timeline steps to attach actions is human-driven by design —
automating it without SfM-grade measurement would recross the v1 line. The measured
evidence (steps, frames, silhouettes, confidences) makes that human review fast and
honest instead of blind.

## How to run

```bash
npm install        # install dependencies
npm run dev        # start the app at http://localhost:3000
npm test           # run the Vitest suite (247 tests)
npm run lint       # ESLint
npm run build      # production build
```

Video ingestion needs `yt-dlp` and `ffmpeg` on the PATH (`brew install yt-dlp ffmpeg`).
Downloads land in the gitignored `.video-cache/` and are never committed.

```bash
npm run ingest:video -- <youtube-url>   # run the ingestion pipeline manually
npm run verify:builds                   # gate every authored build and report pass/fail
```

## Architecture

| Area | Path | Role |
|---|---|---|
| Physics gate | [lib/engine/](lib/engine) | No-overlap pre-filter, magnetic-join validity, Rapier stand + roll tests. |
| Tiles + assembly | [lib/magnetic-tiles/](lib/magnetic-tiles) | Tile catalog/geometry, edge-attachment (overlap impossible by construction), templates, the gated generator (`generate.ts`), prompt understanding (`prompt.ts`), instructions. |
| Interactive builder | [lib/builder/](lib/builder), [app/builder/](app/builder) | The pure placement engine (`placement.ts`: fold cycling, ghost derivation, confirm) and the play-mode UI. |
| Plan page | [app/plan/](app/plan) | Prompt → gated plan, shopping list, print stylesheet, workbench handoff. |
| Video ingestion | [lib/reference-encoder/](lib/reference-encoder) | yt-dlp/ffmpeg ingestion (`ingest.ts`), deterministic segmentation + silhouettes (`segmentation.ts`), timeline → build gating (`reconstruction.ts`), review UI (`app/components/ReferenceEncoder.tsx`). |
| Authored builds | [build-drafts/](build-drafts) | The library of authored builds as JSON. |
| Tests | [tests/](tests) | 247 tests: engine calibration, the 27-prompt gate corpus, segmentation on synthetic frames, placement state machine, reconstruction gating. |

## Attribution

Reference build videos belong to their creators. The development fixture is
**"Magna-Tiles Idea: Jet Aircraft"** by **JD's Curious Company** on YouTube. Video
downloads and extracted frames stay in the local gitignored cache and are not
redistributed. Please support the original creators by watching their videos.
Magna-Tiles and Magnatiles are trademarks of their respective owner; this project is an
independent, non-commercial exploration and is not affiliated with or endorsed by them.

## License

[MIT](LICENSE).
