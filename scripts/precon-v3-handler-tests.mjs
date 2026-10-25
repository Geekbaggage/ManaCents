// Isolated handler tests for upgrades.js v3 (precon exclusion).
// Uses node:sqlite in-memory DB + a small D1-shaped adapter.
// NOT a Cloudflare D1 test, NOT a UI test, NOT production.
// Run: node scripts/precon-v3-handler-tests.mjs
import { DatabaseSync } from "node:sqlite";
import { onRequestGet, missingColumnName } from "../web/functions/api/upgrades.js";

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${extra}`); }
}

class D1 {
  constructor(db) { this.db = db; }
  prepare(sql) {
    const stmt = this.db.prepare(sql);
    let params = [];
    return {
      bind(...p) { params = p; return this; },
      all() {
        try { return { results: stmt.all(...params) }; }
        catch (e) { throw e; }
      },
      first() {
        try { return stmt.get(...params) ?? null; }
        catch (e) { throw e; }
      },
      run() {
        try { stmt.run(...params); return {}; }
        catch (e) { throw e; }
      },
    };
  }
}

function makeDb({ withTypeLine = true, withFlag = true, withMembership = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE commanders (slug TEXT PRIMARY KEY, name TEXT, color_identity TEXT, deck_count INTEGER, status TEXT, vote_count INTEGER, image_url TEXT);
    CREATE TABLE cards (scryfall_id TEXT PRIMARY KEY, name TEXT, usd REAL, image_url TEXT, type_line TEXT);
    CREATE TABLE global_rates (scryfall_id TEXT, color_identity TEXT, inclusion_rate REAL);
    CREATE TABLE search_log (id INTEGER PRIMARY KEY AUTOINCREMENT, commander_slug TEXT, commander_name TEXT, budget REAL, mode TEXT, result_count INTEGER, total REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  // Recreate cards without type_line if requested, by dropping and rebuilding
  if (!withTypeLine) {
    db.exec(`DROP TABLE cards; CREATE TABLE cards (scryfall_id TEXT PRIMARY KEY, name TEXT, usd REAL, image_url TEXT);`);
  }
  const flagCol = withFlag ? ", in_base_precon INTEGER" : "";
  db.exec(`CREATE TABLE commander_synergy (commander_slug TEXT, scryfall_id TEXT, cmdr_rate REAL, role TEXT${flagCol}, raw_score REAL, updated_at TEXT, PRIMARY KEY (commander_slug, scryfall_id));`);
  if (withMembership) {
    db.exec(`CREATE TABLE precon_membership (commander_slug TEXT, card_name TEXT, source TEXT, PRIMARY KEY (commander_slug, card_name));
      CREATE TABLE precon_coverage (commander_slug TEXT PRIMARY KEY, precon_name TEXT, source_url TEXT, distinct_names INTEGER, verified_at TEXT);`);
  }
  return db;
}

function seedBasic(db, { commander = "captain-america-team-leader", membership = [], synergy = [] } = {}) {
  db.prepare(`INSERT INTO commanders VALUES (?, ?, ?, ?, ?, ?, ?)`).run(commander, "Captain America, Team Leader", "WRU", 1000, "live", 1, null);
  for (const name of membership) {
    db.prepare(`INSERT INTO precon_membership VALUES (?, ?, ?)`).run(commander, name, "test");
  }
  // synergy: {id, name, usd, rate, role, score, flag, type}
  for (const s of synergy) {
    try { db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?)`).run(s.id, s.name, s.usd, "img", s.type || "Creature"); }
    catch { /* type_line-less table: use 4 cols */ db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?)`).run(s.id, s.name, s.usd, "img"); }
    if (s.flag === undefined) {
      db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, raw_score) VALUES (?, ?, ?, ?, ?)`).run(commander, s.id, s.rate, s.role, s.score);
    } else {
      db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, in_base_precon, raw_score) VALUES (?, ?, ?, ?, ?, ?)`).run(commander, s.id, s.rate, s.role, s.flag, s.score);
    }
    db.prepare(`INSERT INTO global_rates VALUES (?, ?, ?)`).run(s.id, "WRU", 0.05);
  }
}

async function call(db, slug, budget = 25, mode = "tuneup", extra = "") {
  const url = `https://example.com/api/upgrades?commander=${slug}&budget=${budget}&mode=${mode}${extra}`;
  const res = await onRequestGet({ request: new Request(url), env: { MANACENTS_DB: new D1(db) } });
  return { status: res.status, body: await res.json() };
}

// --- Parser tests (Charlie Q1) ---
check("parser: c.type_line", missingColumnName(new Error("D1_ERROR: no such column: c.type_line")) === "type_line");
check("parser: SQL text mentioning in_base_precon still yields type_line",
  missingColumnName(new Error("no such column: type_line: SELECT ... COALESCE(s.in_base_precon, 0) ...")) === "type_line");
check("parser: missing flag", missingColumnName(new Error("no such column: s.in_base_precon")) === "in_base_precon");
check("parser: cause.message (older Wrangler)", missingColumnName({ message: "D1 error", cause: { message: "no such column: type_line" } }) === "type_line");
check("parser: unrelated error -> null", missingColumnName(new Error("connection reset")) === null);
check("parser: no such table -> null", missingColumnName(new Error("no such table: precon_membership")) === null);

// --- Normal + membership exclusion, both modes, includeUniversal ---
{
  const db = makeDb();
  seedBasic(db, {
    membership: ["Thought Vessel", "Rescue, Pepper Potts"],
    synergy: [
      { id: "p1", name: "Thought Vessel", usd: 0.1, rate: 0.9, role: "synergy", score: 10, flag: 1 },
      { id: "p2", name: "Rescue, Pepper Potts", usd: 0.23, rate: 0.8, role: "synergy", score: 9, flag: 1 },
      { id: "u1", name: "Biorganic Carapace", usd: 0.36, rate: 0.7, role: "synergy", score: 8 },
      { id: "u2", name: "Flowering of the White Tree", usd: 7.57, rate: 0.6, role: "synergy", score: 7 },
    ],
  });
  const { status, body } = await call(db, "captain-america-team-leader");
  check("normal tuneup status 200", status === 200, JSON.stringify(body).slice(0, 200));
  check("normal: precon names absent from upgrades", !body.upgrades.some((u) => ["Thought Vessel", "Rescue, Pepper Potts"].includes(u.name)));
  check("normal: precon names absent from alternates", !body.alternates.some((u) => ["Thought Vessel", "Rescue, Pepper Potts"].includes(u.name)));
  check("normal: preconExcluded = membership names", JSON.stringify(body.preconExcluded.map((x) => x.name).sort()) === JSON.stringify(["Rescue, Pepper Potts", "Thought Vessel"]));
  check("normal: genuine upgrade present", body.upgrades.some((u) => u.name === "Biorganic Carapace"));
  const iu = await call(db, "captain-america-team-leader", 25, "tuneup", "&includeUniversal=1");
  check("includeUniversal: precon still excluded", !iu.body.upgrades.some((u) => u.name === "Thought Vessel"));
  const sp = await call(db, "captain-america-team-leader", 25, "splash");
  check("splash: precon still excluded", !sp.body.upgrades.some((u) => u.name === "Thought Vessel"));
}

// --- Anchor deletion leak (Charlie second review, item 3) ---
{
  const db = makeDb();
  seedBasic(db, {
    membership: ["Precon Card"],
    synergy: [
      { id: "oldA", name: "Precon Card", usd: 1, rate: 0.9, role: "synergy", score: 10, flag: 1 },
      { id: "good", name: "Good Upgrade", usd: 1, rate: 0.8, role: "synergy", score: 9 },
    ],
  });
  // Simulate printing replacement: delete flagged anchor, insert replacement with NULL flag
  db.prepare(`DELETE FROM commander_synergy WHERE scryfall_id = ?`).run("oldA");
  db.prepare(`DELETE FROM cards WHERE scryfall_id = ?`).run("oldA");
  db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?)`).run("newB", "Precon Card", 1, "img", "Creature");
  db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, raw_score) VALUES (?, ?, ?, ?, ?)`).run("captain-america-team-leader", "newB", 0.9, "synergy", 10);
  db.prepare(`INSERT INTO global_rates VALUES (?, ?, ?)`).run("newB", "WRU", 0.05);
  const { body } = await call(db, "captain-america-team-leader");
  check("anchor deletion: replacement still excluded by membership", !body.upgrades.some((u) => u.name === "Precon Card"));
  check("anchor deletion: audit still lists Precon Card", body.preconExcluded.some((x) => x.name === "Precon Card"));
}

// --- Window starvation: 400 unflagged aliases before eligible ---
{
  const db = makeDb();
  seedBasic(db, { membership: ["Alias Card"] });
  // 400 alias rows, higher scores than eligible, all same membership name, unflagged
  for (let i = 0; i < 400; i++) {
    const id = `alias${i}`;
    db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?)`).run(id, "Alias Card", 0.1, "img", "Creature");
    db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, raw_score) VALUES (?, ?, ?, ?, ?)`).run("captain-america-team-leader", id, 0.9, "synergy", 1000 - i);
    db.prepare(`INSERT INTO global_rates VALUES (?, ?, ?)`).run(id, "WRU", 0.05);
  }
  db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?)`).run("elig1", "Eligible Card", 0.5, "img", "Creature");
  db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, raw_score) VALUES (?, ?, ?, ?, ?)`).run("captain-america-team-leader", "elig1", 0.5, "synergy", 1);
  db.prepare(`INSERT INTO global_rates VALUES (?, ?, ?)`).run("elig1", "WRU", 0.05);
  const { body } = await call(db, "captain-america-team-leader");
  check("window: eligible at rank 401 still returned (membership before LIMIT)", body.upgrades.some((u) => u.name === "Eligible Card"), JSON.stringify(body.upgrades.map((u) => u.name)));
  check("window: aliases absent", !body.upgrades.some((u) => u.name === "Alias Card"));
}

// --- All-flagged / all-precon ---
{
  const db = makeDb();
  seedBasic(db, {
    membership: ["Only Precon"],
    synergy: [{ id: "only1", name: "Only Precon", usd: 1, rate: 0.9, role: "synergy", score: 10, flag: 1 }],
  });
  const { status, body } = await call(db, "captain-america-team-leader");
  check("all-precon: status 200 (not EDHREC error)", status === 200, JSON.stringify(body).slice(0, 300));
  check("all-precon: upgrades empty, audit retained", body.upgrades.length === 0 && body.preconExcluded.some((x) => x.name === "Only Precon"));
  check("all-precon: flag true", body.allPreconExcluded === true);
}

// --- Missing type_line fallback (flag present) ---
{
  const db = makeDb({ withTypeLine: false });
  seedBasic(db, {
    membership: ["Thought Vessel"],
    synergy: [
      { id: "p1", name: "Thought Vessel", usd: 0.1, rate: 0.9, role: "synergy", score: 10, flag: 1 },
      { id: "u1", name: "Good Upgrade", usd: 1, rate: 0.8, role: "synergy", score: 9 },
    ],
  });
  const { status, body } = await call(db, "captain-america-team-leader");
  check("missing type_line: fallback succeeds, precon excluded", status === 200 && !body.upgrades.some((u) => u.name === "Thought Vessel") && body.upgrades.some((u) => u.name === "Good Upgrade"), `status=${status} ${JSON.stringify(body).slice(0, 300)}`);
}

// --- Missing flag column -> 500, not protected success ---
{
  const db = makeDb({ withFlag: false });
  seedBasic(db, {
    membership: ["Thought Vessel"],
    synergy: [{ id: "p1", name: "Thought Vessel", usd: 0.1, rate: 0.9, role: "synergy", score: 10 }],
  });
  const { status, body } = await call(db, "captain-america-team-leader");
  check("missing flag column: 500 fail-closed", status === 500, `status=${status} ${JSON.stringify(body).slice(0, 200)}`);
}

// --- Missing membership table -> 500, not empty audit ---
{
  const db = makeDb({ withMembership: false });
  // seed without membership table: insert commander + synergy manually
  db.prepare(`INSERT INTO commanders VALUES (?, ?, ?, ?, ?, ?, ?)`).run("captain-america-team-leader", "Captain America, Team Leader", "WRU", 1000, "live", 1, null);
  db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?)`).run("u1", "Good Upgrade", 1, "img", "Creature");
  db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, in_base_precon, raw_score) VALUES (?, ?, ?, ?, ?, ?)`).run("captain-america-team-leader", "u1", 0.8, "synergy", 0, 9);
  db.prepare(`INSERT INTO global_rates VALUES (?, ?, ?)`).run("u1", "WRU", 0.05);
  const { status } = await call(db, "captain-america-team-leader");
  check("missing membership table: 500 fail-closed", status === 500, `status=${status}`);
}

// --- Unflagged regression (Arabella-like, no membership) ---
{
  const db = makeDb();
  db.prepare(`INSERT INTO commanders VALUES (?, ?, ?, ?, ?, ?, ?)`).run("arabella-abandoned-doll", "Arabella, Abandoned Doll", "WR", 1000, "live", 1, null);
  db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?)`).run("a1", "Loyal Apprentice", 0.26, "img", "Creature");
  db.prepare(`INSERT INTO commander_synergy (commander_slug, scryfall_id, cmdr_rate, role, in_base_precon, raw_score) VALUES (?, ?, ?, ?, ?, ?)`).run("arabella-abandoned-doll", "a1", 0.8, "synergy", 0, 9);
  db.prepare(`INSERT INTO global_rates VALUES (?, ?, ?)`).run("a1", "WR", 0.05);
  const { status, body } = await call(db, "arabella-abandoned-doll");
  check("unflagged: upgrades present, preconExcluded []", status === 200 && body.upgrades.some((u) => u.name === "Loyal Apprentice") && body.preconExcluded.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
