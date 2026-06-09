# Dimension Change Plan

## Source of truth

Tile dimensions live in `lib/magnetic-tiles/catalog.ts`. Change dimensions there first; do not edit `TILE_SPECS` shape entries directly.

- `SMALL_EDGE = 3`
- `LARGE_EDGE = SMALL_EDGE * 2`
- `RIGHT_TRIANGLE_LEG = SMALL_EDGE`
- `RIGHT_TRIANGLE_HYPOTENUSE = SMALL_EDGE * Math.sqrt(2)`
- `ISOSCELES_BASE = SMALL_EDGE`
- `ISOSCELES_EQUAL_SIDE = LARGE_EDGE`
- `ISOSCELES_HEIGHT = Math.sqrt(ISOSCELES_EQUAL_SIDE ** 2 - (ISOSCELES_BASE / 2) ** 2)`
- `EQUILATERAL_HEIGHT = Math.sqrt(SMALL_EDGE ** 2 - (SMALL_EDGE / 2) ** 2)`
- `XL_SQUARE_EDGE = SMALL_EDGE * 4`
- `TILE_THICKNESS = 0.18`

`lib/engine/constants.ts` re-exports `TILE_THICKNESS` from the catalog so the engine keeps its existing public import path while using the same source of truth.

## Absolute draft positions

Every `build-drafts/*.json` file stores absolute `tiles[].position` and `tiles[].basis` values computed under the current geometry. A dimension change requires regeneration or manual re-authoring plus the normal review gates:

- `build-drafts/small-car-ramp.json`: currently `status: "engine-valid"`. A dimension change likely invalidates stored ramp positions and it must be re-authored or regenerated and re-gated.
- `build-drafts/medium-car-ramp.json`: currently `status: "engine-valid"`. A dimension change likely invalidates stored ramp positions and it must be re-authored or regenerated and re-gated.
- `build-drafts/large-car-ramp.json`: currently `status: "engine-fail-pending-reauthoring"`. It is already not accepted, but its stored positions are still geometry-specific.
- `build-drafts/jet-aircraft.json`: currently `status: "engine-fail-pending-reauthoring"`. It is already not accepted, but its stored positions are still geometry-specific.

Do not assume an engine-valid draft remains valid after a dimension change just because the compiler and tests pass. Run the engine gate and roll test again, then update visual signoff separately.

NOTE: The isosceles triangle needs a cleaner re-measure before its geometry can be corrected.

## Recomputes automatically

These paths now derive geometry from the catalog constants and should not need manual edits after a dimension change:

- `TILE_SPECS` dimensions and local vertices.
- `lib/magnetic-tiles/magnet-geometry.ts` magnet counts per edge.
- `lib/magnetic-tiles/prism-geometry.ts` and `lib/magnetic-tiles/edge-attachment.ts` tile thickness handling.
- `lib/magnetic-tiles/macros.ts` wedge, landing, wall, box, guard-rail, and switchback macro geometry.
- `lib/magnetic-tiles/recipes/*.ts` recipe root positions and edge offsets that are dimension-derived.
- `lib/builder/operations.ts` duplicate offsets, snap search radius, and bounds thickness.
- `lib/magnetic-tiles/validation.ts` collision boxes and grid-derived attachment thresholds.
- `lib/reference-encoder/reference-acceptance.ts` large-edge wording and minimum climbable ramp height.

`lib/magnetic-tiles/templates.ts` uses constants for shared thickness and active small-ramp macro placement. The legacy freeform fallback templates still include authored coordinates under the current 3-inch grid; see silent-break risks below.

## Test impact

Re-baseline these after a real dimension change because they exercise generated geometry, bounds, engine stability, or geometry-derived text:

- `tests/engine-calibration.test.ts`
- `tests/engine-gate.test.ts`
- `tests/no-overlap.test.ts`
- `tests/macros.test.ts`
- `tests/magnetic-tiles.test.ts`
- `tests/builder.test.ts`
- `tests/prompt-set.test.ts`
- `tests/reference-acceptance.test.ts`
- `tests/reference-draft.test.ts`

Likely geometry-independent unless their fixtures are regenerated:

- `tests/reference-encoder.test.ts`
- `tests/visual-judge-calibration.test.ts`

Always run `npm test`, `npm run lint`, and `npm run build` after any dimension change. For accepted drafts, also run the draft engine gate and roll test, because the stored JSON positions are outside the automatic recompute path.

## Silent-break risks

- Legacy freeform template coordinates in `lib/magnetic-tiles/templates.ts` remain intentionally authored under the current grid. Values such as `1.5`, `3`, `4.5`, `6`, `7.5`, `11.1`, `12.8`, `4.1`, `6.7`, and similar offsets mix grid placement with visual composition. They were not safely centralized because replacing them mechanically would imply a proportional layout model that the code does not actually define. If these fallback templates need to survive a dimension change, re-author them as macros or recipe-driven builds.
- `lib/reference-encoder/examples/*` and `lib/reference-encoder/draft.ts` contain piece counts and source-observation text with numeric values. Those are evidence data, counts, or copied overlay text, not canonical dimensions.
- Magnet placement assumes one magnet slot per `SMALL_EDGE` of edge length via `Math.round(length / SMALL_EDGE)`. Changing `SMALL_EDGE` without measured magnet spacing can silently change magnet counts on large and XL edges.
- `XL_SQUARE_EDGE = SMALL_EDGE * 4` is still an unverified Builder XL assumption. Treat it as a guessed catalog value until measured.
- Several engine constants are calibrated against current dimensions, mass, and friction. Even when they are not dimension constants, changing geometry may require recalibrating `TILE_MASS_KG`, magnetic hold force, displacement thresholds, and roll-test margins.
