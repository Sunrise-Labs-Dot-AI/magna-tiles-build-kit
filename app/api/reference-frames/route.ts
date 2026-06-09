import { NextResponse } from "next/server";
import { sampleYouTubeFrameCandidates } from "@/lib/reference-encoder/frame-sampler";
import type { ReferenceVideoSource } from "@/lib/reference-encoder/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      source?: ReferenceVideoSource;
      candidateCount?: unknown;
      selectedCount?: unknown;
      introSkipSeconds?: unknown;
      billOfMaterialsSeconds?: unknown;
    };

    if (!body.source?.videoId) {
      return NextResponse.json(
        {
          error: "Missing video source",
          detail: "Load a reference video before collecting frames."
        },
        { status: 400 }
      );
    }

    const candidateCount =
      typeof body.candidateCount === "number" ? body.candidateCount : 24;
    const selectedCount =
      typeof body.selectedCount === "number" ? body.selectedCount : 8;
    const introSkipSeconds =
      typeof body.introSkipSeconds === "number" ? body.introSkipSeconds : 0;
    const billOfMaterialsSeconds =
      typeof body.billOfMaterialsSeconds === "number" ? body.billOfMaterialsSeconds : undefined;
    const result = await sampleYouTubeFrameCandidates(
      body.source,
      candidateCount,
      selectedCount,
      {
        startSeconds: introSkipSeconds,
        pinnedSeconds:
          billOfMaterialsSeconds === undefined ? [] : [billOfMaterialsSeconds]
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to collect frames",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
