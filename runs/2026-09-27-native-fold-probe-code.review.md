# Native fold diagnostic code review

The off-path diagnostic in `scripts/reference/probe-native-fold.ts` implements the independently reviewed protocol. The production runtime, source models, evidence ledger and acceptance criteria are unchanged. This review covers the experiment implementation; no native experiment result exists yet.

Type checking and focused lint completed exit0 (sessions1408 and90956, logs `/tmp/magnatiles-native-fold-types.log` and `/tmp/magnatiles-native-fold-lint.log`). The fresh independent GPT-5.5 read-only review completed exit0 in session61576; full result is `reviews/native-fold-probe-code-review.txt`. It inspected actual local APIs and the protocol without executing native simulations. This uses the established fallback after the previously documented Claude subscription OAuth failure; no credentials changed.

One finding was accepted: recording an arbitrary starting runtime and checking only its stability would not enforce the declared baseline. The diagnostic now asserts the literal reviewed `7a8ad00bf79266e385e434dcb9bdb6f7fabe98d1511f8564b36cd81496c93e29` hash before its first checkpoint or physics world. Existing per-checkpoint and final runtime/script comparisons remain. The implementing agent verified the two-line assertion in place; this narrow correction needs no second full review under the skill's inline verification rule.

The reviewer returned no other actionable code/protocol finding. Actual outcomes, trajectory coverage, native frame assumptions, setup rejection and failure classification still require execution and independent results review. Execution remains queued behind the current timed qualification jobs, with no competing native simulation.
