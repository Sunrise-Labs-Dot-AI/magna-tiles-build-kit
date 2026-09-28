import { existsSync } from "node:fs";
import ReferenceLab from "./reference-lab";
import jet from "@/public/reference-replicas/jet.json";
import small from "@/public/reference-replicas/small-ramp.json";
import medium from "@/public/reference-replicas/medium-ramp.json";
import large from "@/public/reference-replicas/large-ramp.json";
import type { Replica, ReplicaReport } from "@/lib/replication/types";

export const dynamic = "force-dynamic";

export default function ReferencesPage() {
  return (
    <ReferenceLab
      entries={
        [jet, small, medium, large] as unknown as {
          replica: Replica;
          report: ReplicaReport;
        }[]
      }
      localComparisons={existsSync(
        "public/reference-frames/replication/comparison.html",
      )}
    />
  );
}
