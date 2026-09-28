# Native fold protocol review

The initial independent review (`reviews/native-fold-probe-plan-review.txt`) found four underspecified protocol details. All are accepted and corrected before implementation:

1. Seeds now explicitly use the existing one-time release perturbation on the dynamic middle panel. Pre/post states and velocities are recorded; no later reset is allowed.
2. The probe uses its own off-path engine loop, with exact root/middle/end body-mode assertions at every native step. The rigid-carry API is unchanged.
3. Deviation is an explicit per-panel prism-vertex residual from the articulated target, using the unchanged displacement limit. Initial-pose engine displacement remains diagnostic only; engine targets are not rewritten.
4. The protocol now records live joint type, local anchors/frames, model axis/anchors, companion presence and enabled limits, with derived initial world hinge frames. The distal intended hinge frame follows the ideal middle-panel articulation in the composition.

The corrected protocol also distinguishes12 required experiment rows from actual attempted/native-step coverage when an initial float32 boundary/contact check rejects a row. No rejected gap is silently replaced. The fresh read-only verification (`reviews/native-fold-probe-plan-fix-review.txt`) returned VERIFIED/CLEAN after checking all four corrections against the engine and replication code. Runtime and source records remain frozen during full regression.
