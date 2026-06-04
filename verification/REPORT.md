# Stabilization Report - Pass 2

Date: 2026-05-25 PDT / 2026-05-26 UTC

## Summary

Pass 2 fixed the false-green oracle first, then repaired the in-scope recipes until raw prism overlap checks and the tightened validator agreed.

The final release gate is not fully checked because `verification/SIGNOFF.md` still needs James's human approval of the contact-sheet renders. Mechanical verification is green.

## Before / After Raw Overlaps

| Build | Before | After | Validation After |
| --- | ---: | ---: | --- |
| Jet Aircraft | 19 | 0 | pass |
| Small Car Ramp | 5 | 0 | pass |
| Medium Car Ramp | 11 | 0 | pass |
| Large Car Ramp | 6 | 0 | pass |

## Evidence

- Contact sheet: `verification/contact-sheet.md`
- Signoff tracker: `verification/SIGNOFF.md`
- Jet Aircraft: `verification/jet-aircraft/final-default.png`
- Small Car Ramp: `verification/small-car-ramp/final-default.png`
- Medium Car Ramp: `verification/medium-car-ramp/final-high.png`
- Large Car Ramp: `verification/large-car-ramp/final-high.png`
- Prompt screenshots: `verification/prompts/`

## Verification Gates

- `npm test`: pass, 7 files / 103 tests.
- `npm run build`: pass.
- `npm run lint`: pass exit code, warnings only.
- `npm run verify:builds`: pass, 12 records, each with `validation.status=pass`, `rawOverlaps=0`, and matching instruction steps.
- `tests/no-overlap.test.ts`: pass for 4 library builds and 8 prompt cases.
- Structural acceptance and all bug-report regressions: pass.

## Notes

- The oracle change is isolated in commit `2bb6cf8`: magnetic-hinge overlap tolerance is `0.03`, and real `tile-overlap` issues are errors.
- Generic non-core families remain out of scope and still need a later physical/visual stabilization pass.
- Human visual approval is pending; do not treat this report as final release signoff until `verification/SIGNOFF.md` is updated.
