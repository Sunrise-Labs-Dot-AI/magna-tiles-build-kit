import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReferenceFrameCandidate, ReferenceVideoSource } from "./types";

export type FrameSample = Pick<
  ReferenceFrameCandidate,
  "timestamp" | "seconds" | "mimeType" | "dataUrl" | "landmarkRole"
>;

export interface FrameSamplingResult {
  frames: FrameSample[];
  note: string;
}

interface AnalyzedFrame extends FrameSample {
  features: FrameFeatures;
}

interface FrameFeatures {
  brightness: number;
  contrast: number;
  edgeEnergy: number;
  textLikelihood: number;
  vector: number[];
}

export interface FrameSamplingOptions {
  startSeconds?: number;
  pinnedSeconds?: number[];
}

export const MAX_FRAME_SAMPLES = 32;
export const MAX_FRAME_CANDIDATES = 64;

export function planFrameTimestamps(
  durationSeconds: number,
  requestedCount: number,
  maxCount = MAX_FRAME_SAMPLES,
  startSeconds = 0,
  pinnedSeconds: number[] = []
): number[] {
  const count = Math.max(1, Math.min(maxCount, Math.floor(requestedCount)));
  const safeStart = Math.max(0, Math.floor(startSeconds));
  const pinned = pinnedSeconds
    .filter((seconds) => Number.isFinite(seconds) && seconds >= safeStart)
    .map((seconds) => Math.floor(seconds));
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return uniqueSorted([...pinned, ...Array.from({ length: count }, (_, index) => safeStart + index * 10)])
      .slice(0, maxCount);
  }

  const start = Math.max(safeStart, Math.min(2, Math.max(0, durationSeconds * 0.05)));
  const end = Math.max(start + 1, durationSeconds * 0.92);
  if (count === 1) return uniqueSorted([...pinned, Math.round(start)]).slice(0, maxCount);

  return uniqueSorted([...pinned, ...Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return Math.round(start + (end - start) * ratio);
  })]).slice(0, maxCount);
}

export async function sampleYouTubeFrames(
  source: ReferenceVideoSource,
  requestedCount: number,
  options: FrameSamplingOptions = {}
): Promise<FrameSamplingResult> {
  const frames = await captureYouTubeFrames(source, requestedCount, MAX_FRAME_SAMPLES, options);
  return {
    frames: frames.map(stripFeatures),
    note: `Sampled ${frames.length} frame${frames.length === 1 ? "" : "s"} from ${source.title}.`
  };
}

export async function sampleYouTubeFrameCandidates(
  source: ReferenceVideoSource,
  requestedCount: number,
  selectedCount: number,
  options: FrameSamplingOptions = {}
): Promise<{ frames: ReferenceFrameCandidate[]; note: string }> {
  const frames = await captureYouTubeFrames(source, requestedCount, MAX_FRAME_CANDIDATES, options);
  const candidates = rankFrameCandidates(frames, selectedCount, options.pinnedSeconds ?? []);
  const selectedTotal = candidates.filter((frame) => frame.selectedByDefault).length;

  return {
    frames: candidates,
    note: `Collected ${candidates.length} candidate frame${candidates.length === 1 ? "" : "s"} and preselected ${selectedTotal} for model grounding.`
  };
}

export async function sampleVideoFileFrameCandidates(
  filePath: string,
  label: string,
  requestedCount: number,
  selectedCount: number,
  options: FrameSamplingOptions = {}
): Promise<{ frames: ReferenceFrameCandidate[]; note: string }> {
  const durationSeconds = await getVideoFileDuration(filePath);
  const frames = await captureFramesFromInput(
    filePath,
    durationSeconds,
    requestedCount,
    MAX_FRAME_CANDIDATES,
    options
  );
  const candidates = rankFrameCandidates(frames, selectedCount, options.pinnedSeconds ?? []);
  const selectedTotal = candidates.filter((frame) => frame.selectedByDefault).length;

  return {
    frames: candidates,
    note: `Collected ${candidates.length} candidate frame${candidates.length === 1 ? "" : "s"} from ${label} and preselected ${selectedTotal} for model grounding.`
  };
}

export function rankFrameCandidates(
  frames: AnalyzedFrame[],
  selectedCount: number,
  pinnedSeconds: number[] = []
): ReferenceFrameCandidate[] {
  if (!frames.length) return [];

  const scored = frames.map((frame, index) => {
    const previous = frames[index - 1]?.features.vector;
    const next = frames[index + 1]?.features.vector;
    const previousChange = previous ? meanAbsDiff(frame.features.vector, previous) / 255 : 0.2;
    const nextChange = next ? meanAbsDiff(frame.features.vector, next) / 255 : 0.2;
    const sceneChange = Math.max(previousChange, nextChange);
    const edgeScore = frame.features.edgeEnergy / 255;
    const contrastScore = Math.min(1, frame.features.contrast / 80);
    const textScore = frame.features.textLikelihood;
    const score = Math.round(
      clamp01(sceneChange * 0.38 + edgeScore * 0.2 + contrastScore * 0.12 + textScore * 0.3) *
        100
    );

    return {
      ...stripFeatures(frame),
      priorityScore: isPinnedFrame(frame.seconds, pinnedSeconds) ? 100 : score,
      selectionReason: isPinnedFrame(frame.seconds, pinnedSeconds)
        ? "bill of materials"
        : describeFrameScore(sceneChange, edgeScore, contrastScore, textScore),
      selectedByDefault: false
    };
  });

  const selectedIndexes = selectDefaultFrameIndexes(
    scored.map((frame) => ({ seconds: frame.seconds, priorityScore: frame.priorityScore })),
    selectedCount
  );

  return scored.map((frame, index) => ({
    ...frame,
    selectedByDefault: selectedIndexes.has(index) || isPinnedFrame(frame.seconds, pinnedSeconds),
    landmarkRole: isPinnedFrame(frame.seconds, pinnedSeconds) ? "bill-of-materials" : undefined
  }));
}

export function selectDefaultFrameIndexes(
  frames: Array<{ seconds: number; priorityScore: number }>,
  selectedCount: number
): Set<number> {
  const limit = Math.max(1, Math.min(MAX_FRAME_SAMPLES, Math.floor(selectedCount)));
  const selected = new Set<number>();
  const duration = Math.max(1, frames.at(-1)?.seconds ?? frames.length);
  const minGap = Math.max(1, duration / Math.max(2, limit * 1.4));

  for (const [index] of frames
    .map((frame, index) => [index, frame] as const)
    .sort((a, b) => b[1].priorityScore - a[1].priorityScore)) {
    if (selected.size >= limit) break;
    const tooClose = [...selected].some(
      (selectedIndex) => Math.abs(frames[selectedIndex].seconds - frames[index].seconds) < minGap
    );
    if (!tooClose) selected.add(index);
  }

  for (let index = 0; selected.size < Math.min(limit, frames.length); index += 1) {
    selected.add(index);
  }

  return selected;
}

async function captureYouTubeFrames(
  source: ReferenceVideoSource,
  requestedCount: number,
  maxCount: number,
  options: FrameSamplingOptions
): Promise<AnalyzedFrame[]> {
  const info = await getVideoInfo(source.url);
  const durationSeconds = Number(info.duration);
  const videoUrl = await getVideoStreamUrl(source.url);

  return captureFramesFromInput(videoUrl, durationSeconds, requestedCount, maxCount, options);
}

async function captureFramesFromInput(
  inputPathOrUrl: string,
  durationSeconds: number,
  requestedCount: number,
  maxCount: number,
  options: FrameSamplingOptions
): Promise<AnalyzedFrame[]> {
  const timestamps = planFrameTimestamps(
    durationSeconds,
    requestedCount,
    maxCount,
    options.startSeconds,
    options.pinnedSeconds
  );

  const tempDir = await mkdtemp(join(tmpdir(), "magnetic-tile-frames-"));
  try {
    const frames: AnalyzedFrame[] = [];
    for (const [index, seconds] of timestamps.entries()) {
      const filePath = join(tempDir, `frame-${index}.jpg`);
      await extractFrame(inputPathOrUrl, seconds, filePath);
      const bytes = await readFile(filePath);
      const features = await analyzeFrameFeatures(filePath);
      frames.push({
        timestamp: secondsToTimestamp(seconds),
        seconds,
        mimeType: "image/jpeg",
        dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        landmarkRole: isPinnedFrame(seconds, options.pinnedSeconds ?? [])
          ? "bill-of-materials"
          : undefined,
        features
      });
    }

    return frames;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function getVideoFileDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
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
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
        return;
      }

      const duration = Number(stdout.trim());
      resolve(Number.isFinite(duration) ? duration : 0);
    });
  });
}

async function getVideoInfo(url: string): Promise<{ duration?: number }> {
  const stdout = await runYtDlp([
    url,
    "--dump-single-json",
    "--skip-download",
    "--no-warnings"
  ]);
  return JSON.parse(stdout) as { duration?: number };
}

async function getVideoStreamUrl(url: string): Promise<string> {
  const stdout = await runYtDlp([
    url,
    "-f",
    "best[height<=720][ext=mp4]/best[height<=720]/best",
    "-g",
    "--no-warnings"
  ]);
  const streamUrl = stdout
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!streamUrl) {
    throw new Error("Could not resolve a video stream URL for frame sampling.");
  }

  return streamUrl;
}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const binaryPath = join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", "yt-dlp");
    const child = spawn(binaryPath, args);
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
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

function extractFrame(videoUrl: string, seconds: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seconds),
      "-i",
      videoUrl,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(768,iw)':-2",
      "-q:v",
      "4",
      "-y",
      outputPath
    ]);

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

function analyzeFrameFeatures(imagePath: string): Promise<FrameFeatures> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      imagePath,
      "-vf",
      "scale=64:36,format=gray",
      "-f",
      "rawvideo",
      "-"
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }

      const vector = [...Buffer.concat(chunks)];
      if (!vector.length) {
        reject(new Error("Could not analyze sampled frame pixels."));
        return;
      }

      const brightness = vector.reduce((sum, value) => sum + value, 0) / vector.length;
      const contrast =
        vector.reduce((sum, value) => sum + Math.abs(value - brightness), 0) / vector.length;
      let edgeTotal = 0;
      let edgeCount = 0;
      const width = 64;
      const height = 36;
      for (let index = 0; index < vector.length; index += 1) {
        if ((index + 1) % width !== 0) {
          edgeTotal += Math.abs(vector[index] - vector[index + 1]);
          edgeCount += 1;
        }
        if (index + width < vector.length) {
          edgeTotal += Math.abs(vector[index] - vector[index + width]);
          edgeCount += 1;
        }
      }

      resolve({
        brightness,
        contrast,
        edgeEnergy: edgeCount ? edgeTotal / edgeCount : 0,
        textLikelihood: estimateTextLikelihood(vector, width, height, brightness, contrast),
        vector
      });
    });
  });
}

function stripFeatures(frame: AnalyzedFrame): FrameSample {
  return {
    timestamp: frame.timestamp,
    seconds: frame.seconds,
    mimeType: frame.mimeType,
    dataUrl: frame.dataUrl,
    landmarkRole: frame.landmarkRole
  };
}

function meanAbsDiff(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs(a[index] - b[index]);
  }
  return total / length;
}

function describeFrameScore(
  sceneChange: number,
  edgeScore: number,
  contrastScore: number,
  textScore: number
): string {
  const reasons = [];
  if (textScore > 0.42) reasons.push("possible text");
  if (sceneChange > 0.18) reasons.push("visible build change");
  if (edgeScore > 0.08) reasons.push("tile-edge detail");
  if (contrastScore > 0.45) reasons.push("clear contrast");
  return reasons.length ? reasons.join(", ") : "timeline coverage";
}

export function estimateTextLikelihood(
  vector: number[],
  width: number,
  height: number,
  brightness: number,
  contrast: number
): number {
  if (vector.length < width * height || width <= 0 || height <= 0) return 0;

  const threshold = Math.max(18, contrast * 0.85);
  let activePixels = 0;
  const activeColumns = new Set<number>();
  let textLikeRows = 0;
  let transitionTotal = 0;

  for (let y = 0; y < height; y += 1) {
    let rowActive = 0;
    let rowTransitions = 0;
    let previousActive = false;

    for (let x = 0; x < width; x += 1) {
      const value = vector[y * width + x];
      const isActive = Math.abs(value - brightness) > threshold;
      if (isActive) {
        rowActive += 1;
        activePixels += 1;
        activeColumns.add(x);
      }
      if (x > 0 && isActive !== previousActive) {
        rowTransitions += 1;
      }
      previousActive = isActive;
    }

    const activeRatio = rowActive / width;
    const hasTextyDensity = activeRatio > 0.03 && activeRatio < 0.65;
    const hasTextyTransitions = rowTransitions >= 4 && rowTransitions <= width * 0.7;
    if (hasTextyDensity && hasTextyTransitions) {
      textLikeRows += 1;
      transitionTotal += rowTransitions;
    }
  }

  const activeRatio = activePixels / (width * height);
  const columnCoverage = activeColumns.size / width;
  const rowBandScore = clamp01(textLikeRows / Math.max(1, height * 0.35));
  const transitionScore = clamp01(
    transitionTotal / Math.max(1, textLikeRows) / Math.max(1, width * 0.22)
  );
  const activeScore =
    activeRatio > 0.02 && activeRatio < 0.5 ? 1 - Math.abs(activeRatio - 0.16) / 0.34 : 0;
  const coverageScore = columnCoverage > 0.22 ? clamp01(columnCoverage / 0.7) : 0;
  const contrastScore = clamp01(contrast / 55);

  return clamp01(
    rowBandScore * 0.28 +
      transitionScore * 0.32 +
      activeScore * 0.18 +
      coverageScore * 0.12 +
      contrastScore * 0.1
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isPinnedFrame(seconds: number, pinnedSeconds: number[]): boolean {
  return pinnedSeconds.some((pinned) => Math.abs(seconds - pinned) <= 1);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.floor(value)))].sort((a, b) => a - b);
}

export function secondsToTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
