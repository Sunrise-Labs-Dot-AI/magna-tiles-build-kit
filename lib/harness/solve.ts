import { compileProgram } from "./compile";
import { validateContract } from "./contract";
import { evaluateCandidate } from "./evaluate";
import { planStablePrefixes } from "./assembly";
import { SimulationBudgetExceeded } from "@/lib/engine/simulate";
import { assemblyInstructions } from "@/lib/planner/instructions";
import type {
  ConstructionProgram,
  HarnessResult,
  IntentContract,
} from "./types";

export const MODEL_LIMITS =
  "Simulation evidence, not a physical guarantee. Inch-scale rigid tiles; ideal magnetic hinges; assumed friction and mass. Three release perturbations, not exhaustive robustness. Geometry coverage is sampled at ≤0.5 inches with 0.03-inch seam tolerance; stair riser transitions allow a 0.36-inch seam. Completed assembly groups are tested; hand access and within-group handling are not.";

export async function solveContract(
  input: IntentContract,
  options: { maxAttempts?: number; maxMilliseconds?: number } = {},
): Promise<HarnessResult> {
  validateContract(input);
  const contract = structuredClone(input),
    started = Date.now();
  const result: HarnessResult = {
    contract,
    status: "search-exhausted",
    build: null,
    instructions: [],
    evaluation: null,
    attempts: [],
    explanation: "",
    model: MODEL_LIMITS,
  };
  if (contract.unresolved.length)
    return {
      ...result,
      status: "unsupported",
      explanation: contract.unresolved.join("\n"),
    };
  if (Object.values(contract.limits).some((r) => r.min > r.max))
    return {
      ...result,
      status: "infeasible",
      explanation:
        "Contradictory dimension limits: the requested minimum exceeds the maximum.",
    };
  const maxAttempts = Math.min(32, Math.max(1, options.maxAttempts ?? 18)),
    maxMs = Math.min(300000, Math.max(1, options.maxMilliseconds ?? 240000));
  const initial: ConstructionProgram = {
    kind: contract.kind,
    ...contract.cells,
    reinforcement: "shell",
  };
  const queue: { program: ConstructionProgram; triggeredBy: string[] }[] = [
      { program: initial, triggeredBy: ["initial minimum-parts construction"] },
    ],
    seen = new Set<string>();
  let bestScore = -Infinity;
  while (
    queue.length &&
    result.attempts.length < maxAttempts &&
    Date.now() - started < maxMs
  ) {
    const next = queue.shift()!,
      key = JSON.stringify(next.program);
    if (seen.has(key)) continue;
    seen.add(key);
    let build = compileProgram(next.program, contract);
    let evaluation;
    try {
      if (next.program.assembly === "stable-prefix")
        build = await planStablePrefixes(build, started + maxMs);
      evaluation = await evaluateCandidate(build, contract, {
        deadline: started + maxMs,
      });
    } catch (error) {
      if (!(error instanceof SimulationBudgetExceeded)) throw error;
      return {
        ...result,
        status: "budget-exhausted",
        explanation:
          "Analysis time budget reached during simulation. No incomplete trial is accepted; this is not proof of infeasibility.",
      };
    }
    result.attempts.push({
      index: result.attempts.length + 1,
      ...next,
      evaluation,
    });
    if (
      evaluation.evidence.some(
        (e) =>
          e.id === "input" && !e.passed && e.actual.includes("resource budget"),
      )
    )
      return {
        ...result,
        status: "budget-exhausted",
        evaluation,
        build,
        explanation:
          "The candidate exceeds the evaluator complexity budget, not the available-piece count. Split the analysis or increase the compute budget before retrying.",
      };
    const score =
      evaluation.evidence.filter((e) => e.passed).length -
      3 * evaluation.evidence.filter((e) => !e.passed).length;
    if (score > bestScore) {
      bestScore = score;
      result.build = build;
      result.evaluation = evaluation;
      result.instructions = assemblyInstructions(build);
    }
    if (evaluation.passed)
      return {
        ...result,
        status: "solved",
        build,
        evaluation,
        instructions: assemblyInstructions(build),
        explanation: `Solved without relaxing the intent contract after ${result.attempts.length} evaluated candidate(s).`,
      };
    const failed = evaluation.evidence.filter((e) => !e.passed),
      triggeredBy = failed.map((e) => `${e.id}: ${e.actual}`);
    if (
      failed.some((e) => e.repair === "sequence") &&
      next.program.assembly !== "stable-prefix"
    ) {
      queue.unshift({
        program: { ...next.program, assembly: "stable-prefix" },
        triggeredBy,
      });
      continue;
    }
    if (
      failed.some((e) => e.repair === "reinforce" || e.repair === "sequence")
    ) {
      // General combined repair: brace the shell and widen only unconstrained axes.
      // Prioritize a stable footprint before exploring single-variable alternatives.
      const braced = {
        ...next.program,
        reinforcement: "rigid-panels" as const,
      };
      for (const axis of ["width", "depth"] as const)
        if (!contract.fixed.includes(axis))
          braced[axis] = Math.max(2, braced[axis]);
      queue.unshift({ program: braced, triggeredBy });
      if (
        contract.kind === "tunnel" &&
        !contract.fixed.includes("height") &&
        next.program.reinforcement === "rigid-panels"
      )
        queue.unshift({
          program: { ...next.program, reinforcement: "portal-base" },
          triggeredBy,
        });
      if (next.program.reinforcement === "shell")
        queue.push({
          program: { ...next.program, reinforcement: "diaphragms" },
          triggeredBy,
        });
      if (next.program.reinforcement !== "rigid-panels")
        queue.push({
          program: { ...next.program, reinforcement: "rigid-panels" },
          triggeredBy,
        });
      // Change only unspecified dimensions; hard geometry limits are independently rechecked.
      for (const axis of ["width", "depth"] as const)
        if (!contract.fixed.includes(axis) && next.program[axis] < 3)
          queue.push({
            program: { ...next.program, [axis]: next.program[axis] + 1 },
            triggeredBy,
          });
    }
    if (
      failed.some((e) => e.repair === "budget") &&
      next.program.reinforcement !== "rigid-panels"
    )
      queue.push({
        program: { ...next.program, reinforcement: "rigid-panels" },
        triggeredBy,
      });
  }
  result.status = queue.length ? "budget-exhausted" : "search-exhausted";
  result.explanation =
    result.status === "budget-exhausted"
      ? "Search budget reached. This is not a proof of infeasibility."
      : "No passing construction was found in the implemented grammar. This is not a proof of infeasibility.";
  return result;
}
