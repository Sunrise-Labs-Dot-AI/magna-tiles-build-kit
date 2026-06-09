import { NextResponse } from "next/server";
import { generateBuild } from "@/lib/magnetic-tiles/generate";
import type { InventoryPreset } from "@/lib/magnetic-tiles/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      prompt?: unknown;
      inventoryPreset?: unknown;
    };
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const inventoryPreset =
      body.inventoryPreset === "classic-100" || body.inventoryPreset === "builder-xl"
        ? (body.inventoryPreset as InventoryPreset)
        : "classic-100";

    return NextResponse.json(generateBuild(prompt, inventoryPreset));
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to generate build",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
