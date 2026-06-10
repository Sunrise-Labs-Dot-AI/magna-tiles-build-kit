/**
 * Live "feel" verification for the /builder experience, run against a dev server:
 *
 *   npm run dev -- -p 3201        # in one terminal
 *   npx tsx scripts/verify-feel.ts # in another
 *
 * Flows verified (screenshots land in verification/feel/):
 *  a. Hover stability: hovering near a magnet for 2s (with human-like micro-jitter)
 *     mounts the snap ghost exactly once — the flicker regression guard, asserted via
 *     the dev-only window.__ghostStats counters.
 *  b. Free root orientation: the first tile is placed STANDING at +90° (default fold).
 *  c. Snap placement: a second tile snap-places onto a magnet point.
 *  d. Physics sandbox: Castle (gate-valid) stays put during Shake test; a lone leaning
 *     tile visibly falls. The sandbox settles in place (drop:false), so what simulates
 *     is what was built.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.FEEL_BASE_URL ?? "http://localhost:3201";
const OUTPUT_DIR = join(process.cwd(), "verification", "feel");

type GhostStats = { snapMounts: number; snapUnmounts: number; handMounts: number; handUnmounts: number };
type ProbeTile = {
  id: string;
  shape: string;
  position: { x: number; y: number; z: number };
  basis: { xAxis: Vec3; yAxis: Vec3; zAxis: Vec3 } | null;
};
type Vec3 = { x: number; y: number; z: number };
type ScreenPoint = { tileId: string; edge: number; magnetIndex: number | null; x: number; y: number };

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

  try {
    await page.goto(`${BASE_URL}/builder`, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas", { timeout: 30_000 });
    await page.waitForFunction(
      () => Boolean((window as Window & { __builderProbe?: unknown }).__builderProbe),
      undefined,
      { timeout: 30_000 }
    );
    // Let the canvas settle (camera rig, first frames).
    await page.waitForTimeout(1200);

    await flowRootStanding(page);
    await flowHoverStability(page);
    await flowSnapPlace(page);
    await flowCastleShake(page);
    await flowUnstableFalls(page);
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`verify-feel: ${failures.length} check(s) failed:`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  console.log("verify-feel: all checks passed.");
}

/** Flow (b): the first tile places standing on its edge at the default +90° fold. */
async function flowRootStanding(page: Page) {
  // Aim at open ground left of center so the root doesn't sit under later UI.
  await page.mouse.move(640, 520, { steps: 8 });
  await page.waitForTimeout(250);
  await page.mouse.move(660, 530, { steps: 4 });
  await page.waitForTimeout(250);
  await clickHere(page);
  await page.waitForTimeout(400);

  const tiles = await probeTiles(page);
  check("root tile placed on first click", tiles.length === 1, `tiles=${tiles.length}`);
  const root = tiles[0];
  const standing = root?.basis ? Math.abs(root.basis.zAxis.y) < 0.01 : false;
  check("root tile is STANDING (normal horizontal at +90°)", standing, `zAxis.y=${root?.basis?.zAxis.y}`);
  check("root center is half an edge up", Math.abs((root?.position.y ?? 0) - 1.5) < 0.01, `y=${root?.position.y}`);

  const gateText = await page.locator(".play-gate-pill").innerText().catch(() => "?");
  console.log(`       gate pill after lone standing tile: "${gateText.trim()}" (honest report, placement not blocked)`);
  await page.screenshot({ path: join(OUTPUT_DIR, "root-standing.png") });
}

/** Flow (a): steady hover near a magnet for 2s mounts the snap ghost exactly once. */
async function flowHoverStability(page: Page) {
  const target = await pickSnapTarget(page);
  check("found an on-screen magnet snap point", Boolean(target));
  if (!target) return;

  // Travel to the magnet (the approach may legitimately sweep past other snap points),
  // then measure the steady-hover window: once acquired, the ghost must mount exactly
  // once and never unmount, no matter how much the hand micro-jitters on the spot.
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.waitForTimeout(300);
  const before = await ghostStats(page);
  check(
    "snap ghost is live after arriving at the magnet",
    before.snapMounts - before.snapUnmounts === 1,
    `mounted=${before.snapMounts - before.snapUnmounts}`
  );

  // 2 seconds of human-like micro-jitter around the magnet: the old enter/leave model
  // thrashed under exactly this input.
  const startedAt = Date.now();
  let phase = 0;
  while (Date.now() - startedAt < 2000) {
    phase += 1;
    await page.mouse.move(target.x + Math.sin(phase) * 2, target.y + Math.cos(phase) * 2);
    await page.waitForTimeout(120);
  }
  const after = await ghostStats(page);
  const mounts = after.snapMounts - before.snapMounts;
  const unmounts = after.snapUnmounts - before.snapUnmounts;
  check("snap ghost mounted exactly once across the 2s hover (no remounts)", mounts === 0, `extra mounts=${mounts}`);
  check("snap ghost never unmounted during 2s hover", unmounts === 0, `unmounts=${unmounts}`);
  check(
    "snap ghost still live after the 2s hover",
    after.snapMounts - after.snapUnmounts === 1,
    `mounted=${after.snapMounts - after.snapUnmounts}`
  );
  await page.screenshot({ path: join(OUTPUT_DIR, "ghost-stable.png") });
}

/** Flow (c): click while snapped places the second tile through the edge-attachment API. */
async function flowSnapPlace(page: Page) {
  await clickHere(page);
  await page.waitForTimeout(400);
  const tiles = await probeTiles(page);
  check("second tile snap-placed onto the magnet", tiles.length === 2, `tiles=${tiles.length}`);
  await page.screenshot({ path: join(OUTPUT_DIR, "snap-placed.png") });
}

/** Flow (d1): a gate-valid build (Castle) visibly stays put during Shake test. */
async function flowCastleShake(page: Page) {
  await page.getByRole("button", { name: "Builds" }).click();
  await page.getByRole("button", { name: "Castle", exact: true }).click();
  await page.waitForFunction(
    () =>
      ((window as Window & { __builderProbe?: { tiles: () => unknown[] } }).__builderProbe?.tiles()
        .length ?? 0) > 2,
    undefined,
    { timeout: 30_000 }
  );
  // Wait for the gate verdict so we know the build is the gate-valid Castle.
  await page.waitForFunction(
    () => {
      const pill = document.querySelector(".play-gate-pill");
      return pill ? !/checking/i.test(pill.textContent ?? "") : false;
    },
    undefined,
    { timeout: 30_000 }
  );
  const gateText = (await page.locator(".play-gate-pill").innerText()).trim();
  console.log(`       castle gate pill: "${gateText}"`);
  await page.screenshot({ path: join(OUTPUT_DIR, "castle-before-shake.png") });

  await page.getByRole("button", { name: "Shake test" }).click();
  await page.waitForTimeout(4000);
  const drift = await readDrift(page);
  check("castle stays in place during Shake test (settle-in-place sandbox)", drift !== null && drift < 0.8, `drift=${drift}`);
  await page.screenshot({ path: join(OUTPUT_DIR, "castle-shake.png") });
  await page.getByRole("button", { name: "Rebuild" }).click();
  await page.waitForTimeout(400);
}

/** Flow (d2): a genuinely unstable build (lone leaning tile) visibly fails. */
async function flowUnstableFalls(page: Page) {
  await page.getByRole("button", { name: "Builds" }).click();
  await page.getByRole("button", { name: "+ New empty build" }).click();
  await page.waitForFunction(
    () =>
      ((window as Window & { __builderProbe?: { tiles: () => unknown[] } }).__builderProbe?.tiles()
        .length ?? -1) === 0,
    undefined,
    { timeout: 15_000 }
  );

  // Tilt the held tile to +45° (one Q step down from the +90° default) and place it.
  await page.mouse.move(720, 520, { steps: 6 });
  await page.keyboard.press("q");
  await page.waitForTimeout(200);
  await page.mouse.move(700, 510, { steps: 4 });
  await page.waitForTimeout(200);
  await clickHere(page);
  await page.waitForTimeout(400);
  const tiles = await probeTiles(page);
  check("lone leaning tile placed (placement is not pre-gated)", tiles.length === 1, `tiles=${tiles.length}`);
  await page.screenshot({ path: join(OUTPUT_DIR, "unstable-before-shake.png") });

  await page.getByRole("button", { name: "Shake test" }).click();
  await page.waitForTimeout(4000);
  const drift = await readDrift(page);
  check("lone leaning tile visibly falls during Shake test", drift !== null && drift > 0.8, `drift=${drift}`);
  await page.screenshot({ path: join(OUTPUT_DIR, "unstable-falls.png") });
  await page.getByRole("button", { name: "Rebuild" }).click();
}

/* ------------------------------------------------------------------ */

async function clickHere(page: Page) {
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}

/** The dev hooks installed by app/builder/page.tsx (dev builds only). */
type ProbeWindow = Window & {
  __ghostStats?: GhostStats;
  __builderProbe?: { tiles: () => ProbeTile[]; snapScreenPoints: () => ScreenPoint[] };
};

async function probeTiles(page: Page): Promise<ProbeTile[]> {
  return page.evaluate(() => (window as ProbeWindow).__builderProbe?.tiles() ?? []);
}

async function ghostStats(page: Page): Promise<GhostStats> {
  return page.evaluate(
    () =>
      (window as ProbeWindow).__ghostStats ?? {
        snapMounts: 0,
        snapUnmounts: 0,
        handMounts: 0,
        handUnmounts: 0
      }
  );
}

/** Pick a snap point that projects well inside the viewport, clear of the HUD. */
async function pickSnapTarget(page: Page): Promise<ScreenPoint | null> {
  const points = await page.evaluate(
    () => (window as ProbeWindow).__builderProbe?.snapScreenPoints() ?? []
  );
  const usable = points.filter(
    (point) => point.x > 120 && point.x < 1320 && point.y > 140 && point.y < 760 && point.magnetIndex !== null
  );
  if (usable.length === 0) return null;
  // Prefer the one closest to the screen center for a comfortable hover.
  usable.sort(
    (a, b) =>
      Math.hypot(a.x - 720, a.y - 480) - Math.hypot(b.x - 720, b.y - 480)
  );
  return usable[0];
}

async function readDrift(page: Page): Promise<number | null> {
  const text = await page.locator(".play-dock-readout").innerText().catch(() => null);
  if (!text) return null;
  const match = text.match(/drift\s+([\d.]+)/);
  return match ? Number(match[1]) : null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
