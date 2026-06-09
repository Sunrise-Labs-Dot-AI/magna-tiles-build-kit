import { NextResponse } from "next/server";
import { loadAuthoredLibraryBuild } from "@/lib/builder/library-build";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      throw new Error("A library build id is required.");
    }
    const response = await loadAuthoredLibraryBuild(id);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to load library build",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
