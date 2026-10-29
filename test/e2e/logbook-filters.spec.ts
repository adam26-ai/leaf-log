import { test, expect } from "./fixtures";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { expectLogbookCardsFit, expectLogbookOverviewFits, openAdvancedLogbook } from "./helpers";

test("logbook filters survive navigation and deletion, with responsive individual trophies", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString();
  const handle = `filters${suffix}`.slice(0, 24);
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`${handle}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await expect.poll(() => existsSync(DEV_MAGIC_LINK_FILE) && readFileSync(DEV_MAGIC_LINK_FILE, "utf8").startsWith("http")).toBeTruthy();
  await page.goto(readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Filter Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/);
  const prisma = new PrismaClient();
  try {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { handle } });
    const candidates = ["open", "fai-triangle", "free-triangle"].map(shape => ({ shape, distanceM: 10000, optimal: true }));
    const flight = await prisma.flight.create({ data: {
      ownerId: profile.id, recordingKind: "igc", status: "ready", xcStatus: "ready", metricsVersion: METRICS_VERSION,
      glider: "Wing A", takeoffSiteName: "Woodrat Mountain", landingSiteName:"Valley Field", takeoffAt: new Date("2026-09-09T18:00:00Z"), flightDate: new Date("2026-09-09"), localUtcOffsetMinutes: -420,
      durationS: 7200, maxAltM: 2300, launchAltM: 1100, xcScore: { version: 1, best: candidates[0], candidates },
    } });
    const entry = await prisma.flight.create({ data: { ownerId: profile.id, recordingKind: "logbook", source: "manual_entry", status: "ready", glider: "Wing A", takeoffSiteName: "Training Hill", flightDate: new Date("2026-09-08"), durationS: 300 } });
    await prisma.flight.create({ data: { ownerId: profile.id, recordingKind: "logbook", source: "manual_entry", status: "ready", glider: "Wing B", flightDate: new Date("2026-09-07"), durationS: 600 } });
    await page.goto("/logbook");
    const row = page.locator(`a[href="/flights/${flight.id}"]`);
    const sweep=[];
    for (const width of [1440,...Array.from({length:36},(_,i)=>880-i*16)]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(row).toBeVisible();
      await expect(row.getByLabel('XC distance',{exact:true})).toHaveText('10.0 km');
      await expectLogbookCardsFit(page);
      const overview=await expectLogbookOverviewFits(page);
      const placement=await row.evaluate(card=>{
        const altitude=card.querySelector('[title="Maximum altitude"]')!.getBoundingClientRect(),distance=card.querySelector('[aria-label="XC distance"]')!.getBoundingClientRect();
        const site=card.querySelector('[data-logbook-column="site"]')!.getBoundingClientRect(),date=card.querySelector('[data-logbook-column="date"]')!.getBoundingClientRect();
        return {cardWidth:card.getBoundingClientRect().width,height:card.getBoundingClientRect().height,stacked:Math.abs(altitude.left-distance.left)<1&&altitude.bottom<=distance.top,siteFirst:site.bottom<=Math.min(altitude.top,date.top),visibility:getComputedStyle(card.querySelector('[data-logbook-column="extras"]')!).display};
      });
      expect(placement.stacked).toBe(placement.cardWidth<=560);
      expect(placement.siteFirst).toBe(placement.cardWidth<=490);
      if(placement.siteFirst) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(59);
      expect(placement.visibility).not.toBe('none');
      await expect(row.getByLabel('Visibility: Private',{exact:true})).toBeVisible();
      await expect(row.getByRole('img',{name:'Manually uploaded'})).toBeVisible();
      sweep.push({width,...placement,...overview});
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 1440) {
        // Grouped pills retain all six award descriptions as metric columns grow.
        await expect(row.getByLabel("Flight trophies").locator('[role="tooltip"] [title="Gold"]')).toHaveCount(6);
        await expect(row.getByTitle("Maximum altitude")).toBeVisible();
      }
      if (width === 320) await expect(row.locator('[aria-label="Flight trophies"] > span')).toHaveCount(1);
      if([1440,800,640,560,480,400,320].includes(width)) await page.screenshot({ path: testInfo.outputPath(`logbook-${width}.png`), fullPage: true });
    }
    await testInfo.attach('width-sweep',{body:JSON.stringify(sweep,null,2),contentType:'application/json'});
    expect(new Set(sweep.map(entry=>entry.actionLayout))).toEqual(new Set(['full','short','stacked']));
    expect(sweep.some(entry=>entry.compactFilters&&entry.filterRows===1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Select Wings" }).click();
    await page.getByRole("checkbox", { name: /Wing B/ }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("status").filter({ hasText: "2 of 3 flights" })).toBeVisible();
    await page.locator(`a[href="/flights/${entry.id}"]`).click();
    await page.goBack();
    await expect(page.getByRole("status").filter({ hasText: "2 of 3 flights" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "2 of 3 flights" })).toBeVisible();
    await page.goto(`/flights/${entry.id}/edit`);
    await page.getByRole("button", { name: "Delete flight", exact: true }).click();
    await page.getByRole("button", { name: "Yes, delete", exact: true }).click();
    await expect(page).toHaveURL(/\/logbook/);
    await expect(page.getByRole("status").filter({ hasText: "1 of 2 flights" })).toBeVisible();
    await page.getByRole("button", { name: "Select Dates" }).click();
    await page.getByLabel("From", { exact: true }).fill("2026-09-09");
    await page.getByLabel("Until", { exact: true }).fill("2026-09-09");
    await expect(row).toBeVisible();
    await page.getByLabel("Until", { exact: true }).fill("2026-09-08");
    await expect(page.getByText("No flights match these filters.")).toBeVisible();
    await page.keyboard.press('Escape');

    // Enough flights to exercise the list's scrollbar independently of the
    // fixed totals and filters, including restoration after both exit paths.
    await prisma.flight.createMany({data:Array.from({length:30},()=>({ownerId:profile.id,recordingKind:'logbook',source:'manual_entry',status:'ready',xcStatus:'not_recorded',visibility:'private',glider:'Scroll wing',takeoffSiteName:'Scroll hill',flightDate:new Date('2025-08-01'),durationS:300}))});
    await page.reload();
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    const list=page.getByRole('list',{name:'Flights',exact:true});
    await expect(list.getByRole('listitem')).toHaveCount(32);
    for(const size of [{width:1440,height:900},{width:390,height:844},{width:320,height:640},{width:844,height:390}]){
      await page.setViewportSize(size);
      await expectLogbookOverviewFits(page);
      const filters=page.getByLabel('Logbook filters',{exact:true});
      const before=await filters.boundingBox(), bounds=(await list.boundingBox())!;
      await list.evaluate(element=>{element.scrollTop=0;});
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      await page.mouse.wheel(0,5000);
      await expect.poll(()=>list.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
      expect((await filters.boundingBox())!.y).toBe(before!.y);
      expect(await page.evaluate(()=>window.scrollY)).toBe(0);
      await page.getByRole('button',{name:'Select Wings',exact:true}).click();
      await expect(page.getByRole('group',{name:'Wings choices'})).toBeInViewport({ratio:1});
      await page.keyboard.press('Escape');
      if(size.width===390)await page.screenshot({path:testInfo.outputPath('logbook-list-scrolled-mobile.png'),fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    await expectLogbookOverviewFits(page);
    const savedScroll=await list.evaluate(element=>element.scrollTop);
    await list.locator('a[href^="/flights/"]').last().click();
    await expect(page).toHaveURL(/\/flights\//);
    await page.goBack();
    await expect.poll(()=>list.evaluate(element=>element.scrollTop)).toBeCloseTo(savedScroll,0);
    const editor=await openAdvancedLogbook(page);
    await expect(editor.getByRole('list',{name:'Scrollable flights'})).toBeVisible();
    await editor.getByRole('button',{name:'Done editing',exact:true}).click();
    await expect(page).toHaveURL(/\/logbook$/);
    await expect.poll(()=>list.evaluate(element=>element.scrollTop)).toBeCloseTo(savedScroll,0);
  } finally { await prisma.$disconnect(); }
});
