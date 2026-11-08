#!/usr/bin/env python3
"""Generate the search serving file from Phase 2 data + Charlie's Q14 sort.

Reads:
- ~/workspace/manabase-search/phase2/search_data.json (1,111 rows: 1,053
  verified + 48 utility display-only + 10 fetchlands)
- ~/workspace/manabase-search/phase2/face_rows.json (101 rows, Q4)
- ~/workspace/manabase-search/phase2/charlie-budget-land-sort-2026-11-07.json
  (Charlie's "Best budget — researched" sort, 25 type lists, 284 ranked
  entries / 283 distinct cards, $5.00-inclusive released-quote gate)

Writes web/functions/api/_manabase_search.json on the search branch.

Phase 5 changes (Nov 7, 2026):
- Face rows are WIRED IN: served 1,101 + 101 = 1,202 rows; held is the 10
  typed fetchlands only. Face-row `basic_types` comes from each face row
  itself (land-face type lines) — NEVER the bulk's combined "X // Y" type
  line, and the generator does not even look face rows up in the bulk.
- Fetchlands SERVED (Nov 7, 2026, CEO-approved): the 10 typed fetchlands
  are now in search_data.json (1,111 rows) with the fetch model (colorless
  CI [] per CR 903.4/903.5c — corrected Nov 7, Charlie + live Scryfall; the
  tutored types are search targets, not identity — no production,
  conditional tutor entry, cycle fetch). Served is now 1,111 + 101 = 1,212
  rows; held is 0. The
  FETCH_MUST_NOT_APPEAR guard is gone; the banned-name guard remains.
- Charlie's sort is attached per row as `budget_rankings` (one record per
  type the row is ranked in, from types[].members — the versioned per-role
  records; cards[].rankings is asserted to match). The $5.00-inclusive gate
  uses Charlie's RELEASED quote (500 cents, inclusive); preorder-only
  cards are separated into a meta watch list, never presented as buy-now
  budget picks. No EDHREC-derived metric is imported anywhere
  (restricted_usage_metrics_used=false, measured_most_played_claim=false
  in Charlie's file; the only "edhrec" mentions are disclaimers).
- Preorder correction (found by the Phase 5 live spot-check): the Nov 6
  producers had picked Nov 13 Star Trek preorder prices for 18 rows
  (e.g. Hallowed Fountain $4.18 TRK #286 foil vs $7.55 released). Both
  producers now exclude printings released after the price snapshot date;
  search_data.json was re-run (18 rows corrected, cheapest set total
  $19,372.78 -> $19,558.88; face_rows.json re-run with 0 changes).

Trims per row (the API never returns these, so they do not ship):
- cheapest.scryfall_uri / market / retailer / price_field / oversized / paper /
  set_name — provenance keeps price, printing, set, collector_number,
  printing_id, observed_at, legalities_at, finish, currency.
- legality.source — the source is recorded once in meta.
- Oracle text SHIPS on every row (CEO, Nov 7): the Search card shows the
  land's oracle text under it instead of the budget-rank research note.
  This adds ~250 KB to the serving file — accepted for readability.

SHA PROVENANCE CAVEAT (do not remove without re-verifying): Charlie's
handoff states the JSON SHA-256 is
dbfbf125d88a3335ee81b31ad8da02cb0497562287101df24df492cfb82b4da6, but the file
downloaded from Drive hashes to
5261fd25c198723f27d774a3697b6680747ecbee263f1ad325b26fd372f0a822 (also not
matching with a trailing newline stripped). Content checks all pass
(1,212 cards reconcile exactly with the search roster; counts, ranks and
quotes spot-checked against live Scryfall), so the data is treated as
verified-by-content, NOT byte-identical. Both SHAs are recorded in the
serving meta so the caveat travels with the data.
"""
import gzip
import json
import sys
from pathlib import Path

SEARCH_DIR = Path.home() / "workspace" / "manabase-search"
REPO = Path.home() / "workspace" / "manacents-infra"
SRC = SEARCH_DIR / "phase2" / "search_data.json"
FACE_SRC = SEARCH_DIR / "phase2" / "face_rows.json"
CHARLIE_SRC = SEARCH_DIR / "phase2" / "charlie-budget-land-sort-2026-11-07.json"
OUT = REPO / "web" / "functions" / "api" / "_manabase_search.json"
ORACLE_BULK = SEARCH_DIR / "bulk" / "oracle-cards-20261106220205.jsonl.gz"

BASIC_TYPES = ("Plains", "Island", "Swamp", "Mountain", "Forest")
BUDGET_GATE_CENTS = 500  # $5.00 inclusive, on the RELEASED quote (Charlie)

# Names that must never appear in the served set (banned cards).
BANNED_MUST_NOT_APPEAR = {
    "Karakas", "Library of Alexandria", "Tolarian Academy",
}

FETCH_NAMES = {
    "Arid Mesa", "Bloodstained Mire", "Flooded Strand", "Marsh Flats",
    "Misty Rainforest", "Polluted Delta", "Scalding Tarn",
    "Verdant Catacombs", "Windswept Heath", "Wooded Foothills",
}

CHARLIE_SHA_STATED = "dbfbf125d88a3335ee81b31ad8da02cb0497562287101df24df492cfb82b4da6"
CHARLIE_SHA_DOWNLOADED = "5261fd25c198723f27d774a3697b6680747ecbee263f1ad325b26fd372f0a822"


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


def trim_cheapest(cheapest):
    return {
        "price": cheapest["price"],
        "currency": cheapest["currency"],
        "finish": cheapest["finish"],
        "printing": cheapest["printing"],
        "set": cheapest["set"],
        "collector_number": cheapest["collector_number"],
        "printing_id": cheapest["printing_id"],
        "observed_at": cheapest["observed_at"],
        "legalities_at": cheapest["legalities_at"],
    }


def trim_legality(legality):
    return {
        "banned": legality["banned"],
        "game_changer": legality["game_changer"],
        "commander_legality": legality["commander_legality"],
        "freshness": legality["freshness"],
    }


def trim_face(face):
    # One land face of a face row: name, type line, oracle text, production,
    # basic types (from the face row itself), entry. No bulk lookup.
    return {
        "name": face["name"],
        "type_line": face["type_line"],
        "oracle_text": face["oracle_text"],
        "colors_produced": face["colors_produced"],
        "conditional_colors": face["conditional_colors"],
        "produces_colorless": face["produces_colorless"],
        "conditional_colorless": face["conditional_colorless"],
        "production_notes": face["production_notes"],
        "basic_types": list(face["basic_types"]),
        "entry": face["entry"],
    }


def trim_row(row, basic_types_by_oid, rankings_by_oid, preorder_by_oid):
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
        # Oracle text ships on every NON-basic row (CEO, Nov 7 — the Search
        # card shows it under the land). Basics carry only the "{T}: Add {W}"
        # reminder text in the bulk, which is not oracle text worth showing,
        # so they get no oracle_text field and the UI renders nothing.
        **({} if row["is_basic"] else {"oracle_text": row["oracle_text"]}),
        "cheapest": trim_cheapest(row["cheapest"]),
        "legality": trim_legality(row["legality"]),
        "in_buy_set_by_default": row["in_buy_set_by_default"],
        "budget_rankings": rankings_by_oid.get(row["oracle_id"], []),
        "preorder_only_under_5": preorder_by_oid.get(row["oracle_id"], False),
    }
    return out


def trim_face_row(row, rankings_by_oid, preorder_by_oid):
    # Face rows take basic_types from the face row itself — never the bulk's
    # combined "X // Y" type line, and no bulk lookup happens for them at all.
    assert isinstance(row["basic_types"], list), \
        f"face row {row['name']} must carry its own basic_types list"
    out = {
        "oracle_id": row["oracle_id"],
        "name": row["name"],
        "buy_name": row["buy_name"],
        "land_face_name": row["land_face_name"],
        "face_class": row["face_class"],
        "land_drop": row["land_drop"],
        "land_faces": [trim_face(f) for f in row["land_faces"]],
        "other_faces": [
            {"name": f["name"], "type_line": f["type_line"]}
            for f in row["other_faces"]
        ],
        "is_basic": row["is_basic"],
        "status": row["status"],
        "utility_flag": row["utility_flag"],
        "colors_produced": row["colors_produced"],
        "conditional_colors": row["conditional_colors"],
        "produces_colorless": row["produces_colorless"],
        "conditional_colorless": row["conditional_colorless"],
        "production_notes": row["production_notes"],
        "color_identity": row["color_identity"],
        "basic_types": list(row["basic_types"]),
        "entry": row["entry"],
        "cycle": row["cycle"],
        # Oracle text is the land face's text (verified: top-level equals
        # the land face's text on all 101 rows) — the Search card shows it.
        "oracle_text": row["oracle_text"],
        "cheapest": trim_cheapest(row["cheapest"]),
        "legality": trim_legality(row["legality"]),
        "in_buy_set_by_default": row["in_buy_set_by_default"],
        "budget_rankings": rankings_by_oid.get(row["oracle_id"], []),
        "preorder_only_under_5": preorder_by_oid.get(row["oracle_id"], False),
    }
    return out


def cents(usd_str):
    return int(round(float(usd_str) * 100))


def main():
    data = json.loads(SRC.read_text())
    rows = data["rows"]
    src_meta = data["meta"]
    face_data = json.loads(FACE_SRC.read_text())
    face_rows = face_data["rows"]
    face_meta = face_data["meta"]
    charlie = json.loads(CHARLIE_SRC.read_text())

    # ---- Charlie's sort data: index + cross-checks ----
    assert charlie["restricted_usage_metrics_used"] is False, \
        "Charlie's file must not use restricted usage metrics"
    assert charlie["measured_most_played_claim"] is False, \
        "Charlie's file must not claim a measured most-played order"
    assert charlie["ui_sort_label"] == "Best budget — researched"
    assert charlie["counts"]["catalog"] == 1212
    assert charlie["counts"]["default_ranked_entries"] == 284
    assert charlie["counts"]["default_ranked_unique_cards"] == 283
    assert charlie["counts"]["released_under_5"] == 1006
    assert charlie["counts"]["all_quotes_under_5"] == 1013

    rankings_by_oid = {}
    type_meta = []
    for t in charlie["types"]:
        ranked = sum(1 for m in t["members"] if m.get("default_recommendation"))
        type_meta.append({
            "id": t["id"], "label": t["label"],
            "members": len(t["members"]), "ranked": ranked,
        })
        for m in t["members"]:
            rec = {
                "type_id": t["id"],
                "type_label": t["label"],
                "editorial_rank": m["editorial_rank"],
                "tie_group": m.get("tie_group"),
                "default_recommendation": bool(m.get("default_recommendation")),
                "budget_eligible": bool(m.get("budget_eligible")),
                "preorder_only_under_5": bool(m.get("preorder_only_under_5")),
                "released_quote_usd": m.get("released_quote_usd"),
                "released_quote_cents": (
                    cents(m["released_quote_usd"])
                    if m.get("released_quote_usd") is not None else None
                ),
                "source_ids": list(m.get("source_ids") or []),
                "context": m.get("context"),
                "evidence_level": m.get("evidence_level"),
            }
            rankings_by_oid.setdefault(m["oracle_id"], []).append(rec)
    # cards[].rankings must mirror types[].members exactly.
    for c in charlie["cards"]:
        got = {(r["type_id"], r["editorial_rank"]) for r in c.get("rankings", [])}
        want = {(r["type_id"], r["editorial_rank"])
                for r in rankings_by_oid.get(c["oracle_id"], [])}
        assert got == want, f"rankings/member mismatch for {c['budget']['name']}"

    preorder_by_oid = {}
    preorder_watch = []
    for c in charlie["cards"]:
        b = c["budget"]
        pre = bool(b.get("preorder_only_under_5"))
        preorder_by_oid[c["oracle_id"]] = pre
        if pre:
            preorder_watch.append({
                "oracle_id": c["oracle_id"],
                "name": b["name"],
                "all_quoted_usd": b["cheapest_any_quoted_paper_default_language"]["price_usd"],
                "released_usd": b["cheapest_released_paper_default_language"]["price_usd"],
                "earliest_release": b["cheapest_any_quoted_paper_default_language"]["release_date"],
            })
    assert len(preorder_watch) == 7, f"expected 7 preorder-only cards, got {len(preorder_watch)}"

    # Every default-ranked entry must pass the $5.00-inclusive released gate
    # and must not be preorder-only (else the ranked view would present a
    # buy-now price that does not exist).
    for oid, recs in rankings_by_oid.items():
        for rec in recs:
            if rec["default_recommendation"]:
                assert rec["budget_eligible"], f"default-ranked {oid} not budget_eligible"
                assert rec["released_quote_cents"] is not None and \
                    rec["released_quote_cents"] <= BUDGET_GATE_CENTS, \
                    f"default-ranked {oid} released quote exceeds $5.00 gate"
                assert not rec["preorder_only_under_5"], \
                    f"default-ranked {oid} is preorder-only"

    basic_types_by_oid = load_basic_types()

    assert len(rows) == 1111, f"expected 1111 rows, got {len(rows)}"
    assert len(face_rows) == 101, f"expected 101 face rows, got {len(face_rows)}"
    names = {r["name"] for r in rows} | {r["name"] for r in face_rows}
    leaked = names & BANNED_MUST_NOT_APPEAR
    assert not leaked, f"banned names leaked into serving data: {leaked}"
    # The 10 fetchlands are SERVED now (Nov 7) — all must be present with
    # the fetch model (cycle fetch, no production, conditional tutor entry).
    fetch_rows = [r for r in rows if r["name"] in FETCH_NAMES]
    assert len(fetch_rows) == 10, f"expected 10 served fetch rows, got {len(fetch_rows)}"
    assert all(r["cycle"] == "fetch" for r in fetch_rows), "a fetch row is not cycle fetch"
    assert all(r["colors_produced"] == [] and r["conditional_colors"] == []
               for r in fetch_rows), "a fetch row produces mana"
    assert all(r["entry"]["status"] == "conditional" for r in fetch_rows), \
        "a fetch row is not a conditional entry"
    assert all(not r["legality"]["banned"] for r in rows + face_rows), "banned row in data"
    assert sum(1 for r in rows if r["is_basic"]) == 12, "expected 12 basics"
    assert sum(1 for r in face_rows if r["is_basic"]) == 0, "face rows must not be basic"
    assert sum(1 for r in rows if r["status"] == "utility_display_only") == 48
    assert all(r["status"] == "face_row" for r in face_rows)
    assert all(
        (not r["is_basic"]) == r["in_buy_set_by_default"] for r in rows + face_rows
    ), "buy-set default must be exactly non-basics (Q1)"
    assert all(r["oracle_id"] in basic_types_by_oid for r in rows), \
        "every search row must resolve to a bulk type_line"
    # Face rows are NOT looked up in the bulk: their basic_types come from
    # the face row itself (checked in trim_face_row).
    assert len({r["oracle_id"] for r in rows} & {r["oracle_id"] for r in face_rows}) == 0, \
        "duplicate oracle_id across search + face rows"
    # No null/unknown quotes may reach the serving file: a null price would
    # pass a max_price filter in JS (null <= 5 is true) and sort first.
    import math
    assert all(
        isinstance(r["cheapest"]["price"], (int, float))
        and math.isfinite(r["cheapest"]["price"])
        for r in rows + face_rows
    ), "a row has a null/non-finite cheapest price"
    # Spot checks on known rows (shock = two types, basic = one, Wastes = none).
    by_name = {r["name"]: r for r in rows}
    assert basic_types_by_oid[by_name["Hallowed Fountain"]["oracle_id"]] == ["Plains", "Island"]
    assert basic_types_by_oid[by_name["Plains"]["oracle_id"]] == ["Plains"]
    assert basic_types_by_oid[by_name["Wastes"]["oracle_id"]] == []
    # Coverage reconciles exactly: Charlie 1,212 = served 1,212 + 0 held.
    served_ids = {r["oracle_id"] for r in rows} | {r["oracle_id"] for r in face_rows}
    charlie_ids = {c["oracle_id"] for c in charlie["cards"]}
    assert served_ids <= charlie_ids, "served oracle_id missing from Charlie's catalog"
    held_ids = charlie_ids - served_ids
    assert len(held_ids) == 0, f"expected 0 held oracle_ids, got {len(held_ids)}"
    # Every Charlie type member resolves to a served row.
    assert set(rankings_by_oid) <= served_ids, "a ranked member is not served"
    # Face class counts (Q4).
    from collections import Counter
    assert Counter(r["face_class"] for r in face_rows) == {
        "modal": 60, "transform_front": 4, "transform_back": 32, "adventure": 5,
    }
    assert sum(1 for r in face_rows if r["land_drop"]["code"] == "requires_transformation") == 32

    trimmed = [trim_row(r, basic_types_by_oid, rankings_by_oid, preorder_by_oid)
               for r in rows]
    trimmed += [trim_face_row(r, rankings_by_oid, preorder_by_oid)
                for r in face_rows]
    assert len(trimmed) == 1212
    cheapest_total = round(
        sum(r["cheapest"]["price"] for r in trimmed), 2
    )
    assert abs(cheapest_total - (src_meta["cheapest_set_total"]
                                 + face_meta["cheapest_set_total"])) < 0.01
    out = {
        "meta": {
            "generated_from": "phase2/search_data.json + phase2/face_rows.json + phase2/charlie-budget-land-sort-2026-11-07.json",
            "generated_at": src_meta["generated_at"],
            "price_snapshot": src_meta["price_snapshot"],
            "price_bulk": src_meta["price_bulk"],
            "gc_snapshot": src_meta["gc_snapshot"],
            "policy": src_meta["policy"],
            "served_rows": len(trimmed),
            "served_verified": src_meta["served_verified"],
            "served_utility_display_only": src_meta["served_utility_display_only"],
            "served_face_rows": len(face_rows),
            # Held out of search: none — the full 1,212-card legal catalog
            # is served (fetchlands joined Nov 7; the 100 excluded rows are
            # 3 banned + 97 not Commander-legal and never enter search).
            "held_count": 0,
            "held_face_rows": 0,
            "held_fetch_rows": 0,
            "excluded_count": 100,
            "cheapest_set_total": cheapest_total,
            # Ranking: Charlie's editorial "Best budget — researched" sort
            # (Q14 interim, Nov 7). Most-used ranking is still NOT attached
            # — Q3 (EDHREC terms) with Charlie; no EDHREC-derived metric
            # is imported anywhere in this file.
            "ranking": {
                "sort": "best_budget",
                "label": "Best budget — researched",
                "snapshot": "2026-11-07",
                "source": "Charlie research 2026-11-07 (community + official sources; no EDHREC-derived metrics)",
                "ranked_entries": 284,
                "ranked_cards": 283,
                "type_lists": len(type_meta),
                "budget_gate_cents": BUDGET_GATE_CENTS,
                "preorder_only_under_5": len(preorder_watch),
                "sha_stated": CHARLIE_SHA_STATED,
                "sha_downloaded": CHARLIE_SHA_DOWNLOADED,
                "sha_match": CHARLIE_SHA_STATED == CHARLIE_SHA_DOWNLOADED,
                "sha_note": (
                    "SHA-256 of the downloaded file does not match the SHA "
                    "stated in Charlie's handoff; content verified instead "
                    "(1,212 cards reconcile exactly with the search roster; "
                    "counts, ranks and quotes spot-checked vs live Scryfall). "
                    "Verified-by-content, not byte-identical provenance."
                ),
            },
            "ranking_note": (
                "Best budget — researched: an editorial sort by land type from "
                "community + official research (Charlie, Nov 7, 2026), not a "
                "measured most-played order. Most-used ranking is still not "
                "available — its data source is pending confirmation (Q3)."
            ),
            "budget_types": type_meta,
            "preorder_watch": preorder_watch,
            "buy_set_default": src_meta["buy_set_default"],
        },
        "rows": trimmed,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=True))
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes, {len(trimmed)} rows)")
    print(f"  source: {SRC} ({SRC.stat().st_size:,} bytes) + "
          f"{FACE_SRC} ({FACE_SRC.stat().st_size:,} bytes)")
    print(f"  price_snapshot: {out['meta']['price_snapshot']}, "
          f"cheapest set total: ${out['meta']['cheapest_set_total']:,.2f}")
    print(f"  served: 1,111 search + 101 face = 1,212; held: 0 fetch; "
          f"ranked entries: 284; preorder watch: 7")
    print(f"  SHA caveat: stated {CHARLIE_SHA_STATED[:12]}… != downloaded "
          f"{CHARLIE_SHA_DOWNLOADED[:12]}… — verified-by-content")


if __name__ == "__main__":
    sys.exit(main())
