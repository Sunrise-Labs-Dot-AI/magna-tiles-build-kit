# Reference Encoder Redesign Notes

## Jet Aircraft Findings

- The first 10 seconds are a finished-product preview, not assembly. The encoder should classify this as a target-pose reference and skip it for build-step generation.
- The 00:11 frame is a bill of materials: 16 squares, 5 isosceles triangles, 9 equilateral triangles, and 10 right triangles. This should be pinned as authoritative inventory evidence.
- Text overlays carry high-value procedural constraints, especially the body balance check, wing alignment, hidden tail-camera note, and horizontal-before-vertical tail ordering.
- The builder repeatedly makes subassemblies off to the side, then attaches them as groups. A better encoder must model group creation and group attachment separately.
- Several important operations consume no new pieces: adjusting the body until it stands, aligning wing magnets, and rotating the finished aircraft for inspection.
- Some geometry is only visible in final inspection frames. The encoder needs to use final views to reconcile the target pose after extracting the timeline.

## Better Encoder Shape

The next encoder should be a multi-pass pipeline:

1. **Landmark pass:** classify intro/product preview, bill-of-materials frames, text overlays, final showcase frames, and low-quality/occluded spans.
2. **Inventory pass:** parse BOM text or marked frames before doing per-step estimates.
3. **Operation pass:** segment the video into typed operations: build subassembly, attach group, adjust magnets, brace, rotate/show final pose, and balance check.
4. **Subassembly tracker:** assign persistent IDs to body, nose, left wing, right wing, tail, and top fin; track group transforms and dependencies.
5. **Physical pass:** mark manipulation-only steps, hidden contact edges, support changes, balance checks, and ordering constraints.
6. **Human review UI:** show frame evidence beside each draft step, with overlay text and confidence flags visible before the user accepts it.

## Schema Implications

- A reference encoding needs an overall `billOfMaterials`, not only per-step counts.
- Each step needs `evidence`: timestamps, overlay text, and visual cues.
- Each step needs `dependsOn` so the instructions know which subassemblies exist.
- Each step needs `physicalNotes` for magnet seating, stability, hidden contacts, and manipulation-only moves.
- The model should draft a structured explanation of uncertainty, especially where the camera angle is poor.

## Car Ramp Findings

- Some videos are collections, not single builds. The car ramp video contains three independent builds: small, medium, and large.
- Segment boundaries are visible from title/BOM cards and from table resets. The encoder should detect these before step generation.
- Each segment has its own bill of materials:
  - Small ramp: 5 classic squares, 2 right triangles, 2 isosceles triangles.
  - Medium ramp: 18 equilateral triangles, 15 classic squares, 4 isosceles triangles.
  - Large ramp: 42 classic squares, 6 equilateral triangles, 3 XL squares.
- The large ramp introduces `XL square`, which is outside the current Classic-100-compatible catalog. The encoder needs an additional-materials path and should flag unsupported pieces.
- Construction strategy changes by size:
  - Small: triangular wedge plus small top/side support.
  - Medium: square rear support plus sloped face plus triangle bracing.
  - Large: grid wall, box platform, XL square ramp plane, triangle side markers.
- A better review UI should show a chapter list before a step list, because the user may want to accept/reject or split segments independently.

## Multi-Build Pipeline Upgrade

1. **Collection detection:** classify the source as single-build or multi-build.
2. **Segment proposal:** create candidate segments from title cards, table resets, and final-showcase frames.
3. **Per-segment BOM extraction:** attach each BOM to the correct segment and prevent counts from leaking across builds.
4. **Per-segment operation extraction:** draft steps inside each segment only.
5. **Catalog compatibility check:** flag materials that do not map to the current shape catalog.
6. **Review UI:** show segment tabs/cards, each with its own frames, BOM, draft steps, and validation status.
