// Fail the build if combos.json is missing required structured data.
// Charlie's criterion (2nd audit, 2026-11-05): oracle_ids must be persistent
// in the serving JSON (not only a sidecar manifest), and every combo must
// carry its prerequisites. Run as `prebuild` before `vite build`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(join(root, "..", "src", "data", "combos.json"), "utf8")
);

const failures = [];
for (const combo of data.combos) {
  const tag = `Ep ${combo.episode} (${combo.id})`;
  if (!Array.isArray(combo.prerequisites) || combo.prerequisites.length === 0)
    failures.push(`${tag}: missing or empty prerequisites`);
  if (!Array.isArray(combo.loop_steps) || combo.loop_steps.length === 0)
    failures.push(`${tag}: missing or empty loop_steps`);
  if (!Array.isArray(combo.caveats) || combo.caveats.length === 0)
    failures.push(`${tag}: missing or empty caveats`);
  for (const piece of combo.pieces) {
    if (!piece.oracle_id) failures.push(`${tag}: ${piece.name} missing oracle_id`);
  }
  const sum = Math.round(
    combo.pieces.reduce((a, p) => a + p.price, 0) * 100
  ) / 100;
  if (sum !== combo.total_from_scratch)
    failures.push(
      `${tag}: total_from_scratch ${combo.total_from_scratch} != sum ${sum}`
    );
}

if (failures.length) {
  console.error("combos.json validation FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `combos.json OK: ${data.combos.length} combos, ` +
    `${data.combos.reduce((a, c) => a + c.pieces.length, 0)} pieces, all with oracle_id.`
);
