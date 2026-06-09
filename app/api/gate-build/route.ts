import { NextResponse } from "next/server";
import { draftToBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { gateBuild } from "@/lib/engine";
import type { BuildGraph } from "@/lib/magnetic-tiles/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { draft?: AuthoredBuildDraft; build?: BuildGraph };
    const build = payload.build ?? (payload.draft ? draftToBuildGraph(payload.draft) : null);
    if (!build) throw new Error("Build payload is required.");

    const gate = await gateBuild(build);
    return NextResponse.json({ gate });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to gate build",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
