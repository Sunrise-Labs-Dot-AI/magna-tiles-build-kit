# M0 Baseline

Captured on 2026-05-25 PDT from the running Next app with `npm run verify:builds`.

## Command Baseline

- `npm install`: pass, already up to date.
- `npm test`: pass, 4 files / 60 tests.
- `npm run build`: pass.
- `npm run lint`: fail before changes because `next lint` is no longer a valid Next 16 lint command in this project; it was interpreted as the path `/Users/jamesheath/Documents/New project/lint`.

## Screenshot Evidence

- Contact sheet: [contact-sheet.md](contact-sheet.md)
- Jet Aircraft: [final-default.png](jet-aircraft/final-default.png), [final-side.png](jet-aircraft/final-side.png), [final-high.png](jet-aircraft/final-high.png)
- Small Car Ramp: [final-default.png](small-car-ramp/final-default.png), [final-side.png](small-car-ramp/final-side.png), [final-high.png](small-car-ramp/final-high.png)
- Medium Car Ramp: [final-default.png](medium-car-ramp/final-default.png), [final-side.png](medium-car-ramp/final-side.png), [final-high.png](medium-car-ramp/final-high.png)
- Large Car Ramp: [final-default.png](large-car-ramp/final-default.png), [final-side.png](large-car-ramp/final-side.png), [final-high.png](large-car-ramp/final-high.png)

## Visual Findings

- Jet Aircraft: not acceptable yet. It has aircraft-like wings, but the body reads as a blocky house/rocket-castle mass rather than a clean jet fuselage. The lead is confirmed: `JET_AIRCRAFT_RECIPE` is imported in `lib/magnetic-tiles/templates.ts`, but `compiledRecipeFor()` returns `null` for `profile.family === "aircraft"`, so the reviewed recipe is discarded.
- Small Car Ramp: wrong. The screenshot shows a pile of steep folded panels with a vertical spike, not a continuous climbable car ramp.
- Medium Car Ramp: wrong. The screenshot shows a vertical wall/bridge-like structure with teeth and a protruding plank, not a monotonic inclined driving surface.
- Large Car Ramp: wrong. The screenshot shows a tall wall with flat floor panels, not a large climbable ramp.

## Structural Acceptance Baseline

`runReferenceAcceptance()` currently returns `gapCount 0` for all four cases. This is a false green: the visual baseline proves at least the three ramp builds are wrong. M1 must strengthen structural assertions so visibly wrong builds fail deterministically.

## Repository Notes

This folder does not contain a `.git` directory, so milestone commits cannot be created from this checkout until Git is initialized or the correct repository root is provided.
