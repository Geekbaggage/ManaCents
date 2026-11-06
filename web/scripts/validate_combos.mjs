// Offline build guard for combos.json. UUID syntax is checked here; matching an
// Oracle ID to the actual card still requires a separately verified card source.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;

// Convert decimal input to cents without rounding away bad data. Reject
// fractional cents and amounts outside the safe integer range.
function cents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const decimal = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) return null;
  const [dollars, fraction = ""] = decimal.split(".");
  const amount = BigInt(dollars) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

export function validateCombos(data) {
  const failures = [];
  if (!isObject(data) || !Array.isArray(data.combos) || data.combos.length === 0)
    return ["combos: expected a nonempty array inside an object"];

  const ids = new Set();
  const slugs = new Set();
  for (const [index, combo] of data.combos.entries()) {
    const tag = `combos[${index}]`;
    if (!isObject(combo)) {
      failures.push(`${tag}: expected an object`);
      continue;
    }
    for (const [field, seen] of [["id", ids], ["slug", slugs]]) {
      if (!hasText(combo[field]) || combo[field] !== combo[field].trim())
        failures.push(`${tag}.${field}: expected nonblank text without surrounding whitespace`);
      else if (seen.has(combo[field])) failures.push(`${tag}.${field}: duplicate ${combo[field]}`);
      else seen.add(combo[field]);
    }
    for (const field of ["prerequisites", "loop_steps", "caveats"]) {
      if (!Array.isArray(combo[field]) || combo[field].length === 0)
        failures.push(`${tag}.${field}: expected a nonempty array of nonblank strings`);
      else for (const [line, text] of combo[field].entries()) {
        if (!hasText(text)) failures.push(`${tag}.${field}[${line}]: expected a nonblank string`);
      }
    }

    const total = cents(combo.total_from_scratch);
    if (total === null) failures.push(`${tag}.total_from_scratch: expected a finite nonnegative number in whole cents within the safe range`);
    if (!Array.isArray(combo.pieces) || combo.pieces.length === 0) {
      failures.push(`${tag}.pieces: expected a nonempty array`);
      continue;
    }
    const oracleIds = new Set();
    const names = new Set();
    let sum = 0;
    let validPrices = true;
    for (const [pieceIndex, piece] of combo.pieces.entries()) {
      const path = `${tag}.pieces[${pieceIndex}]`;
      if (!isObject(piece)) {
        failures.push(`${path}: expected an object`);
        validPrices = false;
        continue;
      }
      if (!hasText(piece.name)) failures.push(`${path}.name: expected a nonblank string`);
      else {
        const name = piece.name.trim().toLowerCase();
        if (names.has(name)) failures.push(`${path}.name: duplicate piece ${piece.name}`);
        names.add(name);
      }
      if (typeof piece.oracle_id !== "string" || piece.oracle_id.length !== 36 || !UUID.test(piece.oracle_id))
        failures.push(`${path}.oracle_id: expected a UUID (syntax only, not a verified card identity)`);
      else {
        const id = piece.oracle_id.toLowerCase();
        if (oracleIds.has(id)) failures.push(`${path}.oracle_id: duplicate piece ${piece.oracle_id}`);
        oracleIds.add(id);
      }
      const price = cents(piece.price);
      if (price === null) {
        failures.push(`${path}.price: expected a finite nonnegative number in whole cents within the safe range`);
        validPrices = false;
      } else {
        sum += price;
        if (!Number.isSafeInteger(sum)) {
          failures.push(`${tag}.pieces: price sum exceeds the safe integer-cent range`);
          validPrices = false;
        }
      }
    }
    if (validPrices && total !== null && sum !== total)
      failures.push(`${tag}.total_from_scratch: ${total} cents != piece sum ${sum} cents`);
  }
  return failures;
}

// The optional path supports offline snapshots and CLI regression fixtures.
// Normal prebuild always validates the checked-in production data.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error("usage: node scripts/validate_combos.mjs [data.json]");
    const path = process.argv[2] ?? join(root, "..", "src", "data", "combos.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    const failures = validateCombos(data);
    if (failures.length) {
      console.error("combos.json validation FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
      process.exitCode = 1;
    } else {
      console.log(`combos.json OK: ${data.combos.length} combos, ${data.combos.reduce((sum, combo) => sum + combo.pieces.length, 0)} pieces; structured text, UUID syntax, uniqueness and cent totals validated.`);
    }
  } catch (error) {
    console.error(`combos.json validation FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
