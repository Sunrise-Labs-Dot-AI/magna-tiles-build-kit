/**
 * End-to-end measured ingestion on a real video (manual integration check).
 *
 *   npx tsx scripts/ingest-video.ts [youtube-url] [--force]
 *
 * Defaults to the dev fixture video (Magna-Tiles Idea: Jet Aircraft by
 * JD's Curious Company). Downloads via yt-dlp into the gitignored
 * .video-cache/ directory, extracts frames with ffmpeg, runs the
 * deterministic step detection, and prints the measured timeline summary.
 * Artifacts never enter git (see .gitignore / README attribution policy).
 */
import { ingestReferenceVideo } from "../lib/reference-encoder/ingest";
import { secondsToTimestamp } from "../lib/reference-encoder/timecode";

const DEFAULT_URL = "https://www.youtube.com/watch?v=WDtC_9se3ds";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const url = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_URL;

  console.log(`Ingesting ${url}${force ? " (force re-run)" : ""}`);
  const startedAt = Date.now();
  const timeline = await ingestReferenceVideo(url, { force, log: (message) => console.log(`  ${message}`) });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const candidates = timeline.steps.filter((step) => !step.baseline);
  const flagged = candidates.filter((step) => step.needsHumanReview);

  console.log("");
  console.log(`Done in ${elapsed}s`);
  console.log(`Video: ${timeline.videoId} (${timeline.metadata.durationSeconds.toFixed(1)}s, ${timeline.metadata.width}x${timeline.metadata.height})`);
  console.log(`Analysis: ${timeline.analysis.frameCount} frames @ ${timeline.analysis.fps} fps (${timeline.analysis.frameWidth}x${timeline.analysis.frameHeight} gray)`);
  console.log(`Spans: ${timeline.motionSpanCount} motion / ${timeline.stableSpanCount} stable`);
  console.log(`Candidate steps: ${candidates.length} (+1 baseline), flagged for review: ${flagged.length}`);
  console.log("");
  console.log("idx  range            stable  motionPk  fg%     Δsil%   conf  flags");
  for (const step of timeline.steps) {
    console.log(
      [
        String(step.index).padStart(3),
        `${secondsToTimestamp(step.startSeconds)}–${secondsToTimestamp(step.endSeconds)}`.padEnd(16),
        `${step.stabilitySeconds.toFixed(1)}s`.padStart(6),
        step.precedingMotionPeak.toFixed(3).padStart(9),
        (step.foregroundRatio * 100).toFixed(1).padStart(6),
        (step.silhouetteDeltaRatio * 100).toFixed(2).padStart(7),
        step.confidence.toFixed(2).padStart(5),
        step.baseline ? "baseline" : step.needsHumanReview ? "NEEDS-REVIEW" : "ok"
      ].join("  ")
    );
  }

  const buckets = [0, 0.25, 0.5, 0.55, 0.7, 0.85, 1.0001];
  console.log("");
  console.log("Confidence distribution (non-baseline):");
  for (let index = 0; index < buckets.length - 1; index += 1) {
    const count = candidates.filter(
      (step) => step.confidence >= buckets[index] && step.confidence < buckets[index + 1]
    ).length;
    console.log(
      `  [${buckets[index].toFixed(2)}, ${Math.min(buckets[index + 1], 1).toFixed(2)})`.padEnd(16) +
        `${"#".repeat(count)} ${count}`
    );
  }
  console.log("");
  console.log(`Artifacts (gitignored): ${timeline.cacheDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
