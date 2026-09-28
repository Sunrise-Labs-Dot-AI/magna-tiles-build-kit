import { evaluateReplica } from "@/lib/replication/evaluate";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";
import type {
  Observation,
  Replica,
  ReplicaReport,
} from "@/lib/replication/types";

export type ReferenceContract = Omit<Replica, "build">;

/** Source reconstruction lane: evaluate an independently supplied candidate against
 * stage/landmark bindings. Structural grammar scores and stored signoff fields do
 * not establish source fidelity. Target tile IDs are the observation correspondences.
 */
export async function evaluateReferenceCandidate(
  build: BuildGraph,
  reference: ReferenceContract,
  observations: Observation[],
  options: { deadline?: number } = {},
): Promise<ReplicaReport> {
  return evaluateReplica({ ...reference, build }, observations, options);
}
