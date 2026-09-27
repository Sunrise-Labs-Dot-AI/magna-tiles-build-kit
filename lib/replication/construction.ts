import { stageBuild } from "./geometry";
import { findInsertionPath, validateInsertionPath, type InsertionPath } from "./insertion";
import type { Replica, Verdict } from "./types";

export interface ConstructionStage {
  stageId: string;
  operations: {
    tileIds: string[];
    preparedStageId?: string;
    /** Omitted means no hand evidence, never automatic support of all tiles. */
    hands?: import("./grip").HandContact[];
    /** All hands removed after this insertion. Stage releases are mandatory too. */
    releaseAfter?: boolean;
    /** Release above the target, then earn every new contact under gravity. */
    gravitySeat?: { releaseHeight: number };
  }[];
}

export interface ConstructionResult {
  stageId: string;
  status: Verdict;
  detail: string;
  paths: InsertionPath[];
}

/** Search and independently check insertion paths in source construction order.
 * Every installed part remains an obstacle. Multi-part moves require an earlier,
 * complete path plan for precisely that module. This certifies clearance only.
 */
export function planConstructionPaths(replica: Replica, deadline = Infinity): ConstructionResult[] {
  const results: ConstructionResult[] = [];
  const completed = new Set<string>();
  for (const stage of replica.stages) {
    const plans = replica.construction?.filter(p => p.stageId === stage.id) ?? [];
    const result: ConstructionResult = { stageId: stage.id, status: "unverified", paths: [],
      detail: "No per-part insertion sequence has been supplied." };
    results.push(result);
    if (!plans.length) continue;
    result.status = "fail";
    const plan = plans[0], build = stageBuild(replica, stage);
    const ids = new Set(stage.tileIds), placed = new Set<string>();
    let reason = "";
    if (plans.length !== 1 || plan.operations.length > 250) reason = "Duplicated or oversized construction plan.";
    const preparedParts = (id: string) => {
      const prepared = replica.stages.find(s => s.id === id);
      if (!prepared || !completed.has(id)) { reason = `Module ${id} lacks an earlier complete insertion plan.`; return []; }
      return prepared.tileIds;
    };
    // Installed obstacles belong to the reference stage, not the proposed plan.
    // A search/repair must never make a path pass by clearing this set.
    for (const id of stage.installedStageIds ?? []) for (const tileId of preparedParts(id)) {
      if (!ids.has(tileId) || placed.has(tileId)) reason = "Installed modules overlap or include a part absent from this stage.";
      placed.add(tileId);
    }
    for (const operation of plan.operations) {
      if (reason) break;
      const moving = operation.tileIds;
      if (!moving.length || new Set(moving).size !== moving.length || moving.some(id => !ids.has(id) || placed.has(id))) {
        reason = "An operation omits, duplicates or re-inserts an already installed part."; break;
      }
      if (moving.length > 1 || operation.preparedStageId) {
        const prepared = operation.preparedStageId ? preparedParts(operation.preparedStageId) : [];
        if (prepared.length !== moving.length || prepared.some(id => !moving.includes(id)))
          reason = "A multi-part insertion must match an independently planned earlier module.";
      }
      if (reason) break;
      const path = findInsertionPath(build, moving, [...placed], deadline);
      if (!path || validateInsertionPath(build, path, deadline).status !== "pass") {
        reason = `No clear translation found for ${moving.join(", ")}; rotation or another sequence is needed.`; break;
      }
      result.paths.push(path);
      moving.forEach(id => placed.add(id));
    }
    if (!reason && (placed.size !== ids.size || [...ids].some(id => !placed.has(id)))) reason = "The insertion sequence does not account for every stage part.";
    if (reason) result.detail = reason;
    else {
      result.status = "pass";
      result.detail = `${result.paths.length} continuous insertion paths clear every previously installed part. Grip access, held-pose stability and magnetic closure remain separate requirements.`;
      completed.add(stage.id);
    }
  }
  return results;
}
