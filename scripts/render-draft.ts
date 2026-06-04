import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { chromium, type Page } from "playwright";
import { BUILD_LIBRARY } from "../lib/magnetic-tiles/library";

const ROOT = process.cwd();
const OUTPUT_ROOT = join(ROOT, "verification");
const BASE_URL = process.env.RENDER_DRAFT_BASE_URL ?? "http://127.0.0.1:3211";
const SHOULD_START_SERVER = !process.env.RENDER_DRAFT_BASE_URL;

interface CameraView {
  name: "side" | "front" | "top" | "iso";
  azimuth: number;
  elevation: number;
  distScale: number;
}

const FINAL_VIEWS: CameraView[] = [
  { name: "side", azimuth: 90, elevation: 0, distScale: 1.5 }, // looking along Z axis
  { name: "front", azimuth: 0, elevation: 0, distScale: 1.5 }, // looking along X axis
  { name: "top", azimuth: 0, elevation: 90, distScale: 1.5 }, // looking down Y axis
  { name: "iso", azimuth: 45, elevation: 35, distScale: 1.8 } // 3/4 isometric
];

async function main() {
  const id = process.argv[2];
  if (!id) {
    throw new Error("Usage: tsx scripts/render-draft.ts <library-build-id>");
  }

  const item = BUILD_LIBRARY.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown library build id: ${id}`);
  }

  let server: ChildProcessWithoutNullStreams | null = null;
  if (SHOULD_START_SERVER) {
    server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", "3211"], {
      cwd: ROOT,
      env: { ...process.env, PORT: "3211" },
      stdio: "pipe"
    });
    await waitForServer(BASE_URL, server);
  }

  const directory = join(OUTPUT_ROOT, id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await captureLibraryBuild(page, item.title, directory);
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }

  console.log(`Rendered ${id} to ${relative(ROOT, directory)}`);
}

async function captureLibraryBuild(page: Page, title: string, directory: string) {
  await loadLibraryBuild(page, title);

  for (const view of FINAL_VIEWS) {
    await setCameraView(page, view);
    await settleCanvas(page);
    await screenshotCanvas(page, directory, view.name);
  }

  const stepCount = await readStepCount(page);
  for (const step of Array.from({ length: stepCount }, (_, index) => index + 1)) {
    await page.getByLabel("Step preview").fill(String(step));
    await page.getByLabel("Step preview").dispatchEvent("input");
    await settleCanvas(page);
    await screenshotCanvas(page, directory, `step-${String(step).padStart(2, "0")}`);
  }
}

async function loadLibraryBuild(page: Page, title: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const libraryCard = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}`) });
  await libraryCard.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (cardTitle) => {
      const card = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.trim().startsWith(cardTitle)
      );
      return card instanceof HTMLButtonElement && !card.disabled;
    },
    title,
    { timeout: 30_000 }
  );
  await libraryCard.click();
  await waitForBuild(page, title);
}

async function waitForBuild(page: Page, title: string) {
  await page.locator(".viewer-title h2", { hasText: title }).waitFor({ timeout: 30_000 });
  await page.locator(".canvas-wrap canvas").waitFor({ timeout: 30_000 });
  await settleCanvas(page);
}

async function screenshotCanvas(page: Page, directory: string, label: string) {
  await page.locator(".canvas-wrap").screenshot({ path: join(directory, `${label}.png`) });
}

async function settleCanvas(page: Page) {
  await page.waitForTimeout(900);
}

/* HUMAN VERIFICATION:
   1. Start dev server: npm run dev
   2. Run: RENDER_DRAFT_BASE_URL=http://localhost:3000 npm run render:draft -- house
   3. Inspect verification/house/*.png
   Correct output: side.png shows true side profile (no top-down), front.png shows true front,
   top.png is a clean plan view, iso.png is a 3/4 diagonal. If any shot looks top-down or
   rotated wrong, check that window.__buildViewer is defined in browser console before capture.
*/
async function setCameraView(page: Page, view: CameraView) {
  const applied = await page.evaluate(
    ({ azimuth, elevation, distScale }) =>
      (window as Window & {
        __buildViewer?: { setCamera?: (azDeg: number, elDeg: number, distScale?: number) => boolean };
      }).__buildViewer?.setCamera?.(azimuth, elevation, distScale) === true,
    view
  );

  if (applied) return;

  console.warn("WARNING: __buildViewer handle missing — camera position unreliable");
  if (process.env.RENDER_DRAFT_ALLOW_CAMERA_FALLBACK === "1") {
    await fallbackCameraView(page, view);
    return;
  }

  throw new Error(
    `Unable to apply deterministic camera view "${view.name}". ` +
      "Set RENDER_DRAFT_ALLOW_CAMERA_FALLBACK=1 only for emergency manual fallback captures."
  );
}

async function fallbackCameraView(page: Page, view: CameraView) {
  console.warn(
    `WARNING: LAST RESORT orbit fallback engaged for "${view.name}" — camera position is not deterministic.`
  );
  const fallbackOrbit = {
    side: { dx: -170, dy: 180, wheel: -700 },
    front: { dx: -360, dy: 170, wheel: -700 },
    top: { dx: 0, dy: -260, wheel: -700 },
    iso: { dx: 0, dy: -70, wheel: -700 }
  } satisfies Record<CameraView["name"], { dx: number; dy: number; wheel: number }>;
  await orbitCanvas(page, fallbackOrbit[view.name].dx, fallbackOrbit[view.name].dy);
  await page.mouse.wheel(0, fallbackOrbit[view.name].wheel);
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
      throw new Error(`Next server exited before rendering started:\n${output}`);
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
