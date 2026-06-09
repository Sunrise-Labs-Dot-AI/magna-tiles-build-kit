import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  prepareBugReport,
  type BuildBugReportInput
} from "@/lib/bug-reports";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BuildBugReportInput;
    if (!body.summary?.trim() || !body.details?.trim()) {
      return NextResponse.json(
        {
          error: "Missing report details",
          detail: "Add a short summary and what you saw before filing."
        },
        { status: 400 }
      );
    }

    const report = prepareBugReport({
      ...body,
      severity: isSeverity(body.severity) ? body.severity : "bug",
      area: typeof body.area === "string" ? body.area : "generated-build",
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      currentStep:
        typeof body.currentStep === "number" && Number.isFinite(body.currentStep)
          ? body.currentStep
          : 0
    });
    const directory = join(process.cwd(), "bug-reports");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, report.filename), report.markdown, "utf8");

    return NextResponse.json({
      filename: report.filename,
      path: `bug-reports/${report.filename}`
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to file report",
        detail: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}

function isSeverity(value: unknown): value is BuildBugReportInput["severity"] {
  return value === "bug" || value === "rough-edge" || value === "idea";
}
