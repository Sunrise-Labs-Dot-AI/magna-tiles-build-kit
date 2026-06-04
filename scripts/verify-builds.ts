import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chromium, type Page } from "playwright";
import { loadAuthoredLibraryBuild } from "../lib/builder/library-build";
import { gateBuild } from "../lib/engine";
import { generateBuild } from "../lib/magnetic-tiles/generate";
import { BUILD_LIBRARY } from "../lib/magnetic-tiles/library";
import { tilesIntersectAsPrisms } from "../lib/magnetic-tiles/prism-geometry";
import type { TileInstance } from "../lib/magnetic-tiles/types";
import { isExpectedEngineFailure } from "../verification/engine-valid-builds";
import { VERIFICATION_PROMPTS } from "../verification/prompt-set";

const ROOT = process.cwd();
const OUTPUT_ROOT = join(ROOT, "verification");
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3210";
const SHOULD_START_SERVER = !process.env.VERIFY_BASE_URL;

interface CaptureRecord {
  id: string;
  title: string;
  prompt: string;
  kind: "library" | "prompt";
  screenshots: Array<{ label: string; path: string }>;
  statusText: string;
  stepText: string;
  validationStatus: string;
  rawOverlapCount: number;
  instructionStepCount: number;
  maxTileStep: number;
  engineGatePassed: boolean;
  engineGateReasons: string[];
  expectedEngineFailure: boolean;
  gateFailures: string[];
}

async function main() {
  let server: ChildProcessWithoutNullStreams | null = null;
  if (SHOULD_START_SERVER) {
    server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", "3210"], {
      cwd: ROOT,
      env: { ...process.env, PORT: "3210" },
      stdio: "pipe"
    });
    await waitForServer(BASE_URL, server);
  }

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await cleanGeneratedVerificationArtifacts();

  const browser = await chromium.launch({ headless: true });
  const records: CaptureRecord[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    for (const item of BUILD_LIBRARY) {
      records.push(await captureLibraryBuild(page, item.id, item.title, item.prompt));
    }

    for (const prompt of VERIFICATION_PROMPTS) {
      records.push(await capturePrompt(page, prompt.id, prompt.prompt));
    }
  } finally {
    await browser.close();
    if (server) {
      server.kill("SIGTERM");
    }
  }

  await writeContactSheet(records);
  const failures = records.flatMap((record) => record.gateFailures.map((failure) => `${record.id}: ${failure}`));
  if (failures.length > 0) {
    throw new Error(`Verification failed:\n${failures.join("\n")}`);
  }
  console.log(`Wrote ${records.length} verification records to ${relative(ROOT, OUTPUT_ROOT)}`);
}

async function captureLibraryBuild(page: Page, id: string, title: string, prompt: string): Promise<CaptureRecord> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}`) }).click();
  await waitForBuild(page, title);
  return captureCurrentBuild(page, { id, title, prompt, kind: "library", directory: join(OUTPUT_ROOT, id) });
}

async function capturePrompt(page: Page, id: string, prompt: string): Promise<CaptureRecord> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator("details.beta-card summary").click();
  await page.getByLabel("Experimental build prompt").fill(prompt);
  await page.getByRole("button", { name: /Draft build|Generating/ }).click();
  await waitForBuild(page);
  const title = await page.locator(".viewer-title h2").first().innerText();
  return captureCurrentBuild(page, { id, title, prompt, kind: "prompt", directory: join(OUTPUT_ROOT, "prompts", id) });
}

async function captureCurrentBuild(
  page: Page,
  target: { id: string; title: string; prompt: string; kind: "library" | "prompt"; directory: string }
): Promise<CaptureRecord> {
  await mkdir(target.directory, { recursive: true });
  await settleCanvas(page);

  const screenshots: CaptureRecord["screenshots"] = [];
  screenshots.push(await screenshotCanvas(page, target.directory, "final-default"));

  await orbitCanvas(page, 260, 0);
  await settleCanvas(page);
  screenshots.push(await screenshotCanvas(page, target.directory, "final-side"));

  await orbitCanvas(page, -130, -120);
  await settleCanvas(page);
  screenshots.push(await screenshotCanvas(page, target.directory, "final-high"));

  const stepCount = await readStepCount(page);
  for (const step of Array.from({ length: stepCount }, (_, index) => index + 1)) {
    await page.getByLabel("Step preview").fill(String(step));
    await page.getByLabel("Step preview").dispatchEvent("input");
    await settleCanvas(page);
    screenshots.push(await screenshotCanvas(page, target.directory, `step-${String(step).padStart(2, "0")}`));
  }

  const statusText = await page.locator(".viewer-header .pill").first().innerText();
  const stepText = await page.locator(".steps-list").first().innerText();
  const gate = await evaluateBuildGate(target);

  return {
    id: target.id,
    title: target.title,
    prompt: target.prompt,
    kind: target.kind,
    screenshots,
    statusText,
    stepText,
    ...gate
  };
}

async function evaluateBuildGate(target: { id: string; prompt: string; kind: "library" | "prompt" }) {
  const result = target.kind === "library" ? await loadAuthoredLibraryBuild(target.id) : generateBuild(target.prompt);
  const rawOverlapCount = countRawOverlaps(result.build.tiles);
  const maxTileStep = Math.max(...result.build.tiles.map((tile) => tile.step));
  const instructionSteps = result.instructions.map((instruction) => instruction.step);
  const instructionStepCount = result.instructions.length;
  const gateFailures: string[] = [];
  const engineGate = await gateBuild(result.build);
  const expectedEngineFailure = isExpectedEngineFailure(target.kind, target.id);

  if (instructionStepCount !== maxTileStep) {
    const finding = `instruction step count ${instructionStepCount} does not match max tile step ${maxTileStep}`;
    if (expectedEngineFailure) engineGate.reasons.push(`expected-fail advisory: ${finding}`);
    else gateFailures.push(finding);
  }

  const expectedSteps = Array.from({ length: maxTileStep }, (_, index) => index + 1);
  if (instructionSteps.some((step, index) => step !== expectedSteps[index])) {
    const finding = `instruction steps are ${instructionSteps.join(", ")} but expected ${expectedSteps.join(", ")}`;
    if (expectedEngineFailure) engineGate.reasons.push(`expected-fail advisory: ${finding}`);
    else gateFailures.push(finding);
  }

  if (!engineGate.passed && !expectedEngineFailure) {
    gateFailures.push(`gateBuild failed: ${engineGate.reasons.join("; ")}`);
  }

  if (engineGate.passed && expectedEngineFailure) {
    gateFailures.push("gateBuild unexpectedly passed for an expected-fail build; update the engine-valid set");
  }

  return {
    validationStatus: result.validation.status,
    rawOverlapCount,
    instructionStepCount,
    maxTileStep,
    engineGatePassed: engineGate.passed,
    engineGateReasons: engineGate.reasons,
    expectedEngineFailure,
    gateFailures
  };
}

function countRawOverlaps(tiles: TileInstance[]) {
  let count = 0;
  for (let firstIndex = 0; firstIndex < tiles.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < tiles.length; secondIndex += 1) {
      const intersection = tilesIntersectAsPrisms(tiles[firstIndex], tiles[secondIndex]);
      if (intersection.overlaps && intersection.penetration > 0.03) count += 1;
    }
  }
  return count;
}

async function screenshotCanvas(page: Page, directory: string, label: string) {
  const path = join(directory, `${label}.png`);
  await page.locator(".canvas-wrap").screenshot({ path });
  return { label, path };
}

async function waitForBuild(page: Page, title?: string) {
  if (title) {
    await page.locator(".viewer-title h2", { hasText: title }).waitFor({ timeout: 30_000 });
  } else {
    await page.locator(".viewer-title h2").waitFor({ timeout: 30_000 });
  }
  await page.locator(".canvas-wrap canvas").waitFor({ timeout: 30_000 });
  await settleCanvas(page);
}

async function settleCanvas(page: Page) {
  await page.waitForTimeout(900);
}

async function readStepCount(page: Page) {
  const text = await page.locator(".viewer-footer .muted").first().innerText();
  const match = text.match(/\/(\d+)/);
  return match ? Number(match[1]) : 1;
}

async function orbitCanvas(page: Page, dx: number, dy: number) {
  const box = await page.locator(".canvas-wrap canvas").boundingBox();
  if (!box) return;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
  await page.mouse.up();
}

async function writeContactSheet(records: CaptureRecord[]) {
  const lines = [
    "# Verification Contact Sheet",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This sheet is generated by `npm run verify:builds`. Each build includes final multi-angle renders and per-step screenshots captured from the running app.",
    ""
  ];

  for (const record of records) {
    lines.push(`## ${record.title} (${record.kind})`);
    lines.push("");
    lines.push(`- Prompt: ${record.prompt}`);
    lines.push(`- UI status: ${record.statusText}`);
    lines.push(`- Validation status: ${record.validationStatus}`);
    lines.push(`- Raw overlaps: ${record.rawOverlapCount}`);
    lines.push(`- Instruction steps: ${record.instructionStepCount} / max tile step ${record.maxTileStep}`);
    lines.push(`- Engine gate: ${record.engineGatePassed ? "pass" : record.expectedEngineFailure ? "expected-fail" : "fail"}`);
    lines.push(`- Gate reasons: ${record.engineGateReasons.join("; ")}`);
    lines.push(`- Harness gate: ${record.gateFailures.length === 0 ? "pass" : record.gateFailures.join("; ")}`);
    lines.push("");
    for (const shot of record.screenshots) {
      lines.push(`### ${shot.label}`);
      lines.push("");
      lines.push(`![${record.id} ${shot.label}](${relative(OUTPUT_ROOT, shot.path)})`);
      lines.push("");
    }
    lines.push("<details>");
    lines.push("<summary>Instruction text captured during verification</summary>");
    lines.push("");
    lines.push("```text");
    lines.push(record.stepText);
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  await writeFile(join(OUTPUT_ROOT, "contact-sheet.md"), `${lines.join("\n")}\n`);
}

async function cleanGeneratedVerificationArtifacts() {
  await Promise.all([
    ...BUILD_LIBRARY.map((item) => rm(join(OUTPUT_ROOT, item.id), { recursive: true, force: true })),
    rm(join(OUTPUT_ROOT, "prompts"), { recursive: true, force: true }),
    rm(join(OUTPUT_ROOT, "contact-sheet.md"), { force: true })
  ]);
}

async function waitForServer(url: string, processHandle: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let output = "";
  processHandle.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  processHandle.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  while (Date.now() - startedAt < 30_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Next server exited before verification started:\n${output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}:\n${output}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
