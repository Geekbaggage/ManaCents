import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateCombos } from "./validate_combos.mjs";

const script = fileURLToPath(new URL("./validate_combos.mjs", import.meta.url));
const production = JSON.parse(readFileSync(new URL("../src/data/combos.json", import.meta.url), "utf8"));
const fixture = () => ({ combos: [{
  id: "fixture", slug: "fixture", prerequisites: ["Both pieces ready"],
  loop_steps: ["Activate the loop"], caveats: ["Needs an outlet"],
  pieces: [
    { name: "First card", oracle_id: "d2ae893f-52af-4645-8712-d62fb78f901e", price: 0.10 },
    { name: "Second card", oracle_id: "6b8cf2a0-b045-4d91-9d91-c602d40c6237", price: 0.20 },
  ], total_from_scratch: 0.30,
}] });

function rejected(name, mutate, expected) {
  test(name, () => {
    const data = fixture();
    mutate(data);
    const errors = validateCombos(data);
    assert.ok(errors.some((error) => error.includes(expected)), JSON.stringify(errors));
  });
}

test("current production data passes, including shared cards across combos", () => {
  assert.deepEqual(validateCombos(production), []);
});
test("decimal prices sum in cents; optional reel URL is not required", () => {
  assert.deepEqual(validateCombos(fixture()), []);
});
test("zero prices are valid", () => {
  const data = fixture();
  data.combos[0].pieces[0].price = 0;
  data.combos[0].total_from_scratch = 0.20;
  assert.deepEqual(validateCombos(data), []);
});
test("a card may appear in different combos", () => {
  const data = fixture();
  data.combos.push({ ...structuredClone(data.combos[0]), id: "other", slug: "other" });
  assert.deepEqual(validateCombos(data), []);
});
test("uppercase UUID syntax is accepted", () => {
  const data = fixture();
  data.combos[0].pieces[0].oracle_id = data.combos[0].pieces[0].oracle_id.toUpperCase();
  assert.deepEqual(validateCombos(data), []);
});
for (const data of [null, [], {}, { combos: null }, { combos: [] }]) {
  test(`invalid root ${JSON.stringify(data)} fails clearly`, () => {
    assert.match(validateCombos(data)[0], /combos:/);
  });
}
rejected("null combo fails clearly", (data) => { data.combos[0] = null; }, "combos[0]");
for (const field of ["prerequisites", "loop_steps", "caveats"]) {
  for (const [label, value] of [["missing", undefined], ["empty array", []], ["blank", [" \n\t"]], ["null item", [null]], ["number item", [1]], ["object item", [{}]]]) {
    rejected(`${field}: rejects ${label}`, (data) => { data.combos[0][field] = value; }, `combos[0].${field}`);
  }
}
for (const field of ["id", "slug"]) {
  rejected(`${field}: rejects blank`, (data) => { data.combos[0][field] = " "; }, `.${field}:`);
  rejected(`${field}: rejects surrounding whitespace`, (data) => { data.combos[0][field] = " fixture "; }, `.${field}:`);
  rejected(`${field}: rejects duplicate`, (data) => {
    data.combos.push({ ...structuredClone(data.combos[0]), id: "other", slug: "other", [field]: "fixture" });
  }, `.${field}: duplicate`);
}
for (const [label, pieces] of [["missing", undefined], ["empty", []], ["object", {}], ["null piece", [null]]]) {
  rejected(`pieces: rejects ${label}`, (data) => { data.combos[0].pieces = pieces; }, ".pieces");
}
rejected("piece name must not be blank", (data) => { data.combos[0].pieces[0].name = " "; }, ".name:");
rejected("piece names cannot repeat within a combo", (data) => { data.combos[0].pieces[1].name = " FIRST CARD "; }, ".name: duplicate");
for (const id of [undefined, "", "garbage", "d2ae893f-52af-4645-8712-d62fb78f901", " d2ae893f-52af-4645-8712-d62fb78f901e", "d2ae893f-52af-4645-8712-d62fb78f901e\n", 123]) {
  rejected(`oracle_id rejects ${JSON.stringify(id)}`, (data) => { data.combos[0].pieces[0].oracle_id = id; }, ".oracle_id:");
}
rejected("Oracle IDs cannot repeat within one combo regardless of case", (data) => {
  data.combos[0].pieces[1].oracle_id = data.combos[0].pieces[0].oracle_id.toUpperCase();
}, ".oracle_id: duplicate");
for (const [label, price] of [["string", "0.10"], ["negative", -0.1], ["NaN", NaN], ["infinite", Infinity], ["fractional cent", 0.101], ["unsafe", Number.MAX_SAFE_INTEGER], ["null", null]]) {
  rejected(`piece price rejects ${label}`, (data) => { data.combos[0].pieces[0].price = price; }, ".price:");
  rejected(`combo total rejects ${label}`, (data) => { data.combos[0].total_from_scratch = price; }, ".total_from_scratch:");
}
rejected("otherwise valid pieces cannot have a mismatched total", (data) => { data.combos[0].total_from_scratch = 0.31; }, "30 cents");
rejected("piece sum must stay inside the safe integer-cent range", (data) => {
  data.combos[0].pieces.forEach((piece) => { piece.price = 50000000000000; });
}, "safe integer-cent range");

function runFixture(contents) {
  const dir = mkdtempSync(join(tmpdir(), "manacents-combos-"));
  try {
    const path = join(dir, "data.json");
    writeFileSync(path, contents);
    return spawnSync(process.execPath, [script, path], { encoding: "utf8", cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("CLI rejects the original blank-prerequisite bug with a useful path", () => {
  const data = fixture();
  data.combos[0].prerequisites = [""];
  const result = runFixture(JSON.stringify(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /combos\[0\]\.prerequisites\[0\]/);
  assert.doesNotMatch(result.stdout, /OK/);
});
test("CLI rejects the original malformed-ID bug", () => {
  const data = fixture();
  data.combos[0].pieces[0].oracle_id = "garbage";
  const result = runFixture(JSON.stringify(data));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pieces\[0\]\.oracle_id/);
});
test("CLI rejects malformed JSON without an uncaught stack trace", () => {
  const result = runFixture("{");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /validation FAILED/);
  assert.doesNotMatch(result.stderr, /at ModuleJob/);
});
test("CLI default production path does not depend on working directory", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /combos.json OK:/);
});
