import { gateBuild } from "@/lib/engine/gate";
import { simulate } from "@/lib/engine/simulate";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { assemblyInstructions } from "./instructions";
export { assemblyInstructions } from "./instructions";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type { InventoryPreset } from "@/lib/magnetic-tiles/types";
import { parseDesignBrief } from "./brief";
import { courseCandidates } from "./candidates";
import { checkCourse } from "./route-checks";
import { testCars } from "./car-test";
import type { CandidateResult, DesignCheck, DesignResult } from "./types";
import { parseIntent } from "@/lib/harness/contract";
import { solveContract } from "@/lib/harness/solve";

export async function designBuild(
  prompt: string,
  inventory: InventoryPreset = "classic-100",
  options: { unlimitedPieces?: boolean } = {},
): Promise<DesignResult> {
  const brief = parseDesignBrief(prompt, inventory);
  brief.unlimitedPieces = options.unlimitedPieces === true;
  const contract = parseIntent(prompt, inventory, brief.unlimitedPieces);
  if (contract) {
    const harness = await solveContract(contract);
    if (!harness.build || !harness.evaluation)
      throw new Error(harness.explanation);
    return {
      brief: {
        ...brief,
        kind: "structure",
        unsupportedTerms: contract.unresolved,
      },
      build: harness.build,
      instructions: harness.instructions,
      lanes: [],
      trials: [],
      checks: harness.evaluation.evidence.map((e) => ({
        code: e.id,
        label: e.label,
        status: e.passed ? "pass" : "fail",
        detail: `Expected: ${e.expected}\nMeasured: ${e.actual}`,
      })),
      candidates: harness.attempts.map((a) => ({
        id: `attempt-${a.index}`,
        passed: a.evaluation.passed,
        checks: a.evaluation.evidence.map((e) => ({
          code: e.id,
          label: e.label,
          status: e.passed ? "pass" : "fail",
          detail: e.actual,
        })),
      })),
      status:
        harness.status === "solved" ? "simulation-passed" : "needs-repair",
      model: harness.model,
      harness,
    };
  }
  const candidates =
    brief.kind === "racecourse"
      ? courseCandidates(brief)
      : [{ build: generateBuild(prompt, inventory).build, lanes: [] }];
  const records: CandidateResult[] = [];
  let best: DesignResult | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const validation = validateBuild(candidate.build);
    const inventoryOk =
      brief.unlimitedPieces ||
      !validation.issues.some((i) => i.code === "inventory-overrun");
    const gate = await gateBuild(candidate.build, {
      unlimitedPieces: brief.unlimitedPieces,
    });
    const checks: DesignCheck[] = [
      {
        code: "inventory",
        label: "Available pieces",
        status: inventoryOk ? "pass" : "fail",
        detail: inventoryOk
          ? brief.unlimitedPieces
            ? "Unlimited pieces: inventory limits disabled."
            : "Fits the selected set."
          : validation.issues
              .filter((i) => i.code === "inventory-overrun")
              .map((i) => i.detail)
              .join(" "),
      },
      {
        code: "structure",
        label: "Structure simulation",
        status: gate.passed ? "pass" : "fail",
        detail: gate.reasons.join("\n"),
      },
      ...(brief.unsupportedTerms.length
        ? [
            {
              code: "unsupported-prompt",
              label: "Unsupported requirements",
              status: "unverified" as const,
              detail: `The planner has no rules for: ${brief.unsupportedTerms.join(", ")}. This candidate cannot be certified against the whole prompt.`,
            },
          ]
        : []),
      ...(brief.kind === "racecourse"
        ? checkCourse(candidate.build, candidate.lanes, brief)
        : [
            {
              code: "intent",
              label: "Prompt fidelity",
              status: "unverified" as const,
              detail:
                "Legacy template generation cannot yet verify that every requested feature is present.",
            },
          ]),
    ];
    const canRun =
      brief.kind === "racecourse" && checks.every((c) => c.status === "pass");
    const trials = canRun
      ? await testCars(candidate.build, candidate.lanes, brief)
      : [];
    if (brief.kind === "racecourse")
      checks.push({
        code: "cars",
        label: "Unpowered car test",
        status: !canRun
          ? "unverified"
          : trials.every((t) => t.passed)
            ? "pass"
            : "fail",
        detail: !canRun
          ? "Not run: repair the structure and route checks first."
          : trials.map((t) => `${t.laneId}: ${t.reason}`).join("\n"),
      });
    const passed = checks.every((c) => c.status === "pass");
    records.push({ id: candidate.build.id, checks, passed });
    const score =
      checks.filter((c) => c.status === "pass").length -
      checks.filter((c) => c.status === "fail").length;
    if (score > bestScore) {
      bestScore = score;
      best = {
        brief,
        ...candidate,
        instructions: assemblyInstructions(candidate.build),
        checks,
        trials,
        candidates: [],
        status: passed ? "simulation-passed" : "needs-repair",
        model:
          "Inch-scale rigid tiles, ideal breakable magnetic hinges, and unpowered four-wheel car proxies. Magnet strength, friction, car dimensions, and wheel behavior are assumptions. Simulation is not physical calibration or proof that the real build will work.",
      };
    }
    if (passed) break;
  }
  if (!best) throw new Error("No candidate could be constructed.");
  // Check the actual chronological build sequence, not only the completed model.
  if (best.checks.find((c) => c.code === "structure")?.status === "pass") {
    const unstable: number[] = [];
    for (const step of best.instructions) {
      const tiles = best.build.tiles.filter((t) => t.step <= step.step),
        ids = new Set(tiles.map((t) => t.id));
      const result = await simulate({
        ...best.build,
        tiles,
        connections: best.build.connections.filter(
          (c) => ids.has(c.fromTileId) && ids.has(c.toTileId),
        ),
      });
      if (!result.stands) unstable.push(step.step);
    }
    best.checks.push({
      code: "assembly",
      label: "Assembly sequence",
      status: unstable.length ? "unverified" : "pass",
      detail: unstable.length
        ? `Steps ${unstable.join(", ")} do not stand unattended in this model. Hold these subassemblies while connecting the next pieces; assembly needs a real-world trial.`
        : "Each completed step stands in the simulation.",
    });
    if (unstable.length) best.status = "needs-repair";
  }
  const selectedRecord = records.find((record) => record.id === best.build.id)!;
  selectedRecord.passed = best.status === "simulation-passed";
  best.candidates = records;
  return best;
}
