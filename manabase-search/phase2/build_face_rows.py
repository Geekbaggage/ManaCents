#!/usr/bin/env python3
"""ManaBase Search — Phase 2 follow-up: Q4 face-rows display data.

Builds ~/workspace/manabase-search/phase2/face_rows.json — one row per
canonical card/Oracle identity for the 101 held face-rows (96 DFC + 5
adventure), following Charlie's Q4 dispositions exactly (Drive
1GP1NcXoKX2qp21vgmb4ekfMGOmryWL0Z):

- One row per canonical card/Oracle identity; whole-card color identity
  (both faces / Adventure); one whole-card cheapest-printing quote with
  full Defect E provenance (cheapest-any-finish, foils count).
- Land-drop availability explicit per class:
    modal           — land face is a playable choice under normal land-play
                      rules; show the other face.
    transform_front — front face can be played as the land; show
                      transformation information.
    transform_back  — NOT an ordinary land drop from hand; the land face is
                      reached by transformation or another specified effect.
    adventure       — the printed land and its Adventure are characteristics
                      of one card, not two purchases.
- Buy lists export the canonical purchasable card name (full "X // Y"),
  never an isolated back-face name or a duplicate second face.
- Search display only — showing a card here does NOT certify its solver
  model (optimizer support is separate).

Multi-land-face cards (found by the fail-closed run, not assumed):
11 of the 101 have TWO land faces — the 10 Pathways (modal_dfc, both
faces are lands) and Havengul Laboratory // Havengul Mystery (transform,
front AND back are lands). Q4's one-row-per-canonical-identity rule still
holds: one row, with a `land_faces` array (one entry per land face) and
row-level colors/entry aggregated across the faces (union of production;
entry is the shared status, or "varies" with per-face detail). A Pathway's
alternative face IS a land face, so it is shown as one — never as a
non-land "other face". For transform_front with a second land face, the
land-drop note adds that the back face is also a land, reached by
transformation.

Q9 reversible handling (Charlie): printings whose top-level oracle_id is
absent resolve via their faces' oracle_ids; all faces of a reversible
printing share one canonical oracle_id — dedupe on it, never create two
rows for identical reversible faces. Preserve the actual physical printing
UUID in provenance. Gold-bordered printings are skipped (same rule as
Phase 2; pending Charlie's confirmation as standing policy).

Fail-closed: bulk SHA mismatch, roster-count mismatch, a missing oracle
row, a CI mismatch vs the roster, a banned served row, a GC mismatch, a
card with != 1 land face, or a class-count mismatch aborts before any
output is written. This script writes NOTHING outside phase2/ and never
touches web/, the nightly refresh, or the optimizer release work.

Usage: python3 build_face_rows.py
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
ORACLE_BULK = BASE / "bulk/oracle-cards-20261106220205.jsonl.gz"
DEFAULT_BULK = BASE / "bulk/default-cards-20261106220652.jsonl.gz"
GC_PATH = BASE / "phase1/gamechangers_checked_2026-11-07.json"
SEARCH_DATA_PATH = BASE / "phase2/search_data.json"
OUT_PATH = BASE / "phase2/face_rows.json"
REPORT_PATH = BASE / "phase2/face_rows_report.md"

EXPECTED_ORACLE_SHA = "ccbc99fd81dd4fd1a6109b40f61b9d449253204217a93cd4037ba490e452135f"
EXPECTED_DEFAULT_SHA = "dc826f98adc6d1d9715613d6e45f8833ccfc52cd23b53efccb88aa96f90799bf"
PRICE_BULK_UPDATED = "2026-11-06T22:06:52Z"  # from bulk_manifest.json
PRICE_SNAPSHOT = "2026-11-06"

PRICE_FIELDS = (("usd", "nonfoil"), ("usd_foil", "foil"), ("usd_etched", "etched"))
BASIC_TYPES = ("Plains", "Island", "Swamp", "Mountain", "Forest")

# Q4 class model (Charlie's table + rules text).
LAND_DROP = {
    "modal": (
        "playable_choice",
        "The land face is a playable choice under normal land-play rules; "
        "the other face is shown.",
    ),
    "transform_front": (
        "land_front",
        "The front face can be played as the land; transformation "
        "information is shown.",
    ),
    "transform_back": (
        "requires_transformation",
        "Not an ordinary land drop from hand — the land face is reached by "
        "transformation or another specified effect.",
    ),
    "adventure": (
        "single_card",
        "The printed land and its Adventure are characteristics of one "
        "card, not two purchases.",
    ),
}
EXPECTED_CLASS_COUNTS = {
    "modal": 60, "transform_front": 4, "transform_back": 32, "adventure": 5,
}


def fail(msg):
    print(f"FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def basic_types_of(type_line):
    """Land-face basic types, e.g. 'Land — Plains Island' -> ['Plains', 'Island']."""
    if "—" in type_line:
        subtypes = type_line.split("—", 1)[1]
    elif "-" in type_line:
        subtypes = type_line.split("-", 1)[1]
    else:
        return []
    return [t for t in BASIC_TYPES if t in subtypes.split()]


def resolve_printing_oracle_id(card):
    """Canonical oracle_id for a default_cards printing (Q9).

    Normal printings carry top-level oracle_id. Reversible printings may
    not — their identities live on the faces. Returns (oracle_id, via) where
    via is 'top' or 'faces'; returns (None, 'ambiguous') if the faces
    disagree (never guess), (None, 'missing') if no identity at all.
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


def main():
    today = datetime.now(timezone.utc).date().isoformat()
    print(f"Face-rows producer (Q4) — run date (UTC): {today}")

    # --- bulk integrity (fail-closed) ---
    for path, expected in ((ORACLE_BULK, EXPECTED_ORACLE_SHA),
                           (DEFAULT_BULK, EXPECTED_DEFAULT_SHA)):
        got = sha256_file(path)
        if got != expected:
            fail(f"bulk SHA mismatch: {path.name} got {got} expected {expected}")
    print("bulk SHAs verified (oracle + default_cards)")

    roster = json.loads(ROSTER_PATH.read_text())
    face_targets = [r for r in roster if r["status"] == "held"
                    and r["reason"].endswith("pending face-policy decision")]
    if len(face_targets) != 101:
        fail(f"expected 101 face-rows in roster, got {len(face_targets)}")
    target_ids = {r["oracle_id"] for r in face_targets}
    by_id = {r["oracle_id"]: r for r in face_targets}
    print("roster reconciled: 101 face-rows targeted")

    # search_data.json must not already contain any of these (disjointness).
    search_data = json.loads(SEARCH_DATA_PATH.read_text())
    served_ids = {r["oracle_id"] for r in search_data["rows"]}
    overlap = target_ids & served_ids
    if overlap:
        fail(f"{len(overlap)} face-row oracle_ids already in search_data.json: "
             f"{sorted(overlap)[:5]}")
    print(f"disjointness OK: 0 of 101 face oracle_ids in search_data.json "
          f"({len(served_ids)} served rows)")

    gc = json.loads(GC_PATH.read_text())
    gc_names = set(gc["names"])
    print(f"GC snapshot: {gc['total_cards']} names, checked {gc['checked_date']}")

    # --- stream oracle bulk: whole-card identity + faces ---
    oracle = {}
    with gzip.open(ORACLE_BULK, "rt", encoding="utf-8") as fh:
        for line in fh:
            c = json.loads(line)
            oid = c.get("oracle_id")
            if oid in target_ids:
                oracle[oid] = c
                if len(oracle) == len(target_ids):
                    break
    missing = target_ids - set(oracle)
    if missing:
        fail(f"{len(missing)} target rows missing from oracle bulk: "
             f"{sorted(by_id[o]['name'] for o in list(missing)[:10])}")
    print(f"oracle cards loaded for {len(oracle)} face-rows")

    # --- stream default_cards bulk: cheapest printing per oracle_id ---
    best = {}
    printings_seen = {}
    gold_skipped = {}
    reversible_resolved = 0
    reversible_anomalies = []
    with gzip.open(DEFAULT_BULK, "rt", encoding="utf-8") as fh:
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
                if n < 0 or n != n:
                    continue
                printings_seen[oid] = printings_seen.get(oid, 0) + 1
                cur = best.get(oid)
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
                        "layout": c.get("layout"),
                    }
    print(f"cheapest printings found for {len(best)}/{len(target_ids)} face-rows")
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
    class_counts = {k: 0 for k in EXPECTED_CLASS_COUNTS}
    for r in face_targets:
        oid = r["oracle_id"]
        name = r["name"]
        card = oracle[oid]
        layout = card.get("layout")

        # whole-card color identity (Q4) — must match the roster.
        whole_ci = card.get("color_identity", [])
        if whole_ci != r["color_identity"]:
            fail(f"CI mismatch for {name}: bulk {whole_ci} vs roster "
                 f"{r['color_identity']} — aborting, no data written")
        if (card.get("legalities") or {}).get("commander") != "legal":
            fail(f"face row {name} has bulk Commander legality "
                 f"{(card.get('legalities') or {}).get('commander')!r} (expected 'legal')")

        # faces: one or two land faces (Pathways + Havengul have two —
        # see module docstring). Classify by layout + land-face position.
        faces = card.get("card_faces") or []
        land_faces = [(i, f) for i, f in enumerate(faces)
                      if "Land" in f.get("type_line", "")]
        if len(land_faces) < 1:
            fail(f"{name} (layout {layout}): expected >= 1 land face, "
                 f"found 0 — aborting, no data written")
        if len(land_faces) > 2:
            fail(f"{name} (layout {layout}): expected at most 2 land faces, "
                 f"found {len(land_faces)} — aborting, no data written")
        first_land_idx = land_faces[0][0]
        other_faces = [{"name": f.get("name", ""),
                        "type_line": f.get("type_line", "")}
                       for i, f in enumerate(faces)
                       if i not in {j for j, _ in land_faces}]
        if layout == "modal_dfc":
            face_class = "modal"
        elif layout == "transform":
            face_class = "transform_front" if first_land_idx == 0 else "transform_back"
        elif layout == "adventure":
            face_class = "adventure"
        else:
            fail(f"{name}: unexpected layout {layout!r} for a face row — aborting")
        class_counts[face_class] += 1
        drop_code, drop_note = LAND_DROP[face_class]
        if len(land_faces) == 2 and face_class == "modal":
            drop_note = ("Either land face is a playable choice under normal "
                         "land-play rules; both faces are lands.")
        if len(land_faces) == 2 and face_class == "transform_front":
            drop_note += (" The back face is also a land, reached by "
                          "transformation.")

        # legality: shared metadata validation (fail-closed) + cross-checks.
        gc_flag = bool(r["legality"]["game_changer"])
        expected_gc = name in gc_names or r["land_face_name"] in gc_names
        if gc_flag != expected_gc:
            fail(f"GC flag mismatch for {name}: roster={gc_flag} snapshot={expected_gc}")
        if r["legality"]["banned"]:
            fail(f"banned land in face rows: {name} — aborting, no data written")
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

        # price (gap = hold, never a stale/missing price).
        p = best.get(oid)
        if p is None:
            held_price.append(f"{name}: no USD price on any printing in the pinned bulk")
            continue

        # display model from the LAND FACE(S) (not the whole card).
        # Per-face models; row-level fields aggregate across faces
        # (union of production; shared entry status, else "varies").
        face_models = []
        for _, lf in land_faces:
            lf_text = lf.get("oracle_text", "") or ""
            lf_tl = lf.get("type_line", "")
            if not lf_text.strip():
                held_price.append(f"{name}: no oracle text on land face "
                                  f"{lf.get('name')} in bulk")
                face_models = None
                break
            lf_colors = parse_colors(lf_text, lf_tl)
            lf_entry = classify_entry(lf_text)
            face_models.append({
                "name": lf.get("name", ""),
                "type_line": lf_tl,
                "oracle_text": lf_text,
                "colors_produced": lf_colors["colors_produced"],
                "conditional_colors": lf_colors["conditional_colors"],
                "produces_colorless": lf_colors["produces_colorless"],
                "conditional_colorless": lf_colors["conditional_colorless"],
                "production_notes": lf_colors["notes"],
                "basic_types": basic_types_of(lf_tl),
                "entry": lf_entry,
            })
        if face_models is None:
            continue
        agg_colors = sorted({c for fm in face_models
                             for c in fm["colors_produced"]},
                            key=lambda c: ["W", "U", "B", "R", "G"].index(c))
        agg_cond = {}
        for fm in face_models:
            for cc in fm["conditional_colors"]:
                agg_cond.setdefault(cc["color"], cc["dependency"])
        agg_cond_list = [{"color": c, "dependency": d}
                         for c, d in sorted(agg_cond.items())]
        agg_notes = sorted({n for fm in face_models
                            for n in fm["production_notes"]})
        agg_basic_types = sorted({t for fm in face_models
                                  for t in fm["basic_types"]},
                                 key=lambda t: ["Plains", "Island", "Swamp",
                                                "Mountain", "Forest"].index(t))
        entry_statuses = {fm["entry"]["status"] for fm in face_models}
        if len(entry_statuses) == 1:
            entry = face_models[0]["entry"]
        else:
            entry = {"status": "varies",
                     "condition": "entry differs by land face — see land_faces"}
        first_text = face_models[0]["oracle_text"]
        first_tl = face_models[0]["type_line"]
        cycle = classify_cycle(
            first_text, first_tl, r["land_face_name"], is_basic=False,
            colors_produced=agg_colors,
            entry_status=entry["status"] if entry["status"] != "varies" else None,
        )
        rows.append({
            "oracle_id": oid,
            "name": name,
            "land_face_name": r["land_face_name"],
            "face_class": face_class,
            "land_drop": {"code": drop_code, "note": drop_note},
            "land_faces": face_models,
            "other_faces": other_faces,
            "is_basic": False,
            "status": "face_row",
            "utility_flag": None,
            "colors_produced": agg_colors,
            "conditional_colors": agg_cond_list,
            "produces_colorless": any(fm["produces_colorless"]
                                      for fm in face_models),
            "conditional_colorless": any(fm["conditional_colorless"]
                                         for fm in face_models),
            "production_notes": agg_notes,
            # Whole-card color identity (Q4) — both faces / Adventure.
            "color_identity": whole_ci,
            # Basic types from the LAND FACE(S)' type lines (fits-mode needs
            # them; the oracle bulk's top-level type_line is the combined
            # "X // Y" line and must not be used for face rows).
            "basic_types": agg_basic_types,
            "entry": entry,
            "cycle": cycle,
            "oracle_text": first_text,
            "cheapest": p,
            "legality": {
                "banned": False,
                "game_changer": gc_flag,
                "commander_legality": "legal",
                "source": r["legality"]["source"],
                "freshness": r["legality"]["freshness"],
            },
            # Buy lists export the canonical purchasable card name (Q4).
            "buy_name": name,
            "in_buy_set_by_default": True,
        })

    # --- class-count validation (Q4) ---
    for cls, expected in EXPECTED_CLASS_COUNTS.items():
        got = class_counts[cls]
        if got != expected:
            fail(f"class count mismatch: {cls} expected {expected}, got {got} "
                 f"— aborting, no data written")
    print(f"class counts verified: {class_counts}")

    # --- summary ---
    total = round(sum(r["cheapest"]["price"] for r in rows), 2)
    import collections
    cycles = collections.Counter(r["cycle"] for r in rows)
    entries = collections.Counter(r["entry"]["status"] for r in rows)
    gc_served = sorted(r["name"] for r in rows if r["legality"]["game_changer"])
    prices = sorted(r["cheapest"]["price"] for r in rows)
    gold_total = sum(gold_skipped.values())

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "generator": "build_face_rows.py (phase2, Q4)",
        "roster": "phase1/roster.json (1312 rows)",
        "price_snapshot": PRICE_SNAPSHOT,
        "price_bulk": "default-cards-20261106220652.jsonl.gz",
        "price_bulk_sha256": EXPECTED_DEFAULT_SHA,
        "oracle_bulk": "oracle-cards-20261106220205.jsonl.gz",
        "oracle_bulk_sha256": EXPECTED_ORACLE_SHA,
        "gc_snapshot": "gamechangers_checked_2026-11-07.json (53 cards)",
        "policy": "cheapest printing in ANY finish (foils count); one whole-card quote per canonical identity (Q4)",
        "face_rows": len(rows),
        "class_counts": dict(class_counts),
        "held_price_gap": held_price,
        "held_legality": held_legality,
        "gold_bordered_printings_skipped": gold_total,
        "reversible_printings_resolved_via_faces": reversible_resolved,
        "reversible_anomalies": reversible_anomalies,
        "cheapest_set_total": total,
        "ranking": "not yet attached — most-used counts wait on Q3 (EDHREC terms)",
        "q4_reference": "Charlie-To-Robin-Land-Search-Q2-Q3-Q4-Q9-2026-11-06.md (Drive 1GP1NcXoKX2qp21vgmb4ekfMGOmryWL0Z)",
    }
    OUT_PATH.write_text(json.dumps({"meta": meta, "rows": rows}, indent=1) + "\n")
    print(f"\nwrote {OUT_PATH}: {len(rows)} rows")
    print(f"cheapest {len(rows)}-land face set total: ${total:.2f}")
    if prices:
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
    print(f"gold-bordered printings skipped: {gold_total}")
    print(f"GC served: {gc_served}")
    if loud_legality:
        print("\nLOUD: legality metadata failures excluded rows (see LEGALITY-HOLD above).",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
