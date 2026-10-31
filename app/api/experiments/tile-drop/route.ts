import { NextResponse } from "next/server";
import { dropShapes, runTileDrop, type DropShape } from "@/lib/experiments/tile-drop";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 512) return NextResponse.json({ error: "Choose one tile shape." }, { status: 400 });
    const body = JSON.parse(text);
    if (!body || !dropShapes.includes(body.shape))
      return NextResponse.json({ error: "Choose a square, equilateral triangle or right triangle." }, { status: 400 });
    return NextResponse.json(await runTileDrop(body.shape as DropShape));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The experiment could not run." }, { status: 400 });
  }
}
