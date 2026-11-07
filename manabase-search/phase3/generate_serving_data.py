#!/usr/bin/env python3
"""Generate the search serving file from Phase 2 search_data.json.

Reads ~/workspace/manabase-search/phase2/search_data.json (1,101 rows) and
writes web/functions/api/_manabase_search.json on the search branch.

Trims per row (the API never returns these, so they do not ship):
- cheapest.scryfall_uri / market / retailer / price_field / oversized / paper /
  set_name — provenance keeps price, printing, set, collector_number,
  printing_id, observed_at, legalities_at, finish, currency.
- legality.source — the source is recorded once in meta.
- oracle_text on NON-utility rows — the UI shows Oracle text only for the
  48 utility display-only lands; shipping it for all 1,101 rows would add
  ~250 KB of text the API never serves.

Adds per row (not in search_data.json):
- basic_types — parsed from the pinned ORACLE bulk's type_line (e.g.
  "Land — Plains Island" → ["Plains", "Island"]). Needed for the
  "fits my commander" filter (Charlie's plan correction #1): whole-card
  color identity + basic-land-type restriction (CR 903.5c/d). Wastes is NOT
  a basic land type. Reversible printings (Charlie Q9) are printings, not
  Oracle cards — the oracle bulk's canonical rows are used, so no
  reversible-card rows appear here.
"""
import gzip
import json
import sys
from pathlib import Path

SEARCH_DIR = Path.home() / "workspace" / "manabase-search"
REPO = Path.home() / "workspace" / "manacents-infra"
SRC = SEARCH_DIR / "phase2" / "search_data.json"
OUT = REPO / "web" / "functions" / "api" / "_manabase_search.json"
ORACLE_BULK = SEARCH_DIR / "bulk" / "oracle-cards-20261106220205.jsonl.gz"

BASIC_TYPES = ("Plains", "Island", "Swamp", "Mountain", "Forest")

# Names that must never appear in the served set (held/excluded categories).
FACE_OR_FETCH_MUST_NOT_APPEAR = {
    "Bala Ged Recovery", "Jwari Disruption", "Hagra Mauling",
    "Flooded Strand", "Polluted Delta", "Scalding Tarn",
    "Karakas", "Library of Alexandria", "Tolarian Academy",
}


def parse_basic_types(type_line):
    # "Land — Plains Island" -> ["Plains", "Island"]; "Basic Land — Wastes"
    # -> [] (Wastes is not a basic land type). Subtypes after the em dash.
    if "—" in type_line:
        subtypes = type_line.split("—", 1)[1]
    elif "-" in type_line:
        subtypes = type_line.split("-", 1)[1]
    else:
        return []
    return [t for t in BASIC_TYPES if t in subtypes.split()]


def load_basic_types():
    type_lines = {}
    with gzip.open(ORACLE_BULK, "rt", encoding="utf-8") as f:
        for line in f:
            card = json.loads(line)
            type_lines[card["oracle_id"]] = card["type_line"]
    return {oid: parse_basic_types(tl) for oid, tl in type_lines.items()}


def trim_row(row, basic_types_by_oid):
    cheapest = row["cheapest"]
    out = {
        "oracle_id": row["oracle_id"],
        "name": row["name"],
        "is_basic": row["is_basic"],
        "status": row["status"],
        "utility_flag": row["utility_flag"],
        "colors_produced": row["colors_produced"],
        "conditional_colors": row["conditional_colors"],
        "produces_colorless": row["produces_colorless"],
        "conditional_colorless": row["conditional_colorless"],
        "production_notes": row["production_notes"],
        "color_identity": row["color_identity"],
        "basic_types": basic_types_by_oid[row["oracle_id"]],
        "entry": row["entry"],
        "cycle": row["cycle"],
        "cheapest": {
            "price": cheapest["price"],
            "currency": cheapest["currency"],
            "finish": cheapest["finish"],
            "printing": cheapest["printing"],
            "set": cheapest["set"],
            "collector_number": cheapest["collector_number"],
            "printing_id": cheapest["printing_id"],
            "observed_at": cheapest["observed_at"],
            "legalities_at": cheapest["legalities_at"],
        },
        "legality": {
            "banned": row["legality"]["banned"],
            "game_changer": row["legality"]["game_changer"],
            "commander_legality": row["legality"]["commander_legality"],
            "freshness": row["legality"]["freshness"],
        },
        "in_buy_set_by_default": row["in_buy_set_by_default"],
    }
    # Oracle text ships only for utility display-only lands (the UI shows it
    # there; nowhere else).
    if row["status"] == "utility_display_only":
        out["oracle_text"] = row["oracle_text"]
    return out


def main():
    data = json.loads(SRC.read_text())
    rows = data["rows"]
    src_meta = data["meta"]
    basic_types_by_oid = load_basic_types()

    assert len(rows) == 1101, f"expected 1101 rows, got {len(rows)}"
    names = {r["name"] for r in rows}
    leaked = names & FACE_OR_FETCH_MUST_NOT_APPEAR
    assert not leaked, f"held/excluded names leaked into serving data: {leaked}"
    assert all(not r["legality"]["banned"] for r in rows), "banned row in data"
    assert sum(1 for r in rows if r["is_basic"]) == 12, "expected 12 basics"
    assert sum(1 for r in rows if r["status"] == "utility_display_only") == 48
    assert all(
        (not r["is_basic"]) == r["in_buy_set_by_default"] for r in rows
    ), "buy-set default must be exactly non-basics (Q1)"
    assert all(r["oracle_id"] in basic_types_by_oid for r in rows), \
        "every served row must resolve to a bulk type_line"
    # Sanity: every basic land type found must be one of the five; spot
    # checks on known rows (shock = two types, basic = one, Wastes = none).
    by_name = {r["name"]: r for r in rows}
    assert basic_types_by_oid[by_name["Hallowed Fountain"]["oracle_id"]] == ["Plains", "Island"]
    assert basic_types_by_oid[by_name["Plains"]["oracle_id"]] == ["Plains"]
    assert basic_types_by_oid[by_name["Wastes"]["oracle_id"]] == []

    trimmed = [trim_row(r, basic_types_by_oid) for r in rows]
    out = {
        "meta": {
            "generated_from": "phase2/search_data.json",
            "generated_at": src_meta["generated_at"],
            "price_snapshot": src_meta["price_snapshot"],
            "price_bulk": src_meta["price_bulk"],
            "gc_snapshot": src_meta["gc_snapshot"],
            "policy": src_meta["policy"],
            "served_rows": len(trimmed),
            "served_verified": src_meta["served_verified"],
            "served_utility_display_only": src_meta["served_utility_display_only"],
            # Held out of search: 101 face-rows (96 MDFC + 5 adventure, Q4)
            # + 10 typed fetchlands (fetch modeling open).
            "held_count": 111,
            "held_face_rows": src_meta["excluded_face_rows"],
            "held_fetch_rows": src_meta["excluded_fetch_rows"],
            "excluded_count": 100,
            "cheapest_set_total": src_meta["cheapest_set_total"],
            # Most-used ranking is NOT attached — Q3 (EDHREC terms) with Charlie.
            "ranking": None,
            "ranking_note": (
                "Most-used ranking is not available yet — the data source "
                "is pending confirmation (Q3). Results sort by cheapest "
                "price until then."
            ),
            "buy_set_default": src_meta["buy_set_default"],
        },
        "rows": trimmed,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=True))
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes, {len(trimmed)} rows)")
    print(f"  source: {SRC} ({SRC.stat().st_size:,} bytes)")
    print(f"  price_snapshot: {out['meta']['price_snapshot']}, "
          f"cheapest set total: ${out['meta']['cheapest_set_total']:,.2f}")


if __name__ == "__main__":
    sys.exit(main())
