import { NextResponse } from "next/server";
import { designBuild } from "@/lib/planner/design";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 4096)
      return NextResponse.json(
        { error: "Request is too large." },
        { status: 413 },
      );
    const body = JSON.parse(text) as {
      prompt?: unknown;
      inventoryPreset?: unknown;
    };
    if (typeof body.prompt !== "string")
      return NextResponse.json(
        { error: "A build prompt is required." },
        { status: 400 },
      );
    const result = await designBuild(
      body.prompt,
      body.inventoryPreset === "builder-xl" ? "builder-xl" : "classic-100",
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to design this build.",
      },
      { status: 400 },
    );
  }
}
