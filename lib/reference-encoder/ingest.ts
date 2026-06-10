/**
 * Local video ingestion pipeline (server-side only).
 *
 * YouTube URL → yt-dlp download into the gitignored .video-cache/ directory →
 * ffprobe metadata → ffmpeg frame extraction at an adaptive rate → deterministic
 * motion/stable segmentation (segmentation.ts) → per-step silhouette masks and
 * representative frames written back to the cache, plus a timeline.json manifest.
 *
 * Nothing in .video-cache/ is ever committed (see .gitignore): the README
 * attribution policy forbids redistributing creator content. Everything here is
 * deterministic; no LLM touches geometry, pixels, or timing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractYouTubeVideoId } from "./youtube";
import {
  DEFAULT_SEGMENTATION_OPTIONS,
  detectMeasuredSteps,
  type GrayFrame,
  type SegmentationOptions
} from "./segmentation";
import { decodePngToGrayFrame, encodeMaskToPng } from "./png-io";
import type { MeasuredTimelinePayload, MeasuredTimelineStepPayload } from "./types";

export const VIDEO_CACHE_DIR = ".video-cache";

export interface IngestOptions {
  /** Re-run download/extraction/detection even if cached artifacts exist. */
  force?: boolean;
  /** Maximum video height requested from yt-dlp. */
  maxHeight?: number;
  /** Target number of analysis frames; drives the adaptive sampling rate. */
  targetAnalysisFrames?: number;
  /** Width of the small grayscale analysis frames. */
  analysisWidth?: number;
  /** Root directory containing .video-cache (defaults to process.cwd()). */
  cacheRoot?: string;
  segmentation?: Partial<SegmentationOptions>;
  /** Progress logger (the CLI passes console.log; the API route stays silent). */
  log?: (message: string) => void;
}

export interface VideoFileMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export interface MeasuredTimelineStepRecord
  extends Omit<MeasuredTimelineStepPayload, "representativeFrameDataUrl" | "silhouetteDataUrl"> {
  /** Paths relative to the video's cache directory. */
  representativeFramePath: string;
  maskPath: string;
}

export interface MeasuredTimeline {
  videoId: string;
  sourceUrl: string;
  cacheDir: string;
  metadata: VideoFileMetadata;
  analysis: {
    fps: number;
    frameCount: number;
    frameWidth: number;
    frameHeight: number;
    options: SegmentationOptions;
  };
  motionSpanCount: number;
  stableSpanCount: number;
  steps: MeasuredTimelineStepRecord[];
  generatedAt: string;
}

/**
 * Adaptive analysis sampling rate: aim for targetFrames over the whole video,
 * clamped to [0.25, 4] fps and rounded to a quarter so ffmpeg gets a clean rate.
 */
export function planAdaptiveFps(durationSeconds: number, targetFrames = 600): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  const raw = targetFrames / durationSeconds;
  const clamped = Math.max(0.25, Math.min(4, raw));
  return Math.max(0.25, Math.round(clamped * 4) / 4);
}

export function videoCacheDir(videoId: string, cacheRoot = process.cwd()): string {
  return join(cacheRoot, VIDEO_CACHE_DIR, videoId);
}

export async function ingestReferenceVideo(
  url: string,
  options: IngestOptions = {}
): Promise<MeasuredTimeline> {
  const log = options.log ?? (() => {});
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Enter a valid YouTube video URL to ingest.");

  const cacheDir = videoCacheDir(videoId, options.cacheRoot);
  await mkdir(cacheDir, { recursive: true });

  const timelinePath = join(cacheDir, "timeline.json");
  if (!options.force && existsSync(timelinePath)) {
    log(`Using cached timeline at ${timelinePath}`);
    return JSON.parse(await readFile(timelinePath, "utf8")) as MeasuredTimeline;
  }

  const sourcePath = await downloadVideo(url, cacheDir, options.maxHeight ?? 720, {
    force: options.force ?? false,
    log
  });
  const metadata = await probeVideo(sourcePath);
  log(
    `Probed ${sourcePath}: ${metadata.durationSeconds.toFixed(1)}s, ${metadata.width}x${metadata.height} @ ${metadata.fps.toFixed(2)} fps`
  );

  const analysisFps = planAdaptiveFps(metadata.durationSeconds, options.targetAnalysisFrames);
  const analysisWidth = options.analysisWidth ?? 96;
  const framesDir = join(cacheDir, "frames");
  await extractAnalysisFrames(sourcePath, framesDir, analysisFps, analysisWidth, {
    force: options.force ?? false,
    log
  });

  const frames = await loadAnalysisFrames(framesDir, analysisFps);
  if (!frames.length) throw new Error("Frame extraction produced no analysis frames.");
  log(`Loaded ${frames.length} analysis frames at ${analysisFps} fps`);

  const segmentationOptions: SegmentationOptions = {
    ...DEFAULT_SEGMENTATION_OPTIONS,
    ...options.segmentation
  };
  const detection = detectMeasuredSteps(frames, segmentationOptions);
  const motionSpanCount = detection.spans.filter((span) => span.kind === "motion").length;
  const stableSpanCount = detection.spans.filter((span) => span.kind === "stable").length;
  log(
    `Detected ${detection.spans.length} spans (${motionSpanCount} motion / ${stableSpanCount} stable) → ${detection.steps.length} candidate steps`
  );

  const masksDir = join(cacheDir, "masks");
  const stepsDir = join(cacheDir, "steps");
  await rm(masksDir, { recursive: true, force: true });
  await rm(stepsDir, { recursive: true, force: true });
  await mkdir(masksDir, { recursive: true });
  await mkdir(stepsDir, { recursive: true });

  const frameWidth = frames[0].width;
  const frameHeight = frames[0].height;
  const steps: MeasuredTimelineStepRecord[] = [];

  for (const step of detection.steps) {
    const label = String(step.index).padStart(2, "0");
    const maskPath = join("masks", `step-${label}.png`);
    const representativeFramePath = join("steps", `step-${label}.jpg`);

    await writeFile(join(cacheDir, maskPath), encodeMaskToPng(step.mask, frameWidth, frameHeight));
    await extractRepresentativeFrame(
      sourcePath,
      step.representativeSeconds,
      join(cacheDir, representativeFramePath)
    );

    steps.push({
      index: step.index,
      startSeconds: step.startSeconds,
      endSeconds: step.endSeconds,
      representativeSeconds: step.representativeSeconds,
      stabilitySeconds: step.stabilitySeconds,
      precedingMotionPeak: step.precedingMotionPeak,
      intraSpanMeanChangedFraction: step.intraSpanMeanChangedFraction,
      foregroundRatio: step.foregroundRatio,
      silhouetteDeltaRatio: step.silhouetteDeltaRatio,
      confidence: step.confidence,
      confidenceParts: step.confidenceParts,
      needsHumanReview: step.needsHumanReview,
      baseline: step.baseline,
      representativeFramePath,
      maskPath
    });
  }

  const timeline: MeasuredTimeline = {
    videoId,
    sourceUrl: url,
    cacheDir,
    metadata,
    analysis: {
      fps: analysisFps,
      frameCount: frames.length,
      frameWidth,
      frameHeight,
      options: segmentationOptions
    },
    motionSpanCount,
    stableSpanCount,
    steps,
    generatedAt: new Date().toISOString()
  };

  await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
  log(`Wrote ${timelinePath}`);
  return timeline;
}

/** Inline the per-step evidence images as data URLs for the review UI. */
export async function timelineToPayload(timeline: MeasuredTimeline): Promise<MeasuredTimelinePayload> {
  const steps: MeasuredTimelineStepPayload[] = [];
  for (const step of timeline.steps) {
    const [frameBytes, maskBytes] = await Promise.all([
      readFile(join(timeline.cacheDir, step.representativeFramePath)),
      readFile(join(timeline.cacheDir, step.maskPath))
    ]);
    steps.push({
      index: step.index,
      startSeconds: step.startSeconds,
      endSeconds: step.endSeconds,
      representativeSeconds: step.representativeSeconds,
      stabilitySeconds: step.stabilitySeconds,
      precedingMotionPeak: step.precedingMotionPeak,
      intraSpanMeanChangedFraction: step.intraSpanMeanChangedFraction,
      foregroundRatio: step.foregroundRatio,
      silhouetteDeltaRatio: step.silhouetteDeltaRatio,
      confidence: step.confidence,
      confidenceParts: step.confidenceParts,
      needsHumanReview: step.needsHumanReview,
      baseline: step.baseline,
      representativeFrameDataUrl: `data:image/jpeg;base64,${frameBytes.toString("base64")}`,
      silhouetteDataUrl: `data:image/png;base64,${maskBytes.toString("base64")}`
    });
  }

  return {
    videoId: timeline.videoId,
    sourceUrl: timeline.sourceUrl,
    durationSeconds: timeline.metadata.durationSeconds,
    analysisFps: timeline.analysis.fps,
    analysisFrameCount: timeline.analysis.frameCount,
    analysisWidth: timeline.analysis.frameWidth,
    analysisHeight: timeline.analysis.frameHeight,
    motionSpanCount: timeline.motionSpanCount,
    stableSpanCount: timeline.stableSpanCount,
    reviewConfidenceThreshold: timeline.analysis.options.reviewConfidenceThreshold,
    steps,
    generatedAt: timeline.generatedAt
  };
}

async function downloadVideo(
  url: string,
  cacheDir: string,
  maxHeight: number,
  context: { force: boolean; log: (message: string) => void }
): Promise<string> {
  const existing = await findSourceFile(cacheDir);
  if (existing && !context.force) {
    context.log(`Using cached video ${existing}`);
    return existing;
  }
  if (existing && context.force) {
    await rm(existing, { force: true });
  }

  context.log(`Downloading ${url} (≤${maxHeight}p, video-only) with yt-dlp…`);
  await runCommand(resolveYtDlpBinary(), [
    url,
    "-f",
    `bv*[height<=${maxHeight}][ext=mp4]/bv*[height<=${maxHeight}]/b[height<=${maxHeight}]/b`,
    "--no-playlist",
    "--no-warnings",
    "-o",
    join(cacheDir, "source.%(ext)s")
  ]);

  const downloaded = await findSourceFile(cacheDir);
  if (!downloaded) throw new Error("yt-dlp finished but no source file was found in the cache.");
  return downloaded;
}

/**
 * Locate the cached local download for a video id, if ingestion already ran.
 * Lets other pipeline code (frame sampling for the review UI) read frames from
 * the real local file instead of re-resolving a remote stream.
 */
export async function findCachedSourceFile(
  videoId: string,
  cacheRoot = process.cwd()
): Promise<string | null> {
  return findSourceFile(videoCacheDir(videoId, cacheRoot));
}

async function findSourceFile(cacheDir: string): Promise<string | null> {
  if (!existsSync(cacheDir)) return null;
  const entries = await readdir(cacheDir);
  const source = entries
    .filter((entry) => entry.startsWith("source.") && !entry.endsWith(".part"))
    .sort();
  return source.length ? join(cacheDir, source[0]) : null;
}

function resolveYtDlpBinary(): string {
  const candidates = [
    process.env.YT_DLP_PATH,
    join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", "yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp"
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "yt-dlp";
}

export async function probeVideo(filePath: string): Promise<VideoFileMetadata> {
  const stdout = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate",
    "-show_entries",
    "format=duration",
    "-print_format",
    "json",
    filePath
  ]);

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const durationSeconds = Number(parsed.format?.duration ?? 0);
  const [fpsNumerator, fpsDenominator] = (stream?.avg_frame_rate ?? "0/1")
    .split("/")
    .map((value) => Number(value));

  return {
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    width: stream?.width ?? 0,
    height: stream?.height ?? 0,
    fps: fpsDenominator ? fpsNumerator / fpsDenominator : 0
  };
}

async function extractAnalysisFrames(
  sourcePath: string,
  framesDir: string,
  fps: number,
  width: number,
  context: { force: boolean; log: (message: string) => void }
): Promise<void> {
  const paramsPath = join(framesDir, "params.json");
  if (!context.force && existsSync(framesDir) && existsSync(paramsPath)) {
    try {
      const params = JSON.parse(await readFile(paramsPath, "utf8")) as {
        fps?: number;
        width?: number;
      };
      const existing = (await readdir(framesDir)).filter((file) => file.endsWith(".png"));
      if (existing.length > 0 && params.fps === fps && params.width === width) {
        context.log(`Using ${existing.length} cached analysis frames in ${framesDir}`);
        return;
      }
    } catch {
      // Unreadable params: fall through and re-extract.
    }
  }

  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  context.log(`Extracting analysis frames at ${fps} fps into ${framesDir}…`);
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-vf",
    `fps=${fps},scale=${width}:-2,format=gray`,
    "-start_number",
    "0",
    "-y",
    join(framesDir, "f-%06d.png")
  ]);
  await writeFile(paramsPath, `${JSON.stringify({ fps, width })}\n`, "utf8");
}

async function loadAnalysisFrames(framesDir: string, fps: number): Promise<GrayFrame[]> {
  const files = (await readdir(framesDir)).filter((file) => file.endsWith(".png")).sort();
  const frames: GrayFrame[] = [];
  for (const [index, file] of files.entries()) {
    const buffer = await readFile(join(framesDir, file));
    frames.push(decodePngToGrayFrame(buffer, index / fps));
  }
  return frames;
}

function extractRepresentativeFrame(
  sourcePath: string,
  seconds: number,
  outputPath: string
): Promise<string> {
  return runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    seconds.toFixed(3),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    "scale='min(480,iw)':-2",
    "-q:v",
    "4",
    "-y",
    outputPath
  ]);
}

function runCommand(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `${binary} exited with code ${code}`));
      }
    });
  });
}
