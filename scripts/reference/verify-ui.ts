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
    const slider = page.getByRole("slider", { name: /Recorded assembly motion|Move into place/ });
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
    await page.getByLabel("Part insertion preview").selectOption("4");
    const liftSlider = page.getByRole("slider", { name: /Recorded assembly motion/ });
    await liftSlider.fill("0");
    await ready();
    const pickupLabels = await page.locator(".design-piece-label").allTextContents();
    if (pickupLabels.length !== 4 || pickupLabels.includes("P3")) throw Error(`Pickup includes future panels: ${pickupLabels}`);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const pickupStart = await page.locator("canvas").screenshot();
    await liftSlider.fill("15");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (pickupStart.equals(await page.locator("canvas").screenshot())) throw Error("Recorded support lift did not move.");
    await page.screenshot({ path: "verification/replication/ui/small-support-lift.png", fullPage: true });
    await liftSlider.fill("100");
    await page.waitForFunction(() => document.querySelectorAll(".design-piece-label").length === 5);
    const wedgeEndLabels = await page.locator(".design-piece-label").allTextContents();
    if (wedgeEndLabels.length !== 5 || wedgeEndLabels.includes("P6")) throw Error(`Wedge release shows future module: ${wedgeEndLabels}`);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    if (await page.getByLabel("Part insertion preview").inputValue() !== "-1")
      throw Error("Insertion selection did not reset at the next checkpoint.");
    if (!(await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("Corrected launch assembly did not display its passing check.");
    await page.getByLabel("Part insertion preview").selectOption("0");
    const releaseSlider = page.getByRole("slider", { name: /Recorded assembly motion|Approach and recorded release/ });
    await releaseSlider.fill("25");
    await ready();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const raisedFrame = await page.locator("canvas").screenshot();
    await releaseSlider.fill("100");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const seatedFrame = await page.locator("canvas").screenshot();
    if (raisedFrame.equals(seatedFrame)) throw Error("Recorded gravity motion did not change the rendered pose.");
    const seatedLabels = await page.locator(".design-piece-label").allTextContents();
    if (seatedLabels.length !== 6 || !["P1","P2","P3","P4","P5","P7"].every(id=>seatedLabels.includes(id)))
      throw Error(`Gravity placement lost its existing workspace or shows future parts: ${seatedLabels}`);
    await page.screenshot({ path: "verification/replication/ui/small-launch-placement.png", fullPage: true });
    await page.getByLabel("Construction checkpoint").selectOption("2");
    await page.getByLabel("Part insertion preview").selectOption("0");
    const transferSlider=page.getByRole("slider",{name:/Recorded assembly motion/});
    await transferSlider.fill("0");
    await ready();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const transferStart=await page.locator("canvas").screenshot();
    const transferLabels=await page.locator(".design-piece-label").allTextContents();
    if(transferLabels.length!==9) throw Error(`Prepared workspace lost parts: ${transferLabels}`);
    await page.screenshot({path:"verification/replication/ui/small-transfer-start.png",fullPage:true});
    await transferSlider.fill("100");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if(transferStart.equals(await page.locator("canvas").screenshot())) throw Error("Prepared transfer did not replay actual movement.");
    if(!(await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("The complete small-ramp assembly pass is not visible.");
    await page.screenshot({path:"verification/replication/ui/small-transfer-release.png",fullPage:true});
    await page.getByRole("button",{name:/Henry.s medium ramp/}).click();
    await page.getByLabel("Number parts & edges").check();
    await page.getByLabel("Construction checkpoint").selectOption("0");
    await page.getByLabel("Part insertion preview").selectOption("2");
    const mediumSlider=page.getByRole("slider",{name:/Recorded assembly motion/});
    await mediumSlider.fill("0");
    await page.waitForFunction(()=>document.querySelectorAll(".design-piece-label").length===2);
    const mediumPickup=await page.locator(".design-piece-label").allTextContents();
    if(!["P1","P4"].every(id=>mediumPickup.includes(id))) throw Error(`Medium pickup includes unplaced panels: ${mediumPickup}`);
    await mediumSlider.fill("100");
    await page.waitForFunction(()=>document.querySelectorAll(".design-piece-label").length===3);
    await page.screenshot({path:"verification/replication/ui/medium-retained-pickup.png",fullPage:true});
    await page.getByLabel("Construction checkpoint").selectOption("1");
    if(!(await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("Medium proposed upper preparation pass is absent.");
    if(!(await page.locator(".reference-instruction").textContent())?.includes("assembly method is proposed, not observed"))
      throw Error("Upper preparation was presented as an observed construction method.");
    await page.getByLabel("Part insertion preview").selectOption("3");
    await mediumSlider.fill("100");
    await page.waitForFunction(()=>document.querySelectorAll(".design-piece-label").length===8);
    const mediumPrepared=await page.locator(".design-piece-label").allTextContents();
    if(!["P1","P2","P3","P4","P10","P11","P12","P13"].every(id=>mediumPrepared.includes(id)))
      throw Error(`Medium upper preparation lost the lower obstacle or added future support parts: ${mediumPrepared}`);
    await page.screenshot({path:"verification/replication/ui/medium-upper-preparation.png",fullPage:true});
    await page.getByLabel("Construction checkpoint").selectOption("2");
    if(!(await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("Medium support assembly pass is absent.");
    await page.getByLabel("Part insertion preview").selectOption("4");
    await mediumSlider.fill("100");
    await page.waitForFunction(()=>document.querySelectorAll(".design-piece-label").length===13);
    const mediumWorkspace=await page.locator(".design-piece-label").allTextContents();
    if(!Array.from({length:13},(_,i)=>`P${i+1}`).every(id=>mediumWorkspace.includes(id)))
      throw Error(`Medium workspace omits predecessors or includes future parts: ${mediumWorkspace}`);
    await page.screenshot({path:"verification/replication/ui/medium-support-release.png",fullPage:true});
    await page.getByLabel("Construction checkpoint").selectOption("3");
    if(!(await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("Medium upper transfer pass is absent.");
    await page.getByLabel("Part insertion preview").selectOption("0");
    await mediumSlider.fill("0");
    await ready();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const mediumTransferStart=await page.locator("canvas").screenshot();
    await mediumSlider.fill("100");
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    if(mediumTransferStart.equals(await page.locator("canvas").screenshot()))throw Error("Medium upper transfer playback did not move.");
    const mediumTransferred=await page.locator(".design-piece-label").allTextContents();
    if(mediumTransferred.length!==13||!Array.from({length:13},(_,i)=>`P${i+1}`).every(id=>mediumTransferred.includes(id)))
      throw Error(`Medium transfer omits actual workspace panels: ${mediumTransferred}`);
    await page.getByText("Numbered parts and checked edge joins",{exact:true}).click();
    const checkedInstructions=await page.locator(".reference-instruction").textContent();
    if(!checkedInstructions?.includes("Joins present after assembly checks")||
      !checkedInstructions.includes("P5 edge 3 to P10 edge 3")||!checkedInstructions.includes("P7 edge 3 to P11 edge 3")||
      checkedInstructions.includes("P2 edge 1 to P7 edge 4"))
      throw Error("Medium transfer instructions did not use actual checked joins.");
    await page.screenshot({path:"verification/replication/ui/medium-upper-transfer-release.png",fullPage:true});
    await page.getByLabel("Construction checkpoint").selectOption("4");
    if(!(await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("Medium lower table placement pass is absent.");
    await page.getByLabel("Part insertion preview").selectOption("0");
    await mediumSlider.fill("0");
    await ready();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const lowerPlacementStart=await page.locator("canvas").screenshot();
    await mediumSlider.fill("100");
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    if(lowerPlacementStart.equals(await page.locator("canvas").screenshot()))throw Error("Lower placement did not replay recorded movement.");
    const relocatedLabels=await page.locator(".design-piece-label").allTextContents();
    if(relocatedLabels.length!==13||!Array.from({length:13},(_,i)=>`P${i+1}`).every(id=>relocatedLabels.includes(id)))
      throw Error(`Lower placement lost workspace panels: ${relocatedLabels}`);
    const tablePlacementText=await page.getByLabel("Prepared table placement",{exact:true}).textContent();
    if(!tablePlacementText?.includes("Passed this check")||!tablePlacementText.includes("Table contact checked")||!tablePlacementText.includes("no new join was added"))
      throw Error("Actual table-bearing and no-new-join evidence is absent.");
    if(!(await page.locator(".reference-instruction").textContent())?.includes("No new checked magnetic joins in this step"))
      throw Error("Table relocation instructions claimed a new magnetic join.");
    await page.screenshot({path:"verification/replication/ui/medium-lower-placement-release.png",fullPage:true});
    await page.getByLabel("Construction checkpoint").selectOption("5");
    if((await page.getByLabel("Complete assembly check").textContent())?.includes("Passed this check"))
      throw Error("Unverified medium blue turn was promoted.");
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
      gravityPreview: { labels: seatedLabels, recordedFramesDiffer: true, launchAssemblyPassed: true },
      pickupPreview: { labels: pickupLabels, terminalLabels: wedgeEndLabels, recordedFramesDiffer: true },
      transferPreview: {labels:transferLabels,recordedFramesDiffer:true,completeAssemblyPassed:true},
      mediumPreview: {pickupLabels:mediumPickup,preparedLabels:mediumPrepared,workspaceLabels:mediumWorkspace,transferLabels:mediumTransferred,relocatedLabels,
        firstFiveStagesPassed:true,transferPlaybackMoves:true,checkedJoinInstructions:true,lowerPlacementPlaybackMoves:true,tableBearingChecked:true,noNewPlacementJoins:true,blueTurnUnverified:true},
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
