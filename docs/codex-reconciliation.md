# Codex Handoff — Reconcile Code to the Researched Magna-Tiles Facts

Run **Prompt 1 in a NEW, dedicated session** (core geometry change — keep it isolated from the
builder/reviewer loop). After it lands and verifies on `main`, resume the **existing** builder and
reviewer sessions with the short re-sync injection at the bottom.

Source of truth: `docs/research/magnatiles-reference.md`.

---

## Prompt 1 — Reconciliation (NEW session)

```text
You are reconciling the Magnatiles build-kit code to a sourced research reference at
docs/research/magnatiles-reference.md. Work on the `main` branch only; never `git checkout` a
commit or detach HEAD. Commit each step as its own discrete diff. NEVER weaken a test, tolerance,
or the validation oracle to accommodate the corrected geometry — if a build overlaps under correct
geometry, that is a real signal to re-author it (flag it), not a reason to loosen a check.

STEP A — Fix the right triangle (do this first; it is the real bug).
The code currently models the right triangle as a 45-45-90 with two 3-unit legs (see
lib/magnetic-tiles/magnet-geometry.ts tileLocalVertices and lib/magnetic-tiles/catalog.ts
TILE_SPECS["right-triangle"], width 3 / height 3). The REAL Magna-Tiles right triangle is a
30-60-90: short leg 3, long leg 3*sqrt(3) (~5.196), hypotenuse 6 (sourced: "longest side is twice
the shortest"). 
- Correct TILE_SPECS and tileLocalVertices for "right-triangle" to the 30-60-90 geometry.
- Update any macro that uses the right triangle (wedgePrism sideShape "right-triangle") and
  recompute the macro composition fixtures in tests/macros.test.ts so they remain overlap-free
  and valid WITH the corrected geometry — by recomputing positions, NOT by loosening assertions.
- Re-run: npm test (especially tests/no-overlap.test.ts, tests/macros.test.ts, the
  reference-acceptance tests), npm run lint, npm run build.
- Verify the James-APPROVED small car ramp (build-drafts/small-car-ramp.json) still validates
  "pass" and still matches its macro reproduction. It uses isosceles + squares, so it SHOULD be
  unaffected — confirm explicitly.
- Report exactly which builds/macros/tests changed as a result. Commit.

STEP B — Record the XL-square finding; do NOT fabricate a dimension.
Per the research, the "XL square" used by the large car ramp is a Builder XL product-line piece —
NOT part of Classic-100 — and its exact edge length is unpublished. Do NOT invent an XL dimension
and do NOT silently substitute another tile. Add a note to docs/codex-stabilization-spec.md NOTES
(and verification/PROGRESS.md) stating: the large car ramp as filmed is not buildable from
Classic-100; it is BLOCKED on a James scope decision (descope / redesign with Classic large-squares
/ add a Builder XL set later). Do not author the large ramp until James decides. Commit the note.

STEP C — Connection-rule fidelity (LOWER priority; SEPARATE commit; only if it does not destabilize
approved builds). Per the research, refine the connection model: treat a half-tile lateral edge
offset as INVALID (it repels in reality, not a weak join); allow a shorter edge to connect along
PART of a longer edge where magnet spacing is compatible (partial / different-length joins); model
magnets as fixed, out-of-plane, alternating polarity. Keep all assertions strict. Re-run the full
suite; if ANY previously-approved build changes validation status, STOP and report rather than
adjusting checks. If this risks destabilizing the honest oracle, DEFER it and say so with the
reason — do not force it.

DONE: right triangle is 30-60-90 across catalog + vertices + macros; full suite green WITHOUT any
weakened assertion; the approved small ramp still validates and still matches; the XL/large-ramp
question is documented as a James decision (not fabricated); Step C is either landed as a separate
commit with all approved builds still passing, or explicitly deferred with a reason. Provide a
short written summary of every build/macro/test affected.
```

---

## Re-sync injection — for the EXISTING builder + reviewer sessions (after Prompt 1 lands)

Paste into BOTH the builder and reviewer sessions:

```text
Re-sync: run `git status`, confirm you're on `main` and pull the latest — the right-triangle
geometry was corrected to 30-60-90 (it was wrongly 45-45-90), which changes any wedge built from
right triangles. Before continuing the medium ramp: re-render and re-confirm the approved SMALL
ramp still matches its reference (it uses isosceles sides, so it should be unaffected — verify, not
assume). Then continue the medium-ramp loop on the corrected geometry. All prior rules still apply:
main only / no detach, compose via macro ports not raw tiles, anti-regression (never build forward
from a state scoring below your best), and the reviewer's vision self-test + calibration first.
```

---

## Later (separate session, not now): capture the 2D official builds
The research surfaced official build cards with EXACT piece counts that are mostly 2D (dinosaurs,
spring builds, butterfly/snail/dog). 2D builds skip folding/overlap/stability, so they're the
lowest-risk first coverage for prompt→build (roadmap Phase 2). Worth a dedicated session to encode
them as the first template set — but do it AFTER reconciliation, not mixed in.
