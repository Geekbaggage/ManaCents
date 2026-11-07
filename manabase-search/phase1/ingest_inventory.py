#!/usr/bin/env python3
"""ManaBase Search — Phase 1: bulk ingest + roster classification.

Reads the pinned Scryfall oracle_cards bulk file (streaming, never loaded whole),
builds the master land roster (one record per oracle_id), and classifies each row
as verified / held / unsupported per the all-land inventory plan.

Structural classification only (no oracle-text pattern classifier yet — that is
Stage 3 of the inventory plan). Rows the structural pass cannot decide are HELD
for human/classifier review, never auto-served on a guess. Price status is
"unknown" for every row in Phase 1; Phase 2 pricing moves price-unknown rows
to held.

Usage:
  python3 ingest_inventory.py
Assumes the pinned bulk files live in ../bulk/ and writes roster.json,
gamechangers_checked_2026-11-07.json, bulk_manifest.json and
inventory_report.md into this directory (phase1/).
"""
import gzip
import hashlib
import json
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BULK_DIR = HERE.parent / "bulk"
ORACLE_BULK = BULK_DIR / "oracle-cards-20261106220205.jsonl.gz"
UA = "ManaCents/1.0 (contact: geekbaggage@gmail.com)"
TODAY = "2026-11-07"
CLASSIFIER_VERSION = "structural-v1-2026-11-07"

BASIC_TYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"]
BANNED_EXPECTED = {"Karakas", "Library of Alexandria", "Tolarian Academy"}
GC_LANDS_EXPECTED = {
    "Ancient Tomb", "Field of the Dead", "Gaea's Cradle", "Glacial Chasm",
    "Mishra's Workshop", "Serra's Sanctum", "The Tabernacle at Pendrell Vale",
}

# Baseline to verify against (live Scryfall, 2026-11-05, from the hold scope doc).
BASELINE = {
    "total": 1212, "basic": 12, "nonbasic": 1200,
    "mdfc_land_face": 108, "fetchland": 10, "snow": 27, "legendary": 85,
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_game_changers():
    """Live Scryfall is:gamechanger search, paginated. Returns set of names."""
    names = set()
    url = "https://api.scryfall.com/cards/search?q=is%3Agamechanger"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    pages = 0
    while url:
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
        pages += 1
        for card in data.get("data", []):
            names.add(card["name"])
        url = data.get("next_page")
        if url:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    return names, pages


def land_faces(card):
    """Yield (face_name, type_line, oracle_text) for each land face of a card.

    Single-faced cards yield one face from the top level. DFCs yield one entry
    per card_face. Returns only faces whose type line contains 'Land'.
    """
    faces = card.get("card_faces")
    if faces:
        for face in faces:
            tl = face.get("type_line", "")
            if "Land" in tl:
                yield face.get("name", ""), tl, face.get("oracle_text", "")
    else:
        tl = card.get("type_line", "")
        if "Land" in tl:
            yield card.get("name", ""), tl, card.get("oracle_text", "")


def is_basic(type_line):
    return type_line.startswith("Basic Land") or "Basic Snow Land" in type_line


def has_mana_ability(oracle_text):
    # Tap-for-mana or mana-ability wording on the land face(s).
    return bool(re.search(r"\{T\}: Add|\bAdd \{[WUBRGC0-9]", oracle_text or ""))


def has_basic_type(type_line):
    # A basic land TYPE on the type line (after the em dash), e.g. "Land — Plains Island".
    after = type_line.split("—", 1)[-1] if "—" in type_line else type_line
    return any(t in after for t in BASIC_TYPES)


def is_true_fetchland(oracle_text):
    """Classic typed fetchlands: search for a land with specific basic land
    types, put it onto the battlefield UNTAPPED, pay 1 life + sacrifice.
    Excludes basic-only fetchers (Evolving Wilds, Fabled Passage,
    Terramorphic Expanse) and the Mirage slow fetches (Flood Plain,
    Grasslands, Mountain Valley, Rocky Tar Pit), whose target enters tapped.
    """
    t = oracle_text or ""
    if "Search your library for" not in t:
        return False
    if "onto the battlefield tapped" in t:
        return False
    if "enters tapped" in t:
        return False
    if "put it onto the battlefield" not in t and "put that card onto the battlefield" not in t:
        return False
    if "Sacrifice" not in t:
        return False
    # "a Plains or Island card" or "an Island or Swamp card".
    m = re.search(r"Search your library for an? ([A-Z][a-z]+) or ([A-Z][a-z]+) card", t)
    if not m:
        return False
    return m.group(1) in BASIC_TYPES and m.group(2) in BASIC_TYPES


def main():
    if not ORACLE_BULK.exists():
        print(f"MISSING bulk file: {ORACLE_BULK}", file=sys.stderr)
        return 1

    bulk_sha = sha256_file(ORACLE_BULK)
    print(f"oracle bulk: {ORACLE_BULK.name} sha256={bulk_sha}")

    gc_names, gc_pages = fetch_game_changers()
    print(f"game changers live: {len(gc_names)} names across {gc_pages} page(s)")
    gc_out = {
        "checked_date": TODAY,
        "source": "Scryfall is:gamechanger search (live)",
        "total_cards": len(gc_names),
        "names": sorted(gc_names),
    }
    (HERE / "gamechangers_checked_2026-11-07.json").write_text(
        json.dumps(gc_out, indent=2, ensure_ascii=True) + "\n")

    roster = []
    counts = Counter()
    basic_names = Counter()
    banned_found = []
    illegal_found = []
    fetch_candidates = []
    mdfc_names = []
    adventure_names = []
    gc_land_found = []
    no_mana_no_type = []

    with gzip.open(ORACLE_BULK, "rt", encoding="utf-8") as f:
        for line in f:
            card = json.loads(line)
            if card.get("layout") == "token":
                continue
            faces = list(land_faces(card))
            if not faces:
                continue  # Not a land (no land face).
            legality = (card.get("legalities") or {}).get("commander")
            name = card.get("name", "")
            oracle_id = card.get("oracle_id", "")
            layout = card.get("layout", "")
            # TRUE DFC = layout transform/modal_dfc with a land face. Adventure
            # cards have card_faces too but are NOT double-faced cards — track
            # them separately (same held bucket, different flag).
            is_mdfc = layout in ("transform", "modal_dfc")
            is_adventure_land = layout == "adventure"
            # Legendary is CARD-level: any face legendary (matches Scryfall
            # t:legendary search behavior — e.g. Westvale Abbey's back face
            # Ormendahl is legendary, the land face is not).
            all_face_types = ([f.get("type_line", "") for f in (card.get("card_faces") or [])]
                              or [card.get("type_line", "")])
            card_legendary = any("Legendary" in tl for tl in all_face_types)
            type_lines = [tl for _, tl, _ in faces]
            oracle_texts = [t for _, _, t in faces]
            joined_text = "\n".join(oracle_texts)
            joined_types = " | ".join(type_lines)
            basic = any(is_basic(tl) for tl in type_lines)
            snow = any("Snow" in tl for tl in type_lines)
            legendary = card_legendary
            fetch = any(is_true_fetchland(t) for t in oracle_texts)
            mana = has_mana_ability(joined_text)
            basic_type = any(has_basic_type(tl) for tl in type_lines)
            land_face_name = faces[0][0] if faces else name

            if basic and legality == "legal":
                basic_names[name] += 1
            if is_mdfc:
                mdfc_names.append(name)
            if is_adventure_land:
                adventure_names.append(name)
            if fetch:
                fetch_candidates.append(name)
            if name in gc_names:
                gc_land_found.append(name)
            if not mana and not basic_type:
                no_mana_no_type.append(name)

            # --- classification (structural only) ---
            if legality == "banned":
                status, reason = "excluded", "banned in Commander"
                banned_found.append(name)
            elif legality != "legal":
                status, reason = "excluded", f"Commander legality: {legality}"
                illegal_found.append(name)
            elif fetch:
                status, reason = "held", "typed fetchland — pending fetch modeling"
            elif is_mdfc or is_adventure_land:
                status, reason = "held", ("MDFC land face — pending face-policy decision"
                                          if is_mdfc else
                                          "adventure land face — pending face-policy decision")
            elif not mana and not basic_type:
                status, reason = "held", "no mana ability and no basic land type — pending utility review"
            else:
                status, reason = "verified", "structural pass"

            # Baseline splits are Commander-legal only — count them on the
            # legal set, not on all rows seen (which includes 100 excluded).
            if legality == "legal":
                counts["total_commander_legal_lands"] += 1
                counts["basic"] += 1 if basic else 0
                counts["nonbasic"] += 0 if basic else 1
                counts["mdfc_land_face"] += 1 if is_mdfc else 0
                counts["adventure_land_face"] += 1 if is_adventure_land else 0
                counts["fetchland"] += 1 if fetch else 0
                counts["snow"] += 1 if snow else 0
                counts["legendary"] += 1 if legendary else 0
            counts["rows_seen"] += 1
            counts[f"status_{status}"] += 1

            roster.append({
                "oracle_id": oracle_id,
                "name": name,
                "land_face_name": land_face_name,
                "mdfc": is_mdfc,
                "adventure_land": is_adventure_land,
                "basic": basic,
                "snow": snow,
                "legendary": legendary,
                "fetchland": fetch,
                "has_mana_ability": mana,
                "has_basic_type": basic_type,
                "color_identity": card.get("color_identity", []),
                "type_line": joined_types,
                "status": status,
                "reason": reason,
                "cycle": "unclassified",
                "legality": {
                    "banned": legality == "banned",
                    "game_changer": name in gc_names,
                    "source": "Scryfall bulk legalities + is:gamechanger (live)",
                    "freshness": TODAY,
                },
                "price_status": "unknown",
                "colors_produced": "pending_classifier",
                "classifier_version": CLASSIFIER_VERSION,
                "evidence": {"snapshot_hash": bulk_sha, "checked_date": TODAY},
                "reviewer": "unreviewed",
            })

    # Roster is the master record: sort by name for stable diffs.
    roster.sort(key=lambda r: r["name"])
    (HERE / "roster.json").write_text(json.dumps(roster, indent=2, ensure_ascii=True) + "\n")

    manifest = {
        "checked_date": TODAY,
        "bulk_files": [{
            "file": ORACLE_BULK.name,
            "type": "oracle_cards",
            "updated_at": "2026-11-06T22:02:05.872+00:00",
            "compressed_size": 25322776,
            "sha256": bulk_sha,
            "download_uri": "https://data.scryfall.io/oracle-cards/oracle-cards-20261106220205.jsonl.gz",
        }],
        "game_changers": {"checked_date": TODAY, "total_cards": len(gc_names), "pages": gc_pages},
        "classifier_version": CLASSIFIER_VERSION,
    }
    (HERE / "bulk_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n")

    # --- verification vs the Nov 5 baseline ---
    got = {
        "total": counts["total_commander_legal_lands"],
        "basic": counts["basic"],
        "nonbasic": counts["nonbasic"],
        "mdfc_land_face": counts["mdfc_land_face"],
        "adventure_land_face": counts["adventure_land_face"],
        "fetchland": counts["fetchland"],
        "snow": counts["snow"],
        "legendary": counts["legendary"],
    }
    lines = []
    lines.append(f"# ManaBase Search — Phase 1 inventory report ({TODAY})")
    lines.append("")
    lines.append("## Counts vs Nov 5 baseline (live Scryfall, 2026-11-05)")
    lines.append("")
    lines.append("| Split | Baseline (Nov 5) | This run (Nov 7 bulk) | Diff |")
    lines.append("|---|---|---|---|")
    for key in ["total", "basic", "nonbasic", "mdfc_land_face", "fetchland", "snow", "legendary"]:
        diff = got[key] - BASELINE[key]
        lines.append(f"| {key} | {BASELINE[key]} | {got[key]} | {diff:+d} |")
    lines.append(f"| adventure_land_face | n/a (not split out Nov 5) | {got['adventure_land_face']} | — |")
    lines.append("")
    lines.append("## Baseline corrections found by this run (bulk re-verification)")
    lines.append("")
    lines.append("- **MDFC land face: Nov 5 baseline 108 was WRONG; the true count is 96.**")
    lines.append("  The Nov 5 count came from the Scryfall search `t:land is:dfc`, which")
    lines.append("  returns 12 single-faced lands as false positives (verified live Nov 7:")
    lines.append("  `!\"Blood Crypt\" is:dfc` returns 1, yet the bulk shows Blood Crypt is")
    lines.append("  layout `normal` with no card_faces). The 12 false positives are the 5")
    lines.append("  basics, the 5 shock lands, Command Tower and Unholy Grotto. The bulk")
    lines.append("  (layout + card_faces) is authoritative: 96 true DFCs with a land face.")
    lines.append("  `is:dfc` is therefore NOT a reliable MDFC test in search — use bulk layout.")
    lines.append("- **Adventure lands are a separate class (6 total, 5 legal):** Ishgard, the")
    lines.append("  Holy See; Jidoor, Aristocratic Capital; Lindblum, Industrial Regency;")
    lines.append("  Midgar, City of Mako; Zanarkand, Ancient Metropolis (all legal) + Value Town")
    lines.append("  (illegal). They have card_faces but layout `adventure`, not a DFC layout —")
    lines.append("  they were inside the old 102 'mdfc' count and are now split out. The")
    lines.append("  face-policy decision covers them too (land face + spell face).")
    lines.append("- **Fetchland pattern fixed (twice):** the first pass matched 12 (the 4 Mirage")
    lines.append("  slow fetches) and missed Polluted Delta + Scalding Tarn ('an Island or …').")
    lines.append("  The second pass matched 15: the 5 Mirage slow fetches (Bad River, Flood Plain,")
    lines.append("  Grasslands, Mountain Valley, Rocky Tar Pit) carry 'This land enters tapped' as")
    lines.append("  a separate first line — the fetch land itself enters tapped, which is what")
    lines.append("  makes them slow fetches. Corrected pattern (a/an + untapped entry, excluding")
    lines.append("  both 'onto the battlefield tapped' and 'enters tapped') returns exactly the 10.")
    lines.append("- **Legendary is card-level, not land-face-level:** the 7 missing legendary rows")
    lines.append("  are DFCs whose LAND face is not legendary but whose other face is (Aclazotz,")
    lines.append("  Balamb Garden, the four Ojer gods, Westvale Abbey). Scryfall's t:legendary")
    lines.append("  search matches on any face, so the roster flag does too.")
    lines.append("- **Basic 13 → 12:** the 13th basic is Barry's Land (Unglued), which is")
    lines.append("  Commander-illegal and excluded. Legal basics are 12 (5 + 5 snow + 2 Wastes).")
    lines.append("- **Illegal set (97 + 3 banned = 100 excluded) is mostly Un-set/acorn cards")
    lines.append("  plus unreleased Star Trek cards (e.g. Bajor, Cardassia Prime) whose")
    lines.append("  Commander legality flips to legal at the Nov 13 release. Re-run the roster")
    lines.append("  after Nov 13 — the excluded set will shrink and the legal total will grow.")
    lines.append("")
    lines.append("## Status breakdown (roster.json)")
    lines.append("")
    for key in sorted(k for k in counts if k.startswith("status_")):
        lines.append(f"- {key.replace('status_', '')}: {counts[key]}")
    lines.append(f"- rows seen (any land face): {counts['rows_seen']}")
    lines.append("")
    lines.append("## 12-basic decomposition (Stage 2 gate)")
    lines.append("")
    for bname, n in sorted(basic_names.items()):
        lines.append(f"- {bname}: {n}")
    lines.append("")
    lines.append("Note: a 13th basic exists in the bulk — Barry's Land (Unglued) — but it is")
    lines.append("Commander-illegal (silver-bordered) and excluded, so the legal set is 12:")
    lines.append("5 regular + 5 Snow-Covered + Wastes + Snow-Covered Wastes.")
    lines.append("")
    lines.append("## Banned (excluded)")
    lines.append("")
    for bname in sorted(banned_found):
        lines.append(f"- {bname} (expected: {'yes' if bname in BANNED_EXPECTED else 'NO — UNEXPECTED'})")
    lines.append(f"- expected but NOT found: {sorted(BANNED_EXPECTED - set(banned_found)) or 'none'}")
    lines.append("")
    lines.append("## Commander-illegal lands (excluded, non-banned)")
    lines.append("")
    lines.append(f"- count: {len(illegal_found)}")
    for bname in sorted(illegal_found)[:20]:
        lines.append(f"- {bname}")
    if len(illegal_found) > 20:
        lines.append(f"- …and {len(illegal_found) - 20} more (see roster.json)")
    lines.append("")
    lines.append("## Game Changer lands found in the universe")
    lines.append("")
    for bname in sorted(gc_land_found):
        lines.append(f"- {bname} (expected: {'yes' if bname in GC_LANDS_EXPECTED else 'NO — UNEXPECTED'})")
    lines.append(f"- expected but NOT found: {sorted(GC_LANDS_EXPECTED - set(gc_land_found)) or 'none'}")
    lines.append(f"- live GC list total: {len(gc_names)} names")
    lines.append("")
    lines.append("## True fetchlands found (pattern: typed search + put onto battlefield + sacrifice)")
    lines.append("")
    for bname in sorted(fetch_candidates):
        lines.append(f"- {bname}")
    lines.append("")
    lines.append("## No-mana-ability + no-basic-type (held for utility review)")
    lines.append("")
    lines.append(f"- count: {len(no_mana_no_type)}")
    for bname in sorted(no_mana_no_type)[:30]:
        lines.append(f"- {bname}")
    if len(no_mana_no_type) > 30:
        lines.append(f"- …and {len(no_mana_no_type) - 30} more (see roster.json)")
    lines.append("")
    lines.append("## Method")
    lines.append("")
    lines.append("- Source: pinned Scryfall oracle_cards bulk")
    lines.append(f"  (oracle-cards-20261106220205.jsonl.gz, sha256 {bulk_sha}).")
    lines.append("- One row per oracle_id; printings are child records, never rows.")
    lines.append("- Land = any card face whose type line contains 'Land'.")
    lines.append("- Commander-legal = legalities.commander == 'legal'; banned/illegal excluded.")
    lines.append("- Fetchland pattern: 'Search your library for a/an <Type> or <Type> card' +")
    lines.append("  'put it/that card onto the battlefield' (UNTAPPED — 'onto the battlefield tapped'")
    lines.append("  excludes the Mirage slow fetches) + 'Sacrifice' (excludes basic-only fetchers).")
    lines.append("- Price status is 'unknown' for every row in Phase 1; Phase 2 pricing")
    lines.append("  moves price-unknown rows to held. colors_produced is 'pending_classifier'.")
    lines.append("- Basics are classified verified with basic=true; whether the buy-whole-set")
    lines.append("  flow includes them is an open CEO question (see build plan).")
    (HERE / "inventory_report.md").write_text("\n".join(lines) + "\n")

    print(json.dumps({"counts": dict(counts), "roster_rows": len(roster)}, indent=2))
    print(f"wrote roster.json ({len(roster)} rows), inventory_report.md, bulk_manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
