# Jet rebuild target — derived from the actual source video (durable)

Why this exists: the prior jet was faked 3D (tiles' stored `basis` was hand-edited while their
relational `foldAngle` stayed 0), so its geometry corresponds to no real fold → 7 overlaps,
disconnected tiles, and it tips in the stand sim. The fix is to rebuild it to MATCH the source
video, composed from overlap-free macros (geometry derived from real folds, never hand-typed).

Source video: `sample-videos/YTDown_YouTube_Magna-Tiles-Idea-Jet-Aircraft_Media_WDtC_9se3ds_001_1080p.mp4`
Per-step frames extracted to: `public/reference-frames/jet-aircraft/steps/` (01..13, named by stage).

## Structural model (what the video actually shows)
- **Fuselage = a horizontal SQUARE TUBE lying flat on the table.** 16 small squares = a 4-segment
  tube of 4 faces each (top/bottom/left/right). It rests on its flat bottom face → inherently
  STABLE. This is the key the prior build missed: the body is a box on its belly, not a tall tower.
- **Nose = a triangular pyramid / point** at the FRONT opening of the tube (blue triangles
  converging to a point, angled down-forward).
- **Wings = large triangular panels splayed WIDE and nearly flat** from the lower side faces of the
  tube (mirrored L/R). They reach out toward the table → a broad, low footprint = the second
  stability source. (right triangles; BOM has 10.)
- **Tail = upright triangular fins at the REAR**, sitting on top of the rear fuselage: a vertical
  fin plus the green "top fin" near the front. Horizontal tail attaches FIRST, vertical fin on top
  (per the 04:10 overlay tip). (equilateral + isosceles triangles.)
- Rests on: tube belly + wide wings (+ nose tip). Low CG, wide stance → stands without tricks.

## BOM (authoritative, from the 00:11 text card)
small-square 16, equilateral-triangle 9, right-triangle 10, isosceles-triangle 5, large-square 0.
16 small squares maps exactly to a 4×4 square tube — strong confirmation of the fuselage model.

## Build order (video step DAG → matches the reference encoding timestamps)
1. body square-tube column, build until it 2. stands by itself (00:22–01:04)
3. pointed nose on the front (01:18)
4. left wing module, 5. mirrored right wing, 6. align wings (02:02–03:05)
7. rear tail piece (03:50), 8. horizontal tail FIRST then vertical fin on top (04:10)
9. green top front fin (05:25), 10. final front/side/rear check (06:00–06:35)

## Rebuild approach (overlap-free by construction)
Compose from existing macros via `attachByPort` (geometry derived, never hand-typed):
- fuselage: `box`/`cube` tube, 4 segments long (square cross-section, small squares).
- nose: `squarePyramid` attached to the front face.
- wings: `mirroredPair` of right-triangle panels on the lower side faces, splayed wide+flat.
- tail: upright triangle fins on the rear top (horizontal then vertical).
Then: gate must pass (stands; overlap-free), and each stage render must match its frame.

## Verification loop (the vision piece that was missing)
For each stage N: render the build up to step N, compare to
`public/reference-frames/jet-aircraft/steps/<N>-*.jpg`. Claude looks + measures. A stage is done
only when the render reads like the frame AND gateBuild has zero raw overlaps at that stage.
