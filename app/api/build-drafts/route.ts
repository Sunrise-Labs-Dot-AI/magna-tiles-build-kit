import { NextResponse } from "next/server";
import { draftToBuildGraph } from "@/lib/builder/operations";
import { listBuildDrafts, saveBuildDraft, validateDraftShape } from "@/lib/builder/storage";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { gateBuild } from "@/lib/engine";

export const runtime = "nodejs";

export async function GET() {
  try {
    const drafts = await listBuildDrafts();
    return NextResponse.json({ drafts });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to list drafts",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const draft = (await request.json()) as AuthoredBuildDraft;
    validateDraftShape(draft);
    const gate = await gateBuild(draftToBuildGraph(draft));
    const saved = await saveBuildDraft({
      ...draft,
      status: gate.passed ? "engine-valid" : "engine-fail-pending-reauthoring"
    });
    return NextResponse.json({ draft: saved, gate });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to save draft",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
