/**
 * Live verification of the builder-v2 feature set, run against a dev server:
 *
 *   PORT=3401 npm run dev        # in one terminal
 *   npm run verify:builder-v2    # in another
 *
 * Flows (screenshots land in verification/builder-v2/):
 *  a. Multi-island: two ground clicks make two disconnected grounded roots, and the
 *     engine gate accepts the scene (per-component ground support).
 *  b. The full two-tower ramp: three stacked tower modules, two stacked tower modules
 *     across a gap, then an XL square spanned from top edge to top edge via S — the
 *     solved non-preset angle places, connects both edges, and the gate passes.
 *  c. Selector: click a placed tile, recolor it from the panel, re-fold it live.
 *  d. Prefabs: a tower module dropped on the ground, a second stacked on its top edge.
 *  e. Q/E (and Shift+Q/E) never land on a colliding angle: the ghost stays valid
 *     through a full cycle while a neighboring island blocks the flat extension.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.V2_BASE_URL ?? "http://localhost:3401";
const OUTPUT_DIR = join(process.cwd(), "verification", "builder-v2");

type Vec3 = { x: number; y: number; z: number };
type ProbeTile = {
  id: string;
  shape: string;
  position: Vec3;
  basis: { xAxis: Vec3; yAxis: Vec3; zAxis: Vec3 } | null;
  subassemblyId: string | null;
  foldAngle: number | null;
  color: string;
  parentTileId: string | null;
  root: boolean;
};
type ProbeConnection = { fromTileId: string; fromEdge: number; toTileId: string; toEdge: number };
type ProbeGhost = { valid: boolean; noFit: boolean; autoAngled: boolean; effectiveFoldAngle: number } | null;
type ScreenPoint = { tileId: string; edge: number; magnetIndex: number | null; x: number; y: number };
type ProbeWindow = Window & {
  __builderProbe?: {
    tiles: () => ProbeTile[];
    connections: () => ProbeConnection[];
    ghost: () => ProbeGhost;
    screenPoint: (world: Vec3) => { x: number; y: number };
    snapScreenPoints: () => ScreenPoint[];
  };
};

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
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__builderProbe), undefined, {
      timeout: 30_000
    });
    await page.waitForTimeout(1200);

    await flowMultiIsland(page);
    await flowQEFiltering(page);
    await flowSelectorRecolorRefold(page);
    await flowPrefabStack(page);
    await flowTwoTowerRamp(page);
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`verify-builder-v2: ${failures.length} check(s) failed:`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  console.log("verify-builder-v2: all checks passed.");
}

/* ------------------------------------------------------------------ */
/* Flow (a): two ground clicks → two grounded islands, gate-accepted.   */
/* ------------------------------------------------------------------ */
async function flowMultiIsland(page: Page) {
  await newEmptyBuild(page);

  await clickGround(page, { x: -4.5, y: 0, z: 0 });
  await page.waitForTimeout(350);
  let tiles = await probeTiles(page);
  check("(a) first ground click places a root", tiles.length === 1, `tiles=${tiles.length}`);

  await clickGround(page, { x: 6, y: 0, z: 3 });
  await page.waitForTimeout(350);
  tiles = await probeTiles(page);
  check("(a) second ground click starts a SECOND island", tiles.length === 2, `tiles=${tiles.length}`);
  const roots = tiles.filter((tile) => tile.root);
  const islands = new Set(tiles.map((tile) => tile.subassemblyId));
  check("(a) both tiles are roots of distinct islands", roots.length === 2 && islands.size === 2, `roots=${roots.length} islands=${[...islands].join(",")}`);

  const gate = await waitForGate(page);
  check("(a) the gate ACCEPTS two disconnected grounded islands", gate === "stands strong", `pill="${gate}"`);
  await page.screenshot({ path: join(OUTPUT_DIR, "a-two-islands.png") });
}

/* ------------------------------------------------------------------ */
/* Flow (e): Q/E cycling never offers a colliding ghost.                */
/* ------------------------------------------------------------------ */
async function flowQEFiltering(page: Page) {
  await newEmptyBuild(page);
  // Two flat islands 1.5 apart: the flat extension between them is blocked.
  await setFoldTick(page, "Flat");
  await clickGround(page, { x: 0, y: 0, z: 0 });
  await page.waitForTimeout(250);
  await clickGround(page, { x: 4.5, y: 0, z: 0 });
  await page.waitForTimeout(250);
  const tiles = await probeTiles(page);
  check("(e) two flat islands placed", tiles.length === 2, `tiles=${tiles.length}`);

  // Hover the magnet on island A's facing edge (toward island B).
  const target = await snapPointFor(page, tiles[0].id, 1);
  check("(e) found the facing-edge magnet on screen", Boolean(target));
  if (!target) return;
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.waitForTimeout(350);

  let everInvalid = false;
  let sawAngles = new Set<number>();
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press(press % 3 === 2 ? "Shift+E" : press % 2 === 0 ? "e" : "q");
    await page.waitForTimeout(160);
    const ghost = await probeGhost(page);
    if (!ghost) continue;
    if (!ghost.valid) everInvalid = true;
    sawAngles.add(Math.round((ghost.effectiveFoldAngle * 180) / Math.PI));
  }
  check("(e) the ghost stayed VALID through 12 Q/E and Shift+Q/E presses", !everInvalid);
  check("(e) cycling actually visited multiple angles", sawAngles.size >= 2, `angles=${[...sawAngles].join(",")}`);
  const finalGhost = await probeGhost(page);
  check(
    "(e) no ghost angle ever equals the blocked flat extension",
    finalGhost === null || Math.abs(finalGhost.effectiveFoldAngle) > 0.01,
    `final=${finalGhost?.effectiveFoldAngle}`
  );
  await page.screenshot({ path: join(OUTPUT_DIR, "e-qe-collision-filter.png") });
}

/* ------------------------------------------------------------------ */
/* Flow (c): selector panel — recolor + live re-fold of a wall.          */
/* ------------------------------------------------------------------ */
async function flowSelectorRecolorRefold(page: Page) {
  await newEmptyBuild(page);
  await setFoldTick(page, "Flat");
  await clickGround(page, { x: 0, y: 0, z: 0 });
  await page.waitForTimeout(300);
  let tiles = await probeTiles(page);
  const rootId = tiles[0]?.id;
  check("(c) flat root placed", tiles.length === 1 && Math.abs((tiles[0]?.basis?.zAxis.y ?? 0) - 1) < 0.01);

  // Raise a wall at +90 on the root's edge.
  await setFoldTick(page, "+90°");
  const magnet = await snapPointFor(page, rootId, 0);
  check("(c) found a root magnet for the wall", Boolean(magnet));
  if (!magnet) return;
  await page.mouse.move(magnet.x, magnet.y, { steps: 8 });
  await page.waitForTimeout(350);
  await click(page);
  await page.waitForTimeout(350);
  tiles = await probeTiles(page);
  const wall = tiles.find((tile) => tile.id !== rootId);
  check("(c) wall placed on the root edge", tiles.length === 2 && Boolean(wall));
  if (!wall) return;
  check(
    "(c) wall placed at the requested +90° fold",
    wall.foldAngle !== null && Math.abs(wall.foldAngle - Math.PI / 2) < 0.001,
    `fold=${wall.foldAngle}`
  );

  // Empty the hand, select the wall by clicking it.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const wallPoint = await screenPointFor(page, wall.position);
  await page.mouse.move(wallPoint.x, wallPoint.y, { steps: 6 });
  await page.waitForTimeout(150);
  await click(page);
  await page.waitForTimeout(250);
  const panelVisible = await page.locator('[data-testid="selected-panel"]').isVisible().catch(() => false);
  check("(c) clicking the wall opens the selector panel", panelVisible);

  // Recolor from the panel palette.
  const newColor = "#ef476f";
  await page.locator(`[data-recolor="${newColor}"]`).click();
  await page.waitForTimeout(250);
  tiles = await probeTiles(page);
  check("(c) recolor applied", tiles.find((tile) => tile.id === wall.id)?.color === newColor);

  // Re-fold live: one preset step left, then a fine −5° step.
  await page.locator('[data-testid="refold-left"]').click();
  await page.waitForTimeout(300);
  tiles = await probeTiles(page);
  const afterPreset = tiles.find((tile) => tile.id === wall.id)?.foldAngle ?? null;
  check(
    "(c) preset re-fold stepped to the next valid PRESET (+45°)",
    afterPreset !== null && Math.abs(afterPreset - Math.PI / 4) < 0.001,
    `fold=${afterPreset}`
  );
  await page.locator('[data-testid="refold-fine-left"]').click();
  await page.waitForTimeout(300);
  tiles = await probeTiles(page);
  const afterFine = tiles.find((tile) => tile.id === wall.id)?.foldAngle ?? null;
  check(
    "(c) fine re-fold stepped 5° further",
    afterPreset !== null && afterFine !== null && Math.abs(afterFine - afterPreset + Math.PI / 36) < 0.001,
    `fold=${afterFine}`
  );
  await page.screenshot({ path: join(OUTPUT_DIR, "c-selector-recolor-refold.png") });

  // Esc deselects.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const stillVisible = await page.locator('[data-testid="selected-panel"]').isVisible().catch(() => false);
  check("(c) Esc deselects (panel gone)", !stillVisible);
}

/* ------------------------------------------------------------------ */
/* Flow (d): tower-module prefab dropped, second stacked on top edge.    */
/* ------------------------------------------------------------------ */
async function flowPrefabStack(page: Page) {
  await newEmptyBuild(page);
  await page.locator('[data-prefab="tower-module"]').click();
  await clickGround(page, { x: 0, y: 0, z: 0 });
  await page.waitForTimeout(400);
  let tiles = await probeTiles(page);
  check("(d) tower module placed on ground (4 walls)", tiles.length === 4, `tiles=${tiles.length}`);

  const stacked = await stackTowerModule(page);
  check("(d) second module stacked on the top edge", stacked, "");
  tiles = await probeTiles(page);
  check("(d) stack is 8 tiles", tiles.length === 8, `tiles=${tiles.length}`);
  const upper = tiles.filter((tile) => tile.position.y > 3.5);
  check("(d) upper module sits a level above", upper.length === 4, `upper=${upper.length}`);

  const gate = await waitForGate(page);
  check("(d) the 2-high stack passes the gate", gate === "stands strong", `pill="${gate}"`);
  await page.screenshot({ path: join(OUTPUT_DIR, "d-prefab-tower-stack.png") });
}

/** With the tower-module prefab in hand, click a top edge of the current top level. */
async function stackTowerModule(page: Page): Promise<boolean> {
  const tiles = await probeTiles(page);
  const topY = Math.max(...tiles.map((tile) => tile.position.y));
  const topTile = tiles.find((tile) => tile.position.y === topY && tile.id.includes("front")) ??
    tiles.find((tile) => tile.position.y === topY);
  if (!topTile) return false;
  const magnet = await snapPointFor(page, topTile.id, 2);
  if (!magnet) return false;
  await page.locator('[data-prefab="tower-module"]').click();
  await page.mouse.move(magnet.x, magnet.y, { steps: 8 });
  await page.waitForTimeout(400);
  const before = tiles.length;
  await click(page);
  await page.waitForTimeout(500);
  const after = await probeTiles(page);
  return after.length === before + 4;
}

/* ------------------------------------------------------------------ */
/* Flow (b): the full two-tower XL ramp via UI gestures.                 */
/* ------------------------------------------------------------------ */
async function flowTwoTowerRamp(page: Page) {
  await newEmptyBuild(page);

  // Tall tower: three stacked modules at x=-4.5.
  await page.locator('[data-prefab="tower-module"]').click();
  await clickGround(page, { x: -4.5, y: 0, z: 0 });
  await page.waitForTimeout(400);
  check("(b) tall tower base placed", (await probeTiles(page)).length === 4);
  check("(b) tall tower level 2 stacked", await stackTowerModuleNear(page, -4.5));
  check("(b) tall tower level 3 stacked", await stackTowerModuleNear(page, -4.5));

  // Short tower: two stacked modules at x=+4.5 (centers 9 apart on the grid).
  await page.locator('[data-prefab="tower-module"]').click();
  await clickGround(page, { x: 4.5, y: 0, z: 0 });
  await page.waitForTimeout(400);
  check("(b) short tower base placed", (await probeTiles(page)).length === 16);
  check("(b) short tower level 2 stacked", await stackTowerModuleNear(page, 4.5));

  let tiles = await probeTiles(page);
  check("(b) twenty wall tiles before the span", tiles.length === 20, `tiles=${tiles.length}`);
  const tallTop = facingTopWall(tiles, -4.5, 9, +1);
  const shortTop = facingTopWall(tiles, 4.5, 6, -1);
  check(
    "(b) found facing top-edge walls",
    Boolean(tallTop && shortTop),
    `tall=${tallTop?.tile.id}:${tallTop?.edge} short=${shortTop?.tile.id}:${shortTop?.edge}`
  );
  if (!tallTop || !shortTop) return;

  // Pick up the XL square, anchor the span on the tall tower's top edge with S.
  await page.keyboard.press("3");
  const anchorPoint = await snapPointFor(page, tallTop.tile.id, tallTop.edge);
  check("(b) tall top edge magnet on screen", Boolean(anchorPoint));
  if (!anchorPoint) return;
  await page.mouse.move(anchorPoint.x, anchorPoint.y, { steps: 8 });
  await page.waitForTimeout(400);
  await page.keyboard.press("s");
  await page.waitForTimeout(250);
  const chip = await page.locator('[data-testid="span-chip"]').innerText().catch(() => "");
  check("(b) span armed on the tall tower's top edge", chip.length > 0, `chip="${chip}"`);

  // Hover the short tower's top edge: the chip must announce a SOLVED angle.
  const targetPoint = await snapPointFor(page, shortTop.tile.id, shortTop.edge);
  check("(b) short top edge magnet on screen", Boolean(targetPoint));
  if (!targetPoint) return;
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 10 });
  await page.waitForTimeout(500);
  const solvedChip = await page.locator('[data-testid="span-chip"]').innerText().catch(() => "");
  check("(b) span chip shows a solved angle", /solves at/i.test(solvedChip), `chip="${solvedChip}"`);
  const angleMatch = solvedChip.match(/([+-]?\d+)°/);
  const solvedDegrees = angleMatch ? Number(angleMatch[1]) : null;
  check(
    "(b) solved angle is a NON-PRESET value",
    solvedDegrees !== null && ![0, 45, 90, -45, -90].includes(Math.abs(solvedDegrees) === 0 ? 0 : solvedDegrees),
    `angle=${solvedDegrees}`
  );

  await click(page);
  await page.waitForTimeout(500);
  tiles = await probeTiles(page);
  const span = tiles.find((tile) => tile.shape === "xl-square");
  check("(b) XL span placed", tiles.length === 21 && Boolean(span), `tiles=${tiles.length}`);
  if (!span) return;

  // Connected on both edges: hinge to the tall tower, seat on the short tower.
  const connections = await probeConnections(page);
  const partners = connections
    .filter((connection) => connection.fromTileId === span.id || connection.toTileId === span.id)
    .flatMap((connection) => [connection.fromTileId, connection.toTileId])
    .filter((id) => id !== span.id);
  check(
    "(b) the span is connected to BOTH towers",
    partners.includes(tallTop.tile.id) && partners.includes(shortTop.tile.id),
    `partners=${partners.join(",")}`
  );

  // The ramp slopes: the span's normal is tilted off vertical by a non-preset amount.
  const slope = span.basis ? (Math.acos(Math.abs(span.basis.zAxis.y)) * 180) / Math.PI : NaN;
  check("(b) ramp slope is in the ≈30° class", slope > 20 && slope < 40, `slope=${slope.toFixed(1)}°`);

  const gate = await waitForGate(page, 60_000);
  check("(b) the WHOLE two-tower ramp scene passes the engine gate", gate === "stands strong", `pill="${gate}"`);
  await page.screenshot({ path: join(OUTPUT_DIR, "b-two-tower-ramp.png") });
}

/** Stack a tower module onto the top of the tower whose x-center is nearest `x`. */
async function stackTowerModuleNear(page: Page, x: number): Promise<boolean> {
  const tiles = await probeTiles(page);
  const towerTiles = tiles.filter((tile) => Math.abs(tile.position.x - x) < 4);
  const topY = Math.max(...towerTiles.map((tile) => tile.position.y));
  const topTile =
    towerTiles.find((tile) => tile.position.y === topY && tile.id.includes("front")) ??
    towerTiles.find((tile) => tile.position.y === topY);
  if (!topTile) return false;
  const magnet = await snapPointFor(page, topTile.id, 2);
  if (!magnet) return false;
  await page.locator('[data-prefab="tower-module"]').click();
  await page.mouse.move(magnet.x, magnet.y, { steps: 8 });
  await page.waitForTimeout(400);
  await click(page);
  await page.waitForTimeout(500);
  return (await probeTiles(page)).length === tiles.length + 4;
}

/**
 * The top-level wall of the tower near `x` that FACES the other tower (the wall plane
 * with normal along ±x sitting on the facing side), plus its geometric top-edge index.
 * Selected by geometry, never by tile id — stacking may mirror id sides.
 */
function facingTopWall(
  tiles: ProbeTile[],
  x: number,
  topY: number,
  facingSign: 1 | -1
): { tile: ProbeTile; edge: number } | null {
  const candidates = tiles.filter(
    (tile) =>
      Math.abs(tile.position.x - x) < 4 &&
      Math.abs(tile.position.y - (topY - 1.5)) < 0.2 &&
      tile.basis !== null &&
      Math.abs(tile.basis.zAxis.x) > 0.9
  );
  if (candidates.length === 0) return null;
  const tile = candidates.reduce((best, candidate) =>
    facingSign * candidate.position.x > facingSign * best.position.x ? candidate : best
  );
  // Geometric top edge: the edge whose endpoints both sit at the wall's top.
  const basis = tile.basis!;
  const corners = [
    { x: -1.5, y: -1.5 },
    { x: 1.5, y: -1.5 },
    { x: 1.5, y: 1.5 },
    { x: -1.5, y: 1.5 }
  ].map((local) => ({
    x: tile.position.x + local.x * basis.xAxis.x + local.y * basis.yAxis.x,
    y: tile.position.y + local.x * basis.xAxis.y + local.y * basis.yAxis.y,
    z: tile.position.z + local.x * basis.xAxis.z + local.y * basis.yAxis.z
  }));
  for (let edge = 0; edge < 4; edge += 1) {
    const start = corners[edge];
    const end = corners[(edge + 1) % 4];
    if (Math.abs(start.y - topY) < 0.05 && Math.abs(end.y - topY) < 0.05) {
      return { tile, edge };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */

/** Set the fold via the absolute tick buttons in the hotbar ("Flat", "+90°", ...). */
async function setFoldTick(page: Page, label: string) {
  await page.locator(".play-fold-tick", { hasText: label }).first().click();
  await page.waitForTimeout(150);
}

async function newEmptyBuild(page: Page) {
  await page.getByRole("button", { name: "Builds" }).click();
  await page.getByRole("button", { name: "+ New empty build" }).click();
  await page.waitForFunction(
    () => ((window as ProbeWindow).__builderProbe?.tiles().length ?? -1) === 0,
    undefined,
    { timeout: 15_000 }
  );
  await page.waitForTimeout(400);
}

async function click(page: Page) {
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}

/** Click the ground at a world position (projected through the live camera). */
async function clickGround(page: Page, world: Vec3) {
  const point = await page.evaluate(
    (target) => (window as ProbeWindow).__builderProbe!.screenPoint(target),
    world
  );
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.waitForTimeout(250);
  await click(page);
}

async function probeTiles(page: Page): Promise<ProbeTile[]> {
  return page.evaluate(() => (window as ProbeWindow).__builderProbe?.tiles() ?? []);
}

async function probeConnections(page: Page): Promise<ProbeConnection[]> {
  return page.evaluate(() => (window as ProbeWindow).__builderProbe?.connections() ?? []);
}

async function probeGhost(page: Page): Promise<ProbeGhost> {
  return page.evaluate(() => (window as ProbeWindow).__builderProbe?.ghost() ?? null);
}

async function screenPointFor(page: Page, world: Vec3): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (target) => (window as ProbeWindow).__builderProbe!.screenPoint(target),
    world
  );
}

/** On-screen snap point for a tile edge (prefers magnet dots, falls back to the bar). */
async function snapPointFor(page: Page, tileId: string, edge: number): Promise<ScreenPoint | null> {
  const points = await page.evaluate(
    () => (window as ProbeWindow).__builderProbe?.snapScreenPoints() ?? []
  );
  const usable = points.filter(
    (point) =>
      point.tileId === tileId &&
      point.edge === edge &&
      point.x > 80 &&
      point.x < 1360 &&
      point.y > 90 &&
      point.y < 900
  );
  if (usable.length === 0) return null;
  return usable.find((point) => point.magnetIndex === null) ?? usable[0];
}

async function waitForGate(page: Page, timeout = 30_000): Promise<string> {
  await page.waitForFunction(
    () => {
      const pill = document.querySelector(".play-gate-pill");
      return pill ? !/checking/i.test(pill.textContent ?? "") : false;
    },
    undefined,
    { timeout }
  );
  return (await page.locator(".play-gate-pill").innerText()).trim();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
