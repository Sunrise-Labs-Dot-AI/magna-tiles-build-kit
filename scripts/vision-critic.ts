/**
 * Vision critic — Phase 4 of the build system.
 *
 * Renders the current library jet from multiple angles (using the reliable camera), then compares
 * each view against the corresponding video reference frame using:
 * 1. The geometric silhouette scorer (tile-vertex projection IoU, fast).
 * 2. The pixel silhouette scorer (rendered PNG vs reference JPG, deterministic).
 * 3. A structured diagnostic report for the semantic vision-LLM layer (Claude looking at the
 *    renders + reference frames side by side).
 *
 * Usage: npm run dev (in another terminal), then:
 *   RENDER_DRAFT_BASE_URL=http://localhost:3000 npx tsx scripts/vision-critic.ts
 *
 * Outputs a JSON diagnostic to stdout and writes rendered PNGs to verification/jet-aircraft/.
 */

import { readBuildDraft } from "../lib/builder/storage";
import { draftToBuildGraph } from "../lib/builder/operations";
import { scoreRecognition, combinedScore } from "../lib/recognition/score";
import { jetSilhouetteMatch } from "../lib/recognition/silhouette";
import { pixelSilhouetteMatch, type PixelSilhouetteMetrics } from "../lib/recognition/pixel-critic";
import { JET_RECOGNITION_TARGET } from "../lib/recognition/targets";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

interface ViewComparison {
  view: string;
  renderPath: string;
  referencePath: string;
  geometricIoU: number;
  pixel: PixelSilhouetteMetrics | null;
  mismatches: string[];
}

interface CriticReport {
  buildId: string;
  tiles: number;
  structuralScore: number;
  geometricSilhouette: number;
  combinedScore: number;
  gatePassed: boolean | null;
  views: ViewComparison[];
  overallVerdict: "pass" | "needs-work";
  topMismatches: string[];
  /** Renders + reference paths for the semantic vision-LLM to inspect. */
  visualInspectionPairs: Array<{ render: string; reference: string; view: string }>;
}

const VIEW_MAP: Array<{
  view: string;
  renderFile: string;
  referenceFile: string;
  geometricView: "top" | "side" | "front";
}> = [
  {
    view: "side",
    renderFile: "verification/jet-aircraft/side.png",
    referenceFile: "public/reference-frames/jet-aircraft/steps/12-final-side.jpg",
    geometricView: "side"
  },
  {
    view: "front",
    renderFile: "verification/jet-aircraft/front.png",
    referenceFile: "public/reference-frames/jet-aircraft/steps/11-final-front.jpg",
    geometricView: "front"
  },
  {
    view: "iso",
    renderFile: "verification/jet-aircraft/iso.png",
    referenceFile: "public/reference-frames/jet-aircraft/steps/13-final-rear.jpg",
    geometricView: "top" // closest geometric proxy for the 3/4 view
  }
];

async function runCritic(): Promise<CriticReport> {
  // 1. Render the jet.
  const baseUrl = process.env.RENDER_DRAFT_BASE_URL ?? "http://localhost:3000";
  console.error(`Rendering jet-aircraft against ${baseUrl}...`);
  try {
    execSync(`RENDER_DRAFT_BASE_URL=${baseUrl} npm run render:draft -- jet-aircraft`, {
      cwd: process.cwd(),
      stdio: "pipe",
      timeout: 60000
    });
    console.error("Rendered.");
  } catch (error) {
    console.error("Render failed; proceeding with existing PNGs if available.");
  }

  // 2. Score the build.
  const draft = await readBuildDraft("jet-aircraft");
  const graph = draftToBuildGraph(draft);
  const structural = scoreRecognition(graph, JET_RECOGNITION_TARGET);
  const geometric = jetSilhouetteMatch(graph);
  const combined = combinedScore(structural.total, geometric.total);

  // 3. Per-view comparison.
  const views: ViewComparison[] = [];
  const visualPairs: CriticReport["visualInspectionPairs"] = [];

  for (const entry of VIEW_MAP) {
    const renderExists = existsSync(entry.renderFile);
    const refExists = existsSync(entry.referenceFile);
    const mismatches: string[] = [];

    let pixel: PixelSilhouetteMetrics | null = null;
    if (renderExists && refExists) {
      try {
        pixel = await pixelSilhouetteMatch(entry.renderFile, entry.referenceFile);
        if (pixel.iou < 0.35) mismatches.push(`${entry.view}: pixel IoU too low (${pixel.iou.toFixed(2)} < 0.35)`);
        if (pixel.targetCoverage < 0.5) mismatches.push(`${entry.view}: target coverage low (${pixel.targetCoverage.toFixed(2)} < 0.50)`);
        if (Math.abs(pixel.horizontalBalance) > 0.25) mismatches.push(`${entry.view}: asymmetric (balance ${pixel.horizontalBalance.toFixed(2)})`);
      } catch (error) {
        mismatches.push(`${entry.view}: pixel comparison failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      visualPairs.push({ render: entry.renderFile, reference: entry.referenceFile, view: entry.view });
    } else {
      if (!renderExists) mismatches.push(`${entry.view}: render not found at ${entry.renderFile}`);
      if (!refExists) mismatches.push(`${entry.view}: reference not found at ${entry.referenceFile}`);
    }

    const geoScore = geometric.perView[entry.geometricView];
    if (geoScore < 0.5) mismatches.push(`${entry.view}: geometric silhouette IoU low (${geoScore.toFixed(2)} < 0.50)`);

    views.push({
      view: entry.view,
      renderPath: entry.renderFile,
      referencePath: entry.referenceFile,
      geometricIoU: geoScore,
      pixel,
      mismatches
    });
  }

  // 4. Overall verdict.
  const allMismatches = views.flatMap((v) => v.mismatches);
  const blockers = allMismatches.filter((m) => m.includes("too low") || m.includes("coverage low"));
  const verdict = blockers.length === 0 && combined >= 0.7 ? "pass" : "needs-work";

  return {
    buildId: "jet-aircraft",
    tiles: graph.tiles.length,
    structuralScore: structural.total,
    geometricSilhouette: geometric.total,
    combinedScore: combined,
    gatePassed: null, // gate is expensive; run separately
    views,
    overallVerdict: verdict,
    topMismatches: allMismatches.slice(0, 8),
    visualInspectionPairs: visualPairs
  };
}

async function main() {
  const report = runCritic();
  const result = await report;

  console.log("\n=== VISION CRITIC REPORT ===");
  console.log(`Build: ${result.buildId} (${result.tiles} tiles)`);
  console.log(`Structural: ${result.structuralScore.toFixed(3)}  Geometric silhouette: ${result.geometricSilhouette.toFixed(3)}  Combined: ${result.combinedScore.toFixed(3)}`);
  console.log(`Verdict: ${result.overallVerdict}`);

  for (const v of result.views) {
    console.log(`\n  ${v.view}:`);
    console.log(`    geometric IoU: ${v.geometricIoU.toFixed(3)}`);
    if (v.pixel) {
      console.log(`    pixel IoU: ${v.pixel.iou.toFixed(3)}  coverage: ${v.pixel.targetCoverage.toFixed(3)}  excess: ${v.pixel.excessRatio.toFixed(3)}`);
      console.log(`    width ratio: ${v.pixel.widthRatio.toFixed(2)}  height ratio: ${v.pixel.heightRatio.toFixed(2)}  h-balance: ${v.pixel.horizontalBalance.toFixed(2)}`);
    }
    if (v.mismatches.length > 0) console.log(`    mismatches: ${v.mismatches.join("; ")}`);
  }

  if (result.topMismatches.length > 0) {
    console.log("\nTop mismatches (actionable):");
    result.topMismatches.forEach((m) => console.log(`  - ${m}`));
  }

  console.log("\nVisual inspection pairs (for semantic review):");
  result.visualInspectionPairs.forEach((p) => console.log(`  ${p.view}: render=${p.render}  ref=${p.reference}`));

  console.log("\n" + JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
