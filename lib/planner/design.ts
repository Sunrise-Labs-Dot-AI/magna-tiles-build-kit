import { gateBuild } from "@/lib/engine/gate";
import { simulate } from "@/lib/engine/simulate";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import { generateStepInstructions } from "@/lib/magnetic-tiles/instructions";
import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import { validateBuild } from "@/lib/magnetic-tiles/validation";
import type {
  AssemblyStep,
  BuildGraph,
  InventoryPreset,
} from "@/lib/magnetic-tiles/types";
import { parseDesignBrief } from "./brief";
import { courseCandidates } from "./candidates";
import { checkCourse } from "./route-checks";
import { testCars } from "./car-test";
import type { CandidateResult, DesignCheck, DesignResult } from "./types";

export async function designBuild(
  prompt: string,
  inventory: InventoryPreset = "classic-100",
): Promise<DesignResult> {
  const brief = parseDesignBrief(prompt, inventory);
  const candidates =
    brief.kind === "racecourse"
      ? courseCandidates(brief)
      : [{ build: generateBuild(prompt, inventory).build, lanes: [] }];
  const records: CandidateResult[] = [];
  let best: DesignResult | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const validation = validateBuild(candidate.build);
    const inventoryOk = !validation.issues.some(
      (i) => i.code === "inventory-overrun",
    );
    const gate = await gateBuild(candidate.build);
    const checks: DesignCheck[] = [
      {
        code: "inventory",
        label: "Available pieces",
        status: inventoryOk ? "pass" : "fail",
        detail: inventoryOk
          ? "Fits the selected set."
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

export function assemblyInstructions(build: BuildGraph): AssemblyStep[] {
  const steps = generateStepInstructions(build);
  const labels = new Map(build.tiles.map((tile, i) => [tile.id, `P${i + 1}`]));
  return steps.map((step) => {
    const ids = new Set(step.tileIds);
    const connections = build.connections.filter(
      (c) => ids.has(c.fromTileId) || ids.has(c.toTileId),
    );
    const usable = connections.filter((c) => {
      const a = build.tiles.find((t) => t.id === c.fromTileId)!;
      const b = build.tiles.find((t) => t.id === c.toTileId)!;
      return a.step <= step.step && b.step <= step.step;
    });
    const pieces = step.tileIds
      .map(
        (id) =>
          `${labels.get(id)} (${TILE_SPECS[build.tiles.find((t) => t.id === id)!.shape].label.toLowerCase()})`,
      )
      .join(", ");
    const joins = usable
      .map(
        (c) =>
          `${labels.get(c.fromTileId)} edge ${c.fromEdge + 1} ↔ ${labels.get(c.toTileId)} edge ${c.toEdge + 1}`,
      )
      .join("; ");
    let title = step.title;
    let guidance =
      "Hold the pieces in the highlighted orientation while connecting this group. Release them only after the whole step is assembled.";
    if (build.id.startsWith("course-")) {
      title =
        [
          "Assemble the supported slope",
          "Add the launch box",
          "Brace the rear wall",
        ][step.step - 1] ?? title;
      guidance =
        [
          "Hold the two triangular sides parallel, then join the large square across their sloping edges. Set both triangle bases on the table.",
          "Form a box from the four small square walls and the large square roof. Join its front roof edge to the high end of the slope. Keep the driving path open.",
          "Add the two rear squares above the launch box, joined side by side. Gently seat each connection before releasing the model.",
        ][step.step - 1] ?? guidance;
    }
    return {
      ...step,
      title,
      instruction: `${guidance} Pieces: ${pieces}. Joins: ${joins || "Position the pieces as shown."}`,
    };
  });
}
