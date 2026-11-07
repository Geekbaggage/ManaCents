#!/usr/bin/env python3
"""ManaBase Search — Phase 2 producer: price + display model + legality.

Reads the Phase 1 roster + pinned Scryfall bulk, writes
~/workspace/manabase-search/phase2/search_data.json + prints a full summary
(the Phase 2 report is written from that summary).

Scope (per the CEO-approved build plan + the Phase 2 task):
- Served set = verified 1,053 rows + the 48 no-mana-no-type utility rows
  (flagged "utility — display only, pending Charlie Q5", NOT held).
- EXCLUDED entirely: 101 face-rows (96 MDFC + 5 adventure, wait on Q4),
  10 fetchlands (wait on fetch modeling), 100 excluded rows.
- Prices: cheapest printing in ANY finish (foils count — CEO policy Oct 23),
  from the PINNED default_cards bulk. Mirrors scripts/manabase-refresh.mjs:
  usd (nonfoil) / usd_foil (foil) / usd_etched (etched), cheapest wins,
  tie-break prefers nonfoil. Full provenance per Defect E on every row.
- Legality: shared eligibility.py metadata validation (fail-closed) +
  cross-checks against the dated GC snapshot and bulk legalities.
  Banned in the served set or a GC-flag mismatch ABORTS the run with no
  output. A metadata-validation failure excludes that row + fails loudly.
  Price gaps hold the row (excluded from output, listed in the report).
- Ranking (most-used counts) is NOT attached here — it waits on Q3
  (EDHREC terms, with Charlie). See fetch_edhrec.py for the validated
  fetcher + sample only.

Fail-closed: bulk SHA mismatch, roster-count mismatch, a missing oracle
row, a banned served row, or a GC mismatch aborts before any output is
written. This script writes NOTHING outside phase2/ and never touches
web/, the nightly refresh, or the optimizer release work.

Usage: python3 build_search_data.py
Exit 0 = clean run. Exit 1 = a row was excluded on legality grounds
(output still written, loudly reported) or a fatal abort.
"""
import gzip
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, "/home/hatch/workspace/manabase-catalog")
from land_classify import parse_colors, classify_entry, classify_cycle
from eligibility import validate_game_changer_metadata

BASE = Path("/home/hatch/workspace/manabase-search")
ROSTER_PATH = BASE / "phase1/roster.json"
ORACLE_BULK = BASE / "bulk/oracle-cards-20261107100202.jsonl.gz"
DEFAULT_BULK = BASE / "bulk/default-cards-20261107100655.jsonl.gz"
GC_PATH = BASE / "phase1/gamechangers_checked_2026-11-07.json"
OUT_PATH = BASE / "phase2/search_data.json"

EXPECTED_ORACLE_SHA = "3a2ad385b3791fa3997fca5d6ffc9fcd4d6a8837ffe8871c1e120ed6a6318ed1"
EXPECTED_DEFAULT_SHA = "dab6246b7bdaefce96d1f49fe5f99359cc09fce3580dafa743d1fd916ebb8065"
PRICE_BULK_UPDATED = "2026-11-07T10:06:55Z"  # from bulk_manifest.json
PRICE_SNAPSHOT = "2026-11-07"
UTILITY_REASON = "no mana ability and no basic land type — pending utility review"
UTILITY_FLAG = "utility — display only, pending Charlie Q5"

PRICE_FIELDS = (("usd", "nonfoil"), ("usd_foil", "foil"), ("usd_etched", "etched"))


def resolve_printing_oracle_id(card):
    """Canonical oracle_id for a default_cards printing (Q9, Charlie).

    Normal printings carry top-level oracle_id. Reversible printings may
    not — their identities live on the faces (all faces of a reversible
    printing share one canonical oracle_id). Returns (oracle_id, via) where
    via is 'top' or 'faces'; (None, 'ambiguous') if the faces disagree
    (never guess), (None, 'missing') if no identity at all. Added Nov 7
    after the face-rows build found 92 bulk printings without top-level
    oracle_id (12 resolving to served oracle_ids); verified 0 impact on
    the served cheapest quotes (none was cheaper than the filed quote).
    """
    oid = card.get("oracle_id")
    if oid:
        return oid, "top"
    faces = card.get("card_faces") or []
    ids = {f.get("oracle_id") for f in faces if f.get("oracle_id")}
    if len(ids) == 1:
        return next(iter(ids)), "faces"
    if len(ids) == 0:
        return None, "missing"
    return None, "ambiguous"


def fail(msg):
    print(f"FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    today = datetime.now(timezone.utc).date().isoformat()
    print(f"Phase 2 producer — run date (UTC): {today}")

    # --- bulk integrity (fail-closed) ---
    for path, expected in ((ORACLE_BULK, EXPECTED_ORACLE_SHA),
                           (DEFAULT_BULK, EXPECTED_DEFAULT_SHA)):
        got = sha256_file(path)
        if got != expected:
            fail(f"bulk SHA mismatch: {path.name} got {got} expected {expected}")
    print("bulk SHAs verified (oracle + default_cards)")

    roster = json.loads(ROSTER_PATH.read_text())
    verified = [r for r in roster if r["status"] == "verified"]
    utility = [r for r in roster if r["status"] == "held" and r["reason"] == UTILITY_REASON]
    face_rows = [r for r in roster if r["status"] == "held"
                 and r["reason"].endswith("pending face-policy decision")]
    fetch_rows = [r for r in roster if r["status"] == "held"
                  and r["reason"].startswith("typed fetchland")]
    if len(verified) != 1053:
        fail(f"expected 1053 verified rows, got {len(verified)}")
    if len(utility) != 48:
        fail(f"expected 48 utility-review rows, got {len(utility)}")
    if len(face_rows) != 101:
        fail(f"expected 101 face-rows, got {len(face_rows)}")
    if len(fetch_rows) != 10:
        fail(f"expected 10 fetch rows, got {len(fetch_rows)}")
    print(f"roster reconciled: verified 1053 + utility 48; "
          f"face-rows 101 + fetch 10 excluded from this build")
    targets = verified + utility
    target_ids = {r["oracle_id"] for r in targets}
    by_id = {r["oracle_id"]: r for r in targets}

    gc = json.loads(GC_PATH.read_text())
    gc_names = set(gc["names"])
    print(f"GC snapshot: {gc['total_cards']} names, checked {gc['checked_date']}")

    # --- stream oracle bulk: oracle text + type line + bulk legality ---
    oracle = {}
    with gzip.open(ORACLE_BULK, "rt") as fh:
        for line in fh:
            c = json.loads(line)
            oid = c.get("oracle_id")
            if oid in target_ids:
                oracle[oid] = {
                    "oracle_text": c.get("oracle_text"),
                    "type_line": c.get("type_line"),
                    "commander_legality": (c.get("legalities") or {}).get("commander"),
                    "layout": c.get("layout"),
                }
                if len(oracle) == len(target_ids):
                    break
    missing = target_ids - set(oracle)
    if missing:
        fail(f"{len(missing)} target rows missing from oracle bulk: "
             f"{sorted(by_id[o]['name'] for o in list(missing)[:10])}")
    print(f"oracle text loaded for {len(oracle)} target rows")

    # --- stream default_cards bulk: cheapest printing per oracle_id ---
    best = {}       # oracle_id -> cheapest dict
    printings_seen = {}  # oracle_id -> count of printings with any USD price
    gold_skipped = {}  # oracle_id -> count of gold-bordered printings skipped
    preorder_skipped = {}  # oracle_id -> count of unreleased printings skipped
    reversible_resolved = 0
    reversible_anomalies = []
    with gzip.open(DEFAULT_BULK, "rt") as fh:
        for line in fh:
            c = json.loads(line)
            oid, via = resolve_printing_oracle_id(c)
            if oid is None:
                if via == "ambiguous":
                    reversible_anomalies.append(
                        f"{c.get('name')} ({c.get('id')}): faces disagree on oracle_id")
                continue
            if oid not in target_ids:
                continue
            if via == "faces":
                reversible_resolved += 1
            prices = c.get("prices") or {}
            # Preorder/unreleased printings are NOT buyable at the snapshot
            # date: the pinned Nov 6 bulk already contains the Nov 13 Star
            # Trek printings (TRK/TRC/SDS) with preorder prices. Without
            # this filter the cheapest pick for 18 rows was a preorder price
            # (e.g. Hallowed Fountain $4.18 TRK #286 foil vs $7.55 released)
            # — a price no buyer could actually pay on Nov 6. Added Nov 7
            # (Phase 5): only printings released by the price snapshot date
            # count toward the cheapest quote. Preorder quotes are kept as a
            # separate view in Charlie's sort data, never as the served price.
            if (c.get("released_at") or "") > PRICE_SNAPSHOT:
                preorder_skipped[oid] = preorder_skipped.get(oid, 0) + 1
                continue
            # Gold-bordered printings (World Championship / Pro Tour
            # Collector sets) are commemorative, not tournament-playable —
            # and Scryfall's card search API does not return them, so the
            # live-search refresh producer never picks them. The bulk DOES
            # contain them (19 winners before this filter, incl. Gaea's
            # Cradle $303.59 WC99 vs ~$600+ playable). Excluding them keeps
            # the bulk producer aligned with the live producer and with
            # the buy list's purpose.
            if c.get("border_color") == "gold":
                gold_skipped[oid] = gold_skipped.get(oid, 0) + 1
                continue
            for field, finish in PRICE_FIELDS:
                v = prices.get(field)
                if v is None:
                    continue
                try:
                    n = float(v)
                except (TypeError, ValueError):
                    continue
                if n < 0 or n != n:  # negative / NaN guard
                    continue
                printings_seen[oid] = printings_seen.get(oid, 0) + 1
                cur = best.get(oid)
                # strict < keeps the first (nonfoil) on a tie
                if cur is None or n < cur["price"]:
                    games = c.get("games") or []
                    best[oid] = {
                        "price": n,
                        "currency": "USD",
                        "finish": finish,
                        "price_field": field,
                        "printing": f"{(c.get('set') or '').upper()} #{c.get('collector_number')}",
                        "set": (c.get("set") or "").upper(),
                        "set_name": c.get("set_name"),
                        "collector_number": c.get("collector_number"),
                        "printing_id": c.get("id"),
                        "scryfall_uri": c.get("scryfall_uri"),
                        "market": "TCGplayer market (via Scryfall)",
                        "retailer": "Scryfall",
                        "observed_at": PRICE_BULK_UPDATED,
                        "legalities_at": PRICE_BULK_UPDATED,
                        "oversized": bool(c.get("oversized")),
                        "paper": "paper" in games,
                    }
    print(f"cheapest printings found for {len(best)}/{len(target_ids)} target rows")
    print(f"preorder/unreleased printings skipped: "
          f"{sum(preorder_skipped.values())} across {len(preorder_skipped)} rows")
    print(f"reversible printings resolved via faces: {reversible_resolved}")
    if reversible_anomalies:
        print(f"LOUD: {len(reversible_anomalies)} ambiguous reversible printings "
              f"skipped (faces disagree):")
        for a in reversible_anomalies[:10]:
            print(f"  REVERSIBLE-ANOMALY: {a}")

    # --- build rows ---
    rows = []
    held_price = []
    held_legality = []
    loud_legality = False
    for r in targets:
        oid = r["oracle_id"]
        name = r["name"]
        o = oracle[oid]

        # legality: shared metadata validation (fail-closed) + cross-checks
        gc_flag = bool(r["legality"]["game_changer"])
        expected_gc = name in gc_names or r["land_face_name"] in gc_names
        if gc_flag != expected_gc:
            fail(f"GC flag mismatch for {name}: roster={gc_flag} snapshot={expected_gc}")
        if r["legality"]["banned"] or o["commander_legality"] == "banned":
            fail(f"banned land in served set: {name} — aborting, no data written")
        if o["commander_legality"] != "legal":
            fail(f"served row {name} has bulk Commander legality "
                 f"{o['commander_legality']!r} (expected 'legal')")
        valid, reason = validate_game_changer_metadata(
            {"status": "yes" if gc_flag else "no",
             "source": r["legality"]["source"],
             "freshness": r["legality"]["freshness"]},
            today=today,
        )
        if not valid:
            held_legality.append(f"{name}: {reason}")
            loud_legality = True
            continue

        # price (gap = hold, never a stale/missing price)
        p = best.get(oid)
        if p is None:
            held_price.append(f"{name}: no USD price on any printing in the pinned bulk")
            continue

        # display model
        oracle_text = o["oracle_text"]
        if not isinstance(oracle_text, str) or not oracle_text.strip():
            held_price.append(f"{name}: no oracle text in bulk")
            continue
        colors = parse_colors(oracle_text, o["type_line"])
        entry = classify_entry(oracle_text)
        is_utility = r in utility
        cycle = classify_cycle(
            oracle_text, o["type_line"], name, is_basic=r["basic"],
            colors_produced=colors["colors_produced"],
            entry_status=entry["status"],
        )
        rows.append({
            "oracle_id": oid,
            "name": name,
            "is_basic": bool(r["basic"]),
            "status": "utility_display_only" if is_utility else "verified",
            "utility_flag": UTILITY_FLAG if is_utility else None,
            "colors_produced": colors["colors_produced"],
            "conditional_colors": colors["conditional_colors"],
            "produces_colorless": colors["produces_colorless"],
            "conditional_colorless": colors["conditional_colorless"],
            "production_notes": colors["notes"],
            "color_identity": r["color_identity"],
            "entry": entry,
            "cycle": cycle,
            "oracle_text": oracle_text,
            "cheapest": p,
            "legality": {
                "banned": False,
                "game_changer": gc_flag,
                "commander_legality": "legal",
                "source": r["legality"]["source"],
                "freshness": r["legality"]["freshness"],
            },
            # Q1 (Val, Nov 6): basics shown with a hide toggle, but EXCLUDED
            # from buy-whole-set by default.
            "in_buy_set_by_default": not bool(r["basic"]),
        })

    # --- summary ---
    total = round(sum(r["cheapest"]["price"] for r in rows), 2)
    import collections
    cycles = collections.Counter(r["cycle"] for r in rows)
    entries = collections.Counter(r["entry"]["status"] for r in rows)
    unclassified = sorted(r["name"] for r in rows if r["cycle"] == "unclassified")
    no_colored = sorted(
        r["name"] for r in rows
        if not r["colors_produced"] and not r["conditional_colors"]
    )
    oversized_wins = sorted(
        r["name"] for r in rows if r["cheapest"]["oversized"]
    )
    nonpaper_wins = sorted(
        r["name"] for r in rows if not r["cheapest"]["paper"]
    )
    gc_served = sorted(r["name"] for r in rows if r["legality"]["game_changer"])
    basics_served = sorted(r["name"] for r in rows if r["is_basic"])
    prices = sorted(r["cheapest"]["price"] for r in rows)

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "generator": "build_search_data.py (phase2)",
        "roster": "phase1/roster.json (1312 rows)",
        "price_snapshot": PRICE_SNAPSHOT,
        "price_bulk": DEFAULT_BULK.name,
        "price_bulk_sha256": EXPECTED_DEFAULT_SHA,
        "oracle_bulk": ORACLE_BULK.name,
        "oracle_bulk_sha256": EXPECTED_ORACLE_SHA,
        "gc_snapshot": "gamechangers_checked_2026-11-07.json (53 cards)",
        "policy": "cheapest RELEASED printing in ANY finish (foils count); "
                  "preorder/unreleased printings excluded (corrected Nov 7, "
                  "Phase 5 — 18 rows had picked Nov 13 Star Trek preorder prices)",
        "served_rows": len(rows),
        "served_verified": sum(1 for r in rows if r["status"] == "verified"),
        "served_utility_display_only": sum(1 for r in rows if r["status"] == "utility_display_only"),
        "held_price_gap": held_price,
        "held_legality": held_legality,
        "excluded_face_rows": 101,
        "excluded_fetch_rows": 10,
        "buy_set_default": "basics excluded from buy-whole-set by default (Q1, Val Nov 6)",
        "cheapest_set_total": total,
        "ranking": "not yet attached — most-used counts wait on Q3 (EDHREC terms)",
    }
    OUT_PATH.write_text(json.dumps({"meta": meta, "rows": rows}, indent=1) + "\n")
    print(f"\nwrote {OUT_PATH}: {len(rows)} rows")
    print(f"served verified: {meta['served_verified']}, utility display-only: "
          f"{meta['served_utility_display_only']}")
    print(f"cheapest {len(rows)}-land set total: ${total:.2f}")
    print(f"price range: ${prices[0]:.2f} – ${prices[-1]:.2f} "
          f"(median ${prices[len(prices)//2]:.2f})")
    print(f"held on price gaps: {len(held_price)}")
    for h in held_price:
        print(f"  PRICE-HOLD: {h}")
    print(f"held on legality: {len(held_legality)}")
    for h in held_legality:
        print(f"  LEGALITY-HOLD: {h}")
    print(f"cycles: {dict(cycles)}")
    print(f"entry: {dict(entries)}")
    print(f"unclassified cycle: {len(unclassified)}")
    print(f"  {', '.join(unclassified[:40])}")
    print(f"no colored production: {len(no_colored)}")
    print(f"  {', '.join(no_colored[:25])}")
    print(f"cheapest pick is oversized: {len(oversized_wins)} {oversized_wins}")
    print(f"cheapest pick is non-paper: {len(nonpaper_wins)} {nonpaper_wins}")
    print(f"GC served: {gc_served}")
    print(f"basics served: {basics_served}")
    if loud_legality:
        print("\nLOUD: legality metadata failures excluded rows (see LEGALITY-HOLD above).",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
