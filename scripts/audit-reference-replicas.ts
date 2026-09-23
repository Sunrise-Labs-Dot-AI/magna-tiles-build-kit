/** Diagnostic baseline, not a video reconstruction or visual acceptance gate. */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { draftToBuildGraph } from "../lib/builder/operations";
import type { AuthoredBuildDraft } from "../lib/builder/types";
import { gateBuild } from "../lib/engine/gate";
import { emptyInventory, SHAPE_ORDER } from "../lib/magnetic-tiles/catalog";
import type { Inventory } from "../lib/magnetic-tiles/types";
import { JET_AIRCRAFT_REFERENCE_ENCODING as jet } from "../lib/reference-encoder/examples/jet-aircraft-reference";
import { CAR_RAMPS_REFERENCE_COLLECTION as ramps } from "../lib/reference-encoder/examples/car-ramps-reference";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const targets = [
    {
      id: "jet-aircraft",
      sourceFile: jet.source.url,
      sourceUrl: "https://www.youtube.com/watch?v=WDtC_9se3ds",
      expected: { ...emptyInventory(), ...jet.billOfMaterials } as Inventory | null,
      materialQuestions: [] as string[],
    },
    ...ramps.segments.map((segment) => {
      const expected = { ...emptyInventory(), ...segment.billOfMaterials };
      const materialQuestions: string[] = [];
      for (const material of segment.additionalMaterials ?? []) {
        // Preserve specialty-piece identity. Do not silently substitute six-inch squares.
        if (material.label === "XL square") {
          expected["xl-square"] += material.count;
          materialQuestions.push("Confirm the source XL square dimensions before reconstructing its slope.");
        } else {
          materialQuestions.push(`Unmapped source material: ${material.count} ${material.label}`);
        }
      }
      return {
        id: segment.id,
        sourceFile: ramps.source.url,
        sourceUrl: "https://www.youtube.com/watch?v=vxwBYubszZ8",
        expected,
        materialQuestions,
      };
    }),
    {
      id: "snail",
      sourceFile: null,
      sourceUrl: null,
      expected: null,
      materialQuestions: ["Recover the exact 3D snail video. The separate official 2D snail is not this target."],
    },
  ];
  const entries = [];
  const deadline = Date.now() + 240000;
  for (const target of targets) {
    const path = `build-drafts/${target.id}.json`;
    const contents = await readFile(path, "utf8");
    const draft = JSON.parse(contents) as AuthoredBuildDraft;
    const graph = draftToBuildGraph(draft);
    const actual = emptyInventory();
    for (const tile of graph.tiles) actual[tile.shape]++;
    const differences = target.expected === null ? null : SHAPE_ORDER.flatMap((shape) =>
      actual[shape] === target.expected![shape] ? [] : [{ shape, expected: target.expected![shape], actual: actual[shape] }],
    );
    const sourceFilePresent = target.sourceFile === null ? false :
      await stat(target.sourceFile).then((s) => s.isFile() && s.size > 0).catch(() => false);
    const physics = await gateBuild(graph, { unlimitedPieces: true, deadline });
    const entry = {
      id: target.id,
      source: {
        url: target.sourceUrl,
        localFile: target.sourceFile,
        filePresent: sourceFilePresent,
        evidence: "Legacy video annotations; not reverified against source media in this audit.",
        targetSha256: hash(JSON.stringify(target)),
      },
      candidate: { path, sha256: hash(contents), pieces: graph.tiles.length, inventory: actual },
      recordedSourceInventory: target.expected,
      recordedSourcePieces: target.expected === null ? null : Object.values(target.expected).reduce((a, b) => a + b, 0),
      inventoryDifferences: differences,
      physics: { ...physics, scope: "Existing nominal engine gate; ramps include its straight ball test, not source-specific car behavior." },
      sourceFrameFidelity: "not-evaluated",
      sourceAssemblySequence: "not-evaluated",
      replication: "not-verified",
      blockers: [
        ...(!sourceFilePresent ? ["Source media unavailable locally."] : []),
        ...(differences?.length ? ["Candidate inventory differs from the recorded source inventory."] : []),
        ...target.materialQuestions,
        "Measured source-frame comparison and source-matched assembly verification are required.",
      ],
    };
    entries.push(entry);
    console.log(`${target.id}: ${entry.candidate.pieces}/${entry.recordedSourcePieces ?? "unknown"} pieces; physics ${physics.passed ? "passed" : "failed"}; replication unverified`);
  }
  await mkdir("verification", { recursive: true });
  await writeFile("verification/reference-replication-baseline.json", JSON.stringify({
    schema: "reference-replication-baseline-v1",
    purpose: "Measure the gap to the user's sourced builds. A physics pass is not replication evidence.",
    sourceInventoryProvenance: "Existing annotations require source verification; candidate expectedInventory and visualSignoff are ignored.",
    entries,
  }, null, 2) + "\n");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
