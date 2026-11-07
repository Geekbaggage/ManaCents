#!/usr/bin/env node
/** ManaBase Search — automated browser smoke check (release gate).
 *
 * This is the render check Charlie required after commit e676b3e shipped a
 * Search-tab crash (useCallback used but never imported): the build passed,
 * the API tests passed, and nothing rendered the component, so the tab
 * blanked the whole app on mount. The node render test in
 * manabase-search.test.mjs catches render-time ReferenceErrors; THIS test
 * goes further and drives the real app in a headless browser.
 *
 * Usage: node scripts/smoke.manabase-search.mjs [base-url]
 *   Default base: https://search-phase5.manacents.pages.dev
 *   Requires: npx playwright install chromium (one-time, ~150 MB).
 *   Exit 0 = all checks pass. Prints PASS/FAIL per check.
 *
 * Run it against the preview deployment for the exact release SHA before
 * any merge to main (see the release checklist in the build plan §13).
 * It does NOT deploy, merge, buy, or submit anything — observation only.
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://search-phase5.manacents.pages.dev";

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}/?manabase`, { waitUntil: "networkidle" });
  check("home loads, ManaBase title visible",
    await page.getByRole("heading", { name: "Fix My Mana Base" }).isVisible());

  // --- Search tab mounts (the e676b3e crash: tab blanked the whole app) ---
  await page.getByRole("tab", { name: "Search lands" }).click();
  await page.waitForSelector(".mb-search-land", { timeout: 15000 });
  check("Search tab mounts, no blank screen", true, "list rendered");
  // The meta count line was removed from the UI (CEO, Nov 7), so the served
  // total is read off the pager: 50 shown + N left = total.
  const showMore = page.getByRole("button", { name: /Show more \(/ });
  check("Search auto-loads 1,212 lands",
    (await showMore.textContent() ?? "").includes("Show more (1162 left)"),
    await showMore.textContent());
  check("Search shows 50 rows initially",
    (await page.locator(".mb-search-land").count()) === 50);

  // --- Filter change auto-refreshes, list stays, Type options persist ---
  await page.locator("select").first().selectOption("best_budget");
  await page.getByRole("button", { name: /Show all \(208 in this type\)/ }).waitFor({ timeout: 15000 });
  check("sort=best_budget auto-refreshes, list stays visible",
    (await page.locator(".mb-search-land").count()) > 0);
  const typeOptions = await page.locator("select").nth(1).locator("option").allTextContents();
  check("Type dropdown keeps its options after sort change",
    typeOptions.length > 10 && typeOptions.some((t) => t.includes("Two Color Fixing")),
    `${typeOptions.length} options`);
  check("best_budget auto-picks Two Color Fixing (208)",
    await page.getByRole("button", { name: /Show all \(208 in this type\)/ }).isVisible());

  // --- Show all loads the type's full set ---
  const showAll = page.getByRole("button", { name: /Show all \(208 in this type\)/ });
  check("Show all button present", await showAll.isVisible());
  await showAll.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".mb-search-land").length === 208,
    { timeout: 60000 },
  );
  check("Show all loads all 208 lands",
    (await page.locator(".mb-search-land").count()) === 208);

  // --- Browse tab: full catalog by cycle, expand a cycle ---
  await page.getByRole("tab", { name: "Browse lands" }).click();
  await page.waitForSelector(".mb-cycle", { timeout: 15000 });
  check("Browse lists 29 cycle groups",
    (await page.locator(".mb-cycle").count()) === 29,
    `${await page.locator(".mb-cycle").count()} groups`);
  // Browse order (CEO, Nov 7): Fetch first, then Shock — the 8 featured
  // cycles lead, the rest alphabetical, Unclassified last.
  const firstCycle = await page.locator(".mb-cycle .mb-cycle-name").first().textContent();
  check("Browse leads with Fetch", (firstCycle ?? "").includes("Fetch"), firstCycle ?? "");
  await page.getByRole("button", { name: /Fetch/ }).first().click();
  await page.waitForFunction(
    () => document.body.textContent.includes("Flooded Strand"),
    { timeout: 30000 },
  );
  const fetchNames = await page.locator(".mb-cycle.open .mb-land-name").allTextContents();
  check("Fetch expands to all 10 members", fetchNames.length === 10,
    fetchNames.join(", ").slice(0, 120));
  await page.getByRole("button", { name: /Shock/ }).first().click();
  await page.waitForFunction(
    () => document.body.textContent.includes("Blood Crypt"),
    { timeout: 30000 },
  );
  const shockNames = await page.locator(".mb-cycle.open .mb-land-name").allTextContents();
  check("Shock expands to all 11 members", shockNames.length === 11,
    shockNames.join(", ").slice(0, 120));

  check("no page errors or console errors during the run", errors.length === 0,
    errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

console.log(`\n${pass} pass, ${fail} fail`);
if (failures.length) console.log("Failures:", failures.join("; "));
process.exit(fail ? 1 : 0);
