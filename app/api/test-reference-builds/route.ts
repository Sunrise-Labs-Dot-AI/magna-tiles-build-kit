import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { runReferenceAcceptance } from "@/lib/reference-encoder/reference-acceptance";

export const runtime = "nodejs";

export async function POST() {
  try {
    const run = runReferenceAcceptance();
    const directory = join(process.cwd(), "bug-reports");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      run.reports.map((report) =>
        writeFile(join(directory, report.filename), report.markdown, "utf8")
      )
    );

    return NextResponse.json({
      cases: run.cases.length,
      gaps: run.gaps.length,
      reports: run.reports.map((report) => `bug-reports/${report.filename}`)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to test reference builds",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
