# The Build Loop — vision + debug + system-improvement (durable)

Why this exists: the plain build↔review loop failed on complex recognizable builds (the jet kept
coming out flat). Two pieces were missing: (1) REAL vision feedback (the builder is blind; prior
"reviewers" relied on unreliable Codex vision), and (2) a DEBUG + SYSTEM-IMPROVEMENT phase — when a
defect recurs, the root cause is usually the underlying SYSTEM (macros/tooling can't easily express
the needed structure), so re-tweaking the draft loops forever. Fix the system, not the draft.

## Roles
- **Claude = orchestrator + VISION.** Claude is the only reliable vision: it renders, MEASURES the
  draft data, and looks at the image. Vision feedback = measurable defects, not vague notes.
- **Codex = hands.** Authors drafts, improves macros/tooling, runs tests. Blind — give it
  measurable, self-checkable targets.

## The loop (per build target)
1. **BUILD** — Codex authors/edits the draft by composing from macros. Given a measurable target
   + self-check (e.g. "Y-up span must be >= 6", "distinct left/right wings") so a blind builder can
   verify its own output before declaring done.
2. **VISION** (Claude) — render (render:draft, or the direct-playwright fallback) AND measure the
   draft data (bounds, distinct levels, per-role positions). Look at the image. Produce a concrete
   verdict: recognizable? + the specific defects WITH NUMBERS (e.g. "flat: Y-span 1.6, fuselage at
   y=0.1").
3. **TRIAGE** (Claude) — is the defect (a) DRAFT-level (one-off bad placement → re-author) or
   (b) SYSTEM-level (the macros can't easily express the needed structure → the blind builder keeps
   defaulting wrong)? Rule of thumb: if the SAME defect survives >=2 build attempts, it's SYSTEM-level.
4. **DEBUG** (Claude + Codex) — for system-level defects, root-cause WHY the build keeps coming out
   wrong. Example: "the macro vocabulary has no raised-3D-body or dihedral-wing primitive, so the
   agent composes everything flat."
5. **SYSTEM IMPROVEMENT** (Codex) — fix the underlying system: add/fix the missing primitive/macro/
   tool, contract-tested (overlap-free, validates, predictable BOM, stands if standable, and
   INHERENTLY carrying the needed property — e.g. a fuselage primitive that is 3D by construction).
   This benefits all future builds.
6. **BUILD again** — compose from the improved system. Back to step 2.
Exit when VISION passes: recognizable AND gateBuild-valid. Then Claude commits + (for recognizable
objects) it's James's final resemblance signoff.

## Guardrails (unchanged)
- Never weaken engine/gateBuild/validateBuild/0.03 hairline — fix the build or the system.
- Measurable self-checks in every BUILD handoff so the blind builder catches its own failure.
- After >=2 same-defect failures, STOP re-tweaking the draft → go to DEBUG + SYSTEM-IMPROVEMENT.
- One agent at a time on shared files (macros/tests) to avoid collisions; Claude commits (sandbox
  blocks Codex git) and renders (sandbox blocks Codex render).

## Worked example in progress: JET (flat → 3D)
- VISION verdict: FLAT — Y-up span 1.6 across 40 tiles spread 18(X) x 21(Z); fuselage at y=0.1.
  Renders as a flat triangle sprawl, not an aircraft.
- TRIAGE: system-level (survived 2 arrangement re-tweaks).
- Likely DEBUG finding: macros lack inherently-3D aircraft parts; blind agent defaults flat.
- Likely SYSTEM IMPROVEMENT: add contract-tested 3D primitives — `fuselageBox` (raised hollow tube),
  `wingPair` (mirrored panels w/ upward dihedral), `tailAssembly` (horizontal stabilizers + vertical
  fin) — each 3D BY CONSTRUCTION (Y-height > 0, stands). Then compose the jet from them.
- Current step: a measurable BUILD attempt is in flight (Y-span>=6 self-check). If it still renders
  flat/unrecognizable, escalate to DEBUG + SYSTEM IMPROVEMENT (the 3D primitives).
