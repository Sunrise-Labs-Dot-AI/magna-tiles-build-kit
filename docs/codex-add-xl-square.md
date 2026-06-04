# Codex Handoff — Add the XL Square (Builder XL) + unblock the large ramp

Run in a **NEW session** (focused catalog/inventory change; keep it out of the builder/reviewer
loop). James has decided to support the XL square. Per `docs/research/magnatiles-reference.md`, the
XL square is a real MAGNA-TILES **Builder XL** piece — NOT part of Classic-100 — and its exact edge
length is **unpublished**. Model it as a flagged ASSUMED constant; do not fabricate it as fact.

```text
Add the XL square to the Magnatiles build kit so the large car ramp can be authored. Work on the
`main` branch only; never `git checkout`/detach. Commit each step as a discrete diff. Never weaken
a test, tolerance, or the validation oracle.

CONTEXT: per docs/research/magnatiles-reference.md (section 3), the "XL square" is a real MAGNA-TILES
Builder XL product-line piece, NOT in Classic-100, and its exact edge length is UNPUBLISHED. Do NOT
assert a real dimension — model it as one clearly-flagged ASSUMED constant that is trivial to fix
when a real measurement is found.

STEP 1 — Catalog the XL square shape.
- Add TileShape "xl-square" (lib/magnetic-tiles/types.ts + catalog.ts). It is a square.
- Define a single named constant XL_SQUARE_EDGE. Set it to an ASSUMED value that is a multiple of
  SMALL_EDGE (so XL edges mate with Classic square edges along shared sub-segments) and larger than
  the large square — recommend 4 * SMALL_EDGE (= 12 units). Comment it explicitly:
  "ASSUMED — Builder XL edge length is unpublished (research §3). Single source of truth; correct
  when measured." TILE_SPECS["xl-square"] uses this for width/height/edgeLength.
- Ensure tileLocalVertices, prism-geometry, the magnet-edge logic, and the renderer derive the XL
  square from TILE_SPECS exactly like the other squares (it is just a larger square). Verify it
  renders and its edges/magnets scale correctly.

STEP 2 — Inventory preset (keep Classic-100 clean).
- Do NOT add XL squares to CLASSIC_100_INVENTORY.
- Add a new InventoryPreset (e.g. "builder-xl") whose inventory = the Classic pieces PLUS the XL
  squares the large ramp needs. Per the reference large-ramp BOM: 42 small-square, 6
  equilateral-triangle, 3 xl-square. Everything except the large ramp keeps "classic-100".

STEP 3 — Reconcile the spec/scope.
- In docs/codex-stabilization-spec.md, change the "uses only Classic-100 tiles" rule to "uses only
  tiles in the build's declared inventory preset." Un-block the large car ramp in NOTES (now
  buildable via the builder-xl preset) and keep a note that XL_SQUARE_EDGE is assumed/unverified.

STEP 4 — Verify.
- npm test, npm run lint, npm run build all green WITHOUT weakening anything. The XL square must
  pass no-overlap/validation as a plain square. Add a small test: an xl-square tile is overlap-free,
  validates, and the builder-xl preset reports the expected BOM.
- Downstream note (do not act on it here): XL-square-to-small-square joins are different-length
  (partial) joins; the current oracle is permissive about these (the approved small ramp already
  relies on 6-to-3 joins), so they will validate. Tightening different-length joins is the deferred
  Step C and is out of scope for this task.

GUARDRAILS: main only; XL_SQUARE_EDGE is a flagged ASSUMED constant, never presented as the real
MAGNA-TILES spec; do not pollute Classic-100; do not weaken tests/oracle; commit discretely.

DONE: "xl-square" is a first-class catalog shape backed by a single flagged-assumed edge constant; a
"builder-xl" inventory preset exists with Classic-100 untouched; the spec rule is preset-based and
the large ramp is un-blocked; full suite green. (Authoring the actual large-ramp GEOMETRY is the
builder/reviewer loop's next job — not this task.)
```

After this lands: author the large ramp in the builder/reviewer loop (large ramp = big `wedgePrism`
ramp plane + tall `wallGrid` rear wall + `box` platform, per the macro vocabulary), declaring the
`builder-xl` preset, gated by the reviewer against `public/reference-frames/large-car-ramp/*.jpg`.
