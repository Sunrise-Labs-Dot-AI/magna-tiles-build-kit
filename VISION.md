# Magna-Tiles Build Kit v2 — the vision

A web app where Magna-Tiles are a first-class creative medium. Three pillars:

**A. Prompt → buildable plan.** Type "a castle with two towers" and get a plan that is
physically real (passes the engine gate: no overlap, valid magnetic joints, stands under
Rapier simulation), renders in 3D step by step, and prints as instructions with a tile
shopping list against a Classic-100 inventory.

**B. YouTube build video → the same interface.** Paste a Magna-Tiles build video URL and
get a reviewable, step-by-step reconstruction of that build in the app: a timeline of
attach actions you can play, edit, and accept. The v1 post-mortem
(research/diagnosis.md) is law here: measured signal from the video must enter the loop
(real frame silhouettes / detection), never an LLM eyeballing geometry.

**C. Minecraft-like virtual building.** A delightful interactive 3D builder: pick a tile
from a hotbar, see a ghost preview snapped to a magnet edge, click to place, fold angles
on scroll, undo/redo, physics test mode, save and share builds. Construction is
edge-to-edge magnetic attachment only, so overlap stays impossible by construction.

## Engineering rules (carried from the v1 post-mortem)

1. **The gate is law.** `gateBuild` (lib/engine/gate.ts) decides what is real. Never
   widen its tolerances to make a build pass. Every build the app presents as "buildable"
   must pass it.
2. **No LLM geometry.** Language models never type coordinates, judge renders, or act as
   a solver. Deterministic code does geometry; search does optimization; models may only
   map free text to discrete template parameters (with a deterministic fallback) or draft
   reviewable part lists.
3. **Overlap impossible by construction.** All placement flows through the
   edge-attachment system (lib/magnetic-tiles/edge-attachment.ts).
4. **Honest failure.** When a pipeline can't meet its bar (gate fails after repair,
   reconstruction confidence too low), say so in the UI rather than shipping a guess.

## Pillar status & acceptance

- A: skeleton exists (prompt.ts → templates.ts → validation.ts → instructions.ts via
  /api/generate-build). Acceptance: a fixed corpus of ≥20 varied prompts all yield
  gate-valid builds (vitest), with honest failure paths; plan page shows 3D step-through,
  shopping list, printable instructions.
- B: reference-encoder exists (frame sampling, timeline drafting, acceptance flow).
  Acceptance: a real YouTube URL is fetched locally (yt-dlp + ffmpeg), frames are
  extracted, a draft timeline is produced with measured per-step evidence (frame
  silhouettes attached to steps), the user reviews/edits in the builder UI, and the
  accepted build passes the gate.
- C: a functional but workbench-flavored editor exists at /builder. Acceptance: hotbar +
  ghost-preview + click-to-place flow; fold-angle cycling; undo/redo/delete keys; physics
  test mode; save/load; playful polished aesthetic; all existing tests stay green.
