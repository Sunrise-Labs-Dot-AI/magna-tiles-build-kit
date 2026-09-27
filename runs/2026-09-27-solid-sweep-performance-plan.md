# Continuous solid-check performance

The September 27 structural benchmark now passes 19/20 constructive briefs and 5/5 required rejections. The five-step staircase exceeds its unchanged 240000 ms computation budget before one full candidate evaluation. Do not weaken collision, assembly, release or rest acceptance, or silently enlarge that budget.

Proposal: optimize repeated calculation inside `checkSolidSweep`, retaining its complete finite-prism SAT and conservative recursive interval certificate.

1. Measure the existing guard with a repeatable 48-tile four-step fixture and profile the failing five-step solver. Keep initial result/profiles local and retain compact before/after metrics in runs/diagnostics.
2. Replace the allocating six-value AABB gap expression with the same scalar maximum. Compute each top-level tile's motion bound once per substep rather than repeatedly for every pair. Reuse already measured endpoint pair gaps in the recursive call, while computing fresh midpoint gaps and bounds for each recursive interval. Any cached bound belongs to its exact endpoint pair; never reuse the full-step bound for a child interval. Reuse a numeric gap only after observePair has applied all peak/failure side effects for that same ordered pair in the current evaluation. Do not cache across calls or world/state transitions.
3. Preserve exact endpoint overlap measurement for all pairs, iteration order, failure history, ground checks, recursive depth, budget checks, SAT axes and numerical tolerances. Nonzero near-parallel axes remain normalized and tested. No broadphase approximation may declare an overlapping pair safe.
4. Compare results against a frozen pre-optimization implementation over seeded moving prisms, analytic crossings, touching/near-tolerance cases, containment and rotations. Require deeply equal complete result payloads, including failure kind, IDs, exact penetration, detail, peakSolidOverlap, peakSolidPair and peakGroundPenetration; compare budget-exception propagation. Retain independent analytic negative tests so equivalence alone does not validate both implementations' bugs.
5. Run existing solid/contact/assembly tests, full tests, unchanged full benchmark and source regeneration/build. Accept only measured speed improvement with identical physical verdicts. If the five-step case still exceeds budget, keep the failure and continue diagnosis.

Full engineering loop: collision acceptance is safety-critical for this product. Obtain fresh alternative-model plan/code reviews; use the recorded GPT-5.5 read-only substitute for unavailable Claude OAuth. Implement only after the current runtime's evidence is complete and checkpointed, so measurements stay attributable.

## Plan review disposition

Fresh GPT-5.5 review required three clarifications, all accepted above: bounds belong to exact recursive endpoints; gap reuse follows the original observation side effects and ordering; equivalence includes the entire result payload. Each edit was reread against the current implementation. Verdict: no remaining required plan change.
