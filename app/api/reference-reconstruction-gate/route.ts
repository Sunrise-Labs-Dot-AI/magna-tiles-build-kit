import { NextResponse } from "next/server";
import { readBuildDraft } from "@/lib/builder/storage";
import { gateReconstruction } from "@/lib/reference-encoder/reconstruction";
import type { ReferenceBuildEncoding } from "@/lib/reference-encoder/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      draftId?: unknown;
      encoding?: ReferenceBuildEncoding;
    };
    const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
    if (!draftId) throw new Error("Choose a saved build draft to gate against.");
    if (!body.encoding || !Array.isArray(body.encoding.steps)) {
      throw new Error("An encoding with timeline steps is required.");
    }

    const draft = await readBuildDraft(draftId);
    const result = await gateReconstruction(draft, body.encoding);

    return NextResponse.json({ result, draftId, draftTitle: draft.title });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to gate reconstruction",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
