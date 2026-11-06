import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCatalogStatuses } from "./_manabase_status.js";

// Exercise the real Pages handler and UI components. Bundling handles their
// JSON/JSX imports in the same dependency set used by the production build.
const viteRequire = createRequire(realpathSync(fileURLToPath(new URL("../../node_modules/vite/package.json", import.meta.url))));
const { build } = await import(pathToFileURL(viteRequire.resolve("esbuild")));
const catalog = JSON.parse(readFileSync(new URL("./_manabase_lands.json", import.meta.url), "utf8"));
async function bundle(entry, data) {
  const result = await build({ entryPoints: [fileURLToPath(entry)], bundle: true,
    platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: data ? [{ name: "fixture-catalog", setup(b) {
      b.onLoad({ filter: /_manabase_lands\.json$/ }, () => ({ contents: JSON.stringify(data), loader: "json" }));
    } }] : [],
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const api = await bundle(new URL("./manabase.js", import.meta.url));
const ui = await bundle(new URL("../../src/components/ManaBase.jsx", import.meta.url));
const env = { MANACENTS_DB: { prepare() { return { bind() { return { run: async () => ({}) }; } }; } } };
async function request(handler, query) {
  const response = await handler.onRequestGet({ request: new Request(`http://review/api/manabase?${query}`), env });
  assert.equal(response.status, 200);
  return response.json();
}
const browse = await request(api, "list=all");
const statusByName = new Map(browse.lands.map((l) => [l.name, l]));

test("browse preserves the 43-row catalog but holds both bounce models", () => {
  assert.equal(browse.lands.length, 43);
  for (const name of ["Azorius Chancery", "Dimir Aqueduct"]) {
    const land = statusByName.get(name);
    assert.equal(land.inCatalog, true);
    assert.equal(land.optimizationStatus, "held");
    assert.match(land.optimizationReason, /Bounce land/);
    assert.doesNotMatch(land.optimizationReason, /fetchland/);
  }
});
test("absent fetches remain held with accurate individual reasons", () => {
  for (const name of ["Flooded Strand", "Polluted Delta"]) {
    assert.equal(statusByName.has(name), false);
    const detail = browse.meta.optimizationHeld.find((l) => l.name === name);
    assert.equal(detail.inCatalog, false);
    assert.equal(detail.optimizationStatus, "held");
    assert.match(detail.optimizationReason, /Typed fetchland/);
  }
  assert.equal(browse.meta.optimizationHeld.length, 4);
});
test("legacy seed exclusion field remains compatible with older clients", () => {
  assert.deepEqual(browse.meta.heldExcluded, ["Flooded Strand", "Polluted Delta"]);
});
test("normal supported land is available, without a held reason", () => {
  assert.equal(statusByName.get("Plains").optimizationStatus, "available");
  assert.equal(statusByName.get("Plains").optimizationReason, null);
});
test("optimizer holds exactly the same catalog-present rows as browse", async () => {
  const result = await request(api, "colors=WU&budget=25&slots=10");
  const expected = browse.meta.optimizationHeld.filter((l) => l.inCatalog).map((l) => l.name).sort();
  assert.deepEqual(result.context.heldFromOptimization.map((l) => l.name).sort(), expected);
  assert.deepEqual(result.context.bounceHeld.slice().sort(), expected);
  assert.equal(result.meta.servedLandCount, 41);
  assert.ok(result.lands.every((l) => !expected.includes(l.name)));
});
test("new seed-level holds drive status without pretending they are fetchlands", () => {
  const statuses = buildCatalogStatuses([{ name: "A future land" }], ["A future land", "A future land"]);
  assert.equal(statuses.size, 1);
  assert.equal(statuses.get("A future land").optimizationStatus, "held");
  assert.equal(statuses.get("A future land").inCatalog, true);
  assert.match(statuses.get("A future land").optimizationReason, /catalog review/);
});
test("the actual handler excludes a newly held catalog row", async () => {
  const data = { ...catalog, held_excluded: [...catalog.held_excluded, "Plains"] };
  const handler = await bundle(new URL("./manabase.js", import.meta.url), data);
  const listed = await request(handler, "list=all");
  assert.equal(listed.lands.find((l) => l.name === "Plains").optimizationStatus, "held");
  const optimized = await request(handler, "colors=W&budget=25&slots=10");
  assert.ok(!optimized.lands.some((l) => l.name === "Plains"));
  assert.ok(optimized.context.heldFromOptimization.some((l) => l.name === "Plains"));
});
test("model availability does not bypass runtime Game Changer bracket gates", async () => {
  const land = { ...catalog.lands.find((l) => l.name === "Plains"), name: "Bracket fixture", gameChanger: true, price: 1 };
  const handler = await bundle(new URL("./manabase.js", import.meta.url), { ...catalog, lands: [land], held_excluded: [] });
  assert.equal((await request(handler, "list=all")).lands[0].optimizationStatus, "available");
  assert.equal((await request(handler, "colors=W&budget=25&slots=1&bracket=2")).lands.length, 0);
  assert.equal((await request(handler, "colors=W&budget=25&slots=1&bracket=3")).lands.length, 1);
});
test("model availability does not bypass banned or color-identity gates", async () => {
  for (const overrides of [{ banned: true }, { colorIdentity: ["B"], colors: ["B"] }]) {
    const land = { ...catalog.lands.find((l) => l.name === "Plains"), ...overrides };
    const handler = await bundle(new URL("./manabase.js", import.meta.url), { ...catalog, lands: [land], held_excluded: [] });
    assert.equal((await request(handler, "colors=W&budget=25&slots=1")).lands.length, 0);
  }
});
test("held bounce UI renders the correct badge and reason", () => {
  const html = renderToStaticMarkup(React.createElement(ui.LandOptimizationStatus, { land: statusByName.get("Azorius Chancery") }));
  assert.match(html, /Held from optimization/);
  assert.match(html, /Bounce land/);
  assert.doesNotMatch(html, /Available for optimization|fetchland/);
});
test("supported and unknown UI states do not infer eligibility from presence", () => {
  assert.match(renderToStaticMarkup(React.createElement(ui.LandOptimizationStatus, { land: statusByName.get("Plains") })), /Available for optimization/);
  const unknown = renderToStaticMarkup(React.createElement(ui.LandOptimizationStatus, { land: { name: "Unknown" } }));
  assert.match(unknown, /status unavailable/);
  assert.doesNotMatch(unknown, /Available for optimization/);
});
test("held summary names absent fetches; bounce reasons stay on their cards", () => {
  const html = renderToStaticMarkup(React.createElement(ui.HeldCatalogSummary, { details: browse.meta.optimizationHeld }));
  assert.match(html, /Flooded Strand/);
  assert.match(html, /Polluted Delta/);
  assert.match(html, /Typed fetchland/);
  assert.doesNotMatch(html, /Azorius Chancery|Dimir Aqueduct/);
});
