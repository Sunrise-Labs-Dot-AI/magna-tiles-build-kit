import { NextResponse } from "next/server";
import { generateGatedBuild } from "@/lib/magnetic-tiles/generate";
import type { InventoryPreset } from "@/lib/magnetic-tiles/types";

export const runtime = "nodejs";

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

    // The full physics gate runs on every generated build; an honest structured
    // failure (422) is returned when no deterministic template variant passes.
    const result = await generateGatedBuild(prompt, inventoryPreset);

    if (result.status === "failed") {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result);
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
