import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";
import { sampleVideoFileFrameCandidates } from "@/lib/reference-encoder/frame-sampler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const tempDir = await mkdtemp(join(tmpdir(), "magnetic-tile-local-video-"));
  try {
    const formData = await request.formData();
    const file = formData.get("video");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "Missing video file",
          detail: "Choose a local video file before collecting frames."
        },
        { status: 400 }
      );
    }

    const candidateCount = parseNumberField(formData.get("candidateCount"), 24);
    const selectedCount = parseNumberField(formData.get("selectedCount"), 8);
    const introSkipSeconds = parseNumberField(formData.get("introSkipSeconds"), 0);
    const billOfMaterialsSeconds = parseOptionalNumberField(
      formData.get("billOfMaterialsSeconds")
    );
    const extension = extname(file.name) || ".mp4";
    const filePath = join(tempDir, `source${extension}`);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const result = await sampleVideoFileFrameCandidates(
      filePath,
      file.name,
      candidateCount,
      selectedCount,
      {
        startSeconds: introSkipSeconds,
        pinnedSeconds:
          billOfMaterialsSeconds === undefined ? [] : [billOfMaterialsSeconds]
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to collect local video frames",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function parseNumberField(value: FormDataEntryValue | null, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumberField(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
