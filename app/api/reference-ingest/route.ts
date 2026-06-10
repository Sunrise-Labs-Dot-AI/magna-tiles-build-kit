import { NextResponse } from "next/server";
import { ingestReferenceVideo, timelineToPayload } from "@/lib/reference-encoder/ingest";

export const runtime = "nodejs";
// Local ingestion downloads the video with yt-dlp and runs ffmpeg extraction;
// give it room on first run (subsequent runs hit the .video-cache).
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown; force?: unknown };
    const url = typeof body.url === "string" ? body.url : "";
    const force = body.force === true;

    const timeline = await ingestReferenceVideo(url, { force });
    const payload = await timelineToPayload(timeline);
    const flagged = payload.steps.filter(
      (step) => !step.baseline && step.needsHumanReview
    ).length;
    const candidates = payload.steps.filter((step) => !step.baseline).length;

    return NextResponse.json({
      timeline: payload,
      note:
        `Measured ${candidates} candidate step(s) from ${payload.analysisFrameCount} frames at ${payload.analysisFps} fps` +
        `${flagged ? `; ${flagged} flagged for human review` : ""}. Evidence cached locally in .video-cache/${payload.videoId} (never committed).`
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to ingest reference video",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
