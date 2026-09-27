import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

async function main() {
  const base = process.env.REFERENCE_PREVIEW_URL ?? "http://localhost:3008";
  await mkdir("verification/replication/ui", { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1050 },
      }),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/references`, { waitUntil: "networkidle" });
    const ready = () =>
      page.locator("canvas[data-build-viewer=ready]").waitFor();
    await ready();
    const downloads: string[]=[];
    const checkDownload=async(expectedId:string)=>{
      const href=await page.getByRole("link",{name:"Download model & evidence"}).getAttribute("href");
      const response=await page.request.get(`${base}${href}`);
      const body=await response.json();
      if(!response.ok()||body.replica.id!==expectedId||!body.report.instructions.length) throw new Error(`Invalid model download: ${expectedId}`);
      downloads.push(expectedId);
    };
    await checkDownload("jet");
    await page.screenshot({
      path: "verification/replication/ui/jet-workshop.png",
      fullPage: true,
    });
    for (const name of ["small", "medium", "large"]) {
      await page
        .getByRole("button", { name: new RegExp(`Henry.s ${name} ramp`) })
        .click();
      await ready();
      await checkDownload(`${name}-ramp`);
      await page.screenshot({
        path: `verification/replication/ui/${name}-workshop.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: /Henry.s small ramp/ }).click();
    await page.getByLabel("Construction checkpoint").selectOption("1");
    await page.getByLabel("Number parts & edges").check();
    await page.locator(".design-piece-label").first().waitFor();
    const labels = await page.locator(".design-piece-label").allTextContents();
    if (!labels.includes("P6") || labels.includes("P1"))
      throw Error(`Subassembly labels changed: ${labels}`);
    await page.getByLabel("Construction checkpoint").selectOption("0");
    await page.getByLabel("Part insertion preview").selectOption("0");
    await ready();
    const slider = page.getByRole("slider", { name: /Move into place/ });
    await slider.focus();
    await slider.press("Home");
    if (await slider.inputValue() !== "0") throw Error("Insertion slider did not reach its start.");
    const insertionLabels = await page.locator(".design-piece-label").allTextContents();
    if (insertionLabels.length !== 1 || insertionLabels[0] !== "P5")
      throw Error(`Unplaced parts leaked into insertion preview: ${insertionLabels}`);
    await page.getByLabel("Complete assembly check").waitFor();
    if (!(await page.getByLabel("Complete assembly check").textContent())?.includes("Assembly with hand support"))
      throw Error("Supported assembly evidence is missing.");
    await page.screenshot({ path: "verification/replication/ui/small-insertion.png", fullPage: true });
    await slider.press("End");
    if (await slider.inputValue() !== "100") throw Error("Insertion slider did not complete.");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    if (await page.getByLabel("Part insertion preview").inputValue() !== "-1")
      throw Error("Insertion selection did not reset at the next checkpoint.");
    await page.getByRole("button", { name: /3D snail/ }).click();
    await page.getByRole("heading", { name: /original 3D snail/ }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /Henry.s medium ramp/ }).click();
    await ready();
    await page.screenshot({
      path: "verification/replication/ui/mobile-workshop.png",
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow || errors.length)
      throw Error(JSON.stringify({ overflow, errors }));
    const evidence = {
      builds: 4,
      downloads,
      snailEmptyState: true,
      stableModuleLabels: labels,
      insertionPreview: { labels: insertionLabels, keyboardStartEnd: true, resetsAtNextStage: true },
      mobileOverflow: overflow,
      pageErrors: errors,
    };
    await writeFile(
      "verification/replication/ui/results.json",
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(evidence);
  } finally {
    await browser.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
