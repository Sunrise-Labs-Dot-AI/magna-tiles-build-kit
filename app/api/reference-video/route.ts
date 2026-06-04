import { NextResponse } from "next/server";
import { fetchYouTubeReference } from "@/lib/reference-encoder/youtube";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url : "";
    const source = await fetchYouTubeReference(url);

    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to load reference video",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
