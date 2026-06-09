import { NextResponse } from "next/server";
import { readBuildDraft } from "@/lib/builder/storage";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const draft = await readBuildDraft(id);
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to load draft",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 404 }
    );
  }
}
