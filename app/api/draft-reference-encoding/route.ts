import { NextResponse } from "next/server";
import { draftReferenceEncoding } from "@/lib/reference-encoder/draft";
import {
  MAX_FRAME_SAMPLES,
  sampleYouTubeFrames,
  type FrameSample,
  type FrameSamplingResult
} from "@/lib/reference-encoder/frame-sampler";
import { parseDraftModelConfig } from "@/lib/reference-encoder/model-options";
import type { ReferenceVideoSource } from "@/lib/reference-encoder/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      source?: ReferenceVideoSource;
      reviewerNotes?: unknown;
      model?: unknown;
      reasoningEffort?: unknown;
      apiKeyOverride?: unknown;
      sampleFrames?: unknown;
      frameSampleCount?: unknown;
      selectedFrames?: unknown;
      introSkipSeconds?: unknown;
      billOfMaterialsSeconds?: unknown;
    };

    if (!body.source?.videoId) {
      return NextResponse.json(
        {
          error: "Missing video source",
          detail: "Load a reference video before drafting an encoding."
        },
        { status: 400 }
      );
    }

    const reviewerNotes =
      typeof body.reviewerNotes === "string" ? body.reviewerNotes : "";
    const modelConfig = parseDraftModelConfig(body);
    const apiKeyOverride =
      typeof body.apiKeyOverride === "string" && body.apiKeyOverride.startsWith("sk-")
        ? body.apiKeyOverride
        : undefined;
    const shouldSampleFrames = body.sampleFrames === true;
    const frameSampleCount =
      typeof body.frameSampleCount === "number" ? body.frameSampleCount : 6;
    const selectedFrames = parseSelectedFrames(body.selectedFrames);
    const introSkipSeconds =
      typeof body.introSkipSeconds === "number" ? body.introSkipSeconds : 0;
    const billOfMaterialsSeconds =
      typeof body.billOfMaterialsSeconds === "number" ? body.billOfMaterialsSeconds : undefined;
    let sampledFrames: FrameSamplingResult | null = null;
    let frameSamplingError: string | null = null;
    if (
      shouldSampleFrames &&
      !selectedFrames.length &&
      body.source.providerName !== "Local file"
    ) {
      try {
        sampledFrames = await sampleYouTubeFrames(body.source, frameSampleCount, {
          startSeconds: introSkipSeconds,
          pinnedSeconds:
            billOfMaterialsSeconds === undefined ? [] : [billOfMaterialsSeconds]
        });
      } catch (error) {
        frameSamplingError =
          error instanceof Error ? error.message : "Frame sampling failed.";
      }
    }
    const result = await draftReferenceEncoding(
      body.source,
      reviewerNotes,
      modelConfig,
      apiKeyOverride,
      selectedFrames.length ? selectedFrames : sampledFrames?.frames ?? []
    );

    return NextResponse.json({
      ...result,
      frameSampling: selectedFrames.length
        ? {
            count: selectedFrames.length,
            timestamps: selectedFrames.map((frame) => frame.timestamp),
            note: `Used ${selectedFrames.length} selected review frame${selectedFrames.length === 1 ? "" : "s"}.`
          }
        : sampledFrames
        ? {
            count: sampledFrames.frames.length,
            timestamps: sampledFrames.frames.map((frame) => frame.timestamp),
            note: sampledFrames.note
          }
        : frameSamplingError
          ? {
              count: 0,
              timestamps: [],
              note: `Frame sampling failed: ${frameSamplingError}`
            }
          : null
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to draft encoding",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}

function parseSelectedFrames(value: unknown): FrameSample[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, MAX_FRAME_SAMPLES)
    .map((item): FrameSample | null => {
      if (!isObject(item)) return null;
      if (typeof item.timestamp !== "string") return null;
      if (typeof item.seconds !== "number" || !Number.isFinite(item.seconds)) return null;
      if (item.mimeType !== "image/jpeg") return null;
      if (typeof item.dataUrl !== "string" || !item.dataUrl.startsWith("data:image/jpeg;base64,")) {
        return null;
      }

      return {
        timestamp: item.timestamp,
        seconds: item.seconds,
        mimeType: "image/jpeg",
        dataUrl: item.dataUrl,
        landmarkRole:
          item.landmarkRole === "bill-of-materials" ? "bill-of-materials" : undefined
      };
    })
    .filter((frame): frame is FrameSample => frame !== null);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
