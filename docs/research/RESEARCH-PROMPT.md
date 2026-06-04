# Research Prompt — Magna-Tiles Physical & Construction Reference

Run this in Perplexity (or another sourced-research tool). Its job is to replace the **guessed**
physical facts in this codebase (piece dimensions, magnet model, `CLASSIC_100_INVENTORY`, the
"XL square" gap) with authoritative, sourced ground truth.

- **Target write point (absolute):** `/Users/jamesheath/Documents/New project/docs/research/magnatiles-reference.md`
  (overwrite if it exists). Write ONLY that file — do not modify any other file and do not run
  git; James reviews the diff and commits.
- **Downstream step (Codex, after results land):** reconcile the findings with the code —
  correct `lib/magnetic-tiles/catalog.ts` dimensions + `CLASSIC_100_INVENTORY`, feed real angles
  into `lib/magnetic-tiles/macros.ts`, and resolve the XL-square question explicitly.

---

## Prompt (paste verbatim)

```text
You are researching Magna-Tiles (and edge-compatible magnetic building tiles) to produce an
authoritative engineering reference for a software tool that reconstructs real Magna-Tiles builds
in 3D. Accuracy and sourcing matter more than completeness: cite a source for every factual claim,
and explicitly flag anything you cannot verify or where sources disagree. Do NOT guess dimensions —
if a spec isn't published, say so rather than inventing it.

OUTPUT TARGET: Save the final Markdown document to the absolute path
/Users/jamesheath/Documents/New project/docs/research/magnatiles-reference.md (overwrite if it
exists). Write ONLY that file — do not modify any other file and do not run git. Produce ONE
structured Markdown document with these sections:

1. PIECE CATALOG & GEOMETRY — For each standard shape (small square, large square if it exists,
   equilateral triangle, right triangle, isosceles triangle, plus any others in standard/Classic
   sets): exact edge lengths (inches AND mm), interior angles, and thickness. Give a table. Note
   which shapes share an edge length (and can therefore magnetically connect edge-to-edge).

2. MAGNET MECHANICS & CONNECTION RULES — Where magnets sit in each edge and how many; whether they
   self-orient/flip so any two edges attract; and the practical rules for connecting two tiles: must
   they share a FULL edge or can they offset/partially overlap? What dihedral fold angles are
   achievable along a shared edge (free hinge, or detents)? What connections are physically
   impossible? Cite manufacturer docs or teardown/maker sources.

3. SET COMPOSITION — Exact piece counts by shape for common sets, especially the "Classic 100" set
   and any set used in MAGNA-TILES official "build ideas" videos. Confirm definitively whether a
   larger-than-standard square ("XL"/"big" square) exists in any Magna-Tiles or compatible product,
   with its dimensions.

4. STRUCTURAL STABILITY — How magnetic-tile structures stand or fall: base footprint, center of
   gravity, triangulation, fold-bracing, and the real strength limits of the magnet bond (when do
   builds pop apart under weight, torque, or cantilever?). Include any rules-of-thumb for tall,
   cantilevered, or load-bearing builds (e.g., a ramp a toy car rolls down).

5. CONSTRUCTION TECHNIQUES — Documented techniques for building recognizable objects: "build flat
   then fold up into a box," making cubes/boxes, prisms/wedges/ramps, bracing slopes with triangles,
   symmetry/mirroring, subassemblies. Short how-to for each.

6. REFERENCE BUILDS — Known/official build guides for the relevant objects, especially CAR RAMPS
   (small/medium/large) and JETS/AIRPLANES, with piece breakdowns and assembly order where
   available. Link sources/images.

FORMAT: Markdown, tables where natural, an inline source link on every factual claim, and a
"Confidence & Gaps" note at the end of each section listing what is well-sourced vs. uncertain vs.
unavailable. The reader is an engineer calibrating a 3D model against real pieces.
```
