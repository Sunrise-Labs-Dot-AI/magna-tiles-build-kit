import type { GeneratedBuildResponse } from "@/lib/magnetic-tiles/types";

export type BugReportSeverity = "bug" | "rough-edge" | "idea";

export interface BuildBugReportInput {
  prompt: string;
  currentStep: number;
  severity: BugReportSeverity;
  area: string;
  summary: string;
  details: string;
  expected?: string;
  actual?: string;
  result?: GeneratedBuildResponse | null;
}

export interface PreparedBugReport {
  filename: string;
  markdown: string;
}

export function prepareBugReport(input: BuildBugReportInput, now = new Date()): PreparedBugReport {
  const build = input.result?.build;
  const title = input.summary.trim() || "Untitled report";
  const slug = slugify(title).slice(0, 70) || "build-report";
  const timestamp = now.toISOString();
  const filename = `${timestamp.replaceAll(":", "-")}-${slug}.md`;
  const validationIssues = input.result?.validation.issues ?? [];

  return {
    filename,
    markdown: [
      "---",
      `createdAt: ${timestamp}`,
      `severity: ${input.severity}`,
      `area: ${quoteYaml(input.area)}`,
      `prompt: ${quoteYaml(input.prompt)}`,
      `buildId: ${quoteYaml(build?.id ?? "none")}`,
      `buildTitle: ${quoteYaml(build?.title ?? "none")}`,
      `currentStep: ${input.currentStep}`,
      "---",
      "",
      `# ${title}`,
      "",
      "## What I Saw",
      "",
      input.details.trim() || "_No details provided._",
      "",
      "## Expected",
      "",
      input.expected?.trim() || "_Not specified._",
      "",
      "## Actual",
      "",
      input.actual?.trim() || "_Not specified._",
      "",
      "## Build Context",
      "",
      `- Prompt: ${input.prompt || "_none_"}`,
      `- Current step: ${input.currentStep}`,
      `- Build: ${build?.title ?? "_none generated_"}`,
      `- Family: ${build?.family ?? "_none_"}`,
      `- Seed: ${build?.seed ?? "_none_"}`,
      `- Tiles: ${build?.tiles.length ?? 0}`,
      `- Connections: ${build?.connections.length ?? 0}`,
      `- Validation status: ${input.result?.validation.status ?? "_none_"}`,
      "",
      "## Validation Issues",
      "",
      validationIssues.length
        ? validationIssues
            .map(
              (issue) =>
                `- [${issue.severity}] ${issue.code}: ${issue.message} - ${issue.detail}`
            )
            .join("\n")
        : "_No validation issues captured._",
      "",
      "## Generated Build Snapshot",
      "",
      "```json",
      JSON.stringify(input.result ?? null, null, 2),
      "```",
      ""
    ].join("\n")
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
