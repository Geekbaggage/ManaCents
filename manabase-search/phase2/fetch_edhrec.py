#!/usr/bin/env python3
"""ManaBase Search — EDHREC most-used fetcher (Phase 2, ranking producer).

Sources (verified obtainable 2026-11-07, see the build plan §7):
- https://json.edhrec.com/pages/top/lands.json — top 100 lands, each with
  num_decks + potential_decks. (No `inclusion` field exists anywhere;
  inclusion = num_decks / potential_decks.)
- https://json.edhrec.com/pages/cards/<slug>.json — per-card JSON; counts at
  container.json_dict.card.num_decks + potential_decks. Only that sub-object
  is stored (the full JSON is ~151 KB/card of articles/panels/similar cards).

GATING: the FULL run (~1,112 per-card fetches) waits on Q3 — Charlie's
EDHREC terms/licensing check. This script's __main__ runs the SAMPLE ONLY
(top/lands.json + 3 cards) to validate the fetch/parse path. The full-run
function fetch_all() exists for when Q3 clears; do NOT call it before then.

Discipline: ~300 ms delay + jitter between requests, descriptive
User-Agent, honor 429s with backoff, abort loudly on repeated failures
rather than writing partial counts.

Usage: python3 fetch_edhrec.py   (sample only; writes edhrec_sample.json)
"""
import json
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path("/home/hatch/workspace/manabase-search")
SAMPLE_OUT = BASE / "phase2/edhrec_sample.json"

UA = "ManaCents/1.0 (contact: geekbaggage@gmail.com)"
HEADERS = {"User-Agent": UA, "Accept": "application/json"}
TOP_LANDS_URL = "https://json.edhrec.com/pages/top/lands.json"
CARD_URL = "https://json.edhrec.com/pages/cards/{slug}.json"

SAMPLE_SLUGS = ["command-tower", "hallowed-fountain", "forest"]


def slugify(name):
    """Best-effort EDHREC slug: lowercase, strip punctuation, spaces -> hyphens.

    Known-good: Command Tower -> command-tower, Hallowed Fountain ->
    hallowed-fountain. Edge cases (A.I.M. Labs, split faces) may 404 in the
    full run; those are recorded as missing, never guessed.
    """
    s = name.lower()
    s = re.sub(r"['’.]+", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _get_json(url, attempts=4):
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as res:
                if res.status == 429:
                    wait = min(2 ** attempt, 10)
                    print(f"  429 for {url}, backing off {wait}s (attempt {attempt})")
                    time.sleep(wait)
                    continue
                if res.status != 200:
                    raise RuntimeError(f"HTTP {res.status} for {url}")
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < attempts:
                wait = min(2 ** attempt, 10)
                print(f"  429 for {url}, backing off {wait}s (attempt {attempt})")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"failed after {attempts} attempts: {url}")


def fetch_top_lands():
    """Top-100 lands list (one request). Returns the raw cardview list.

    Actual path (verified 2026-11-07): container.json_dict.cardlists[0]
    .cardviews — 100 entries. The list is paginated (total_pages 12,
    `more` points at top/lands-toplands-1.json), so the full run can
    cover ~1,200 lands' counts from these pages instead of per-card
    fetches — a full-run design note, not used by the sample.
    """
    data = _get_json(TOP_LANDS_URL)
    cards = data["container"]["json_dict"]["cardlists"][0]["cardviews"]
    out = []
    for c in cards:
        out.append({
            "name": c["name"],
            "slug": c["slug"],
            "num_decks": c["num_decks"],
            "potential_decks": c["potential_decks"],
            "inclusion": c["num_decks"] / c["potential_decks"]
            if c["potential_decks"] else None,
        })
    return out


def fetch_card(slug):
    """One card's most-used counts. Raises on 404 / missing fields."""
    data = _get_json(CARD_URL.format(slug=slug))
    card = data["container"]["json_dict"]["card"]
    num = card["num_decks"]
    pot = card["potential_decks"]
    return {
        "slug": slug,
        "name": card.get("name"),
        "num_decks": num,
        "potential_decks": pot,
        "inclusion": num / pot if pot else None,
    }


def fetch_all(roster_path, out_path, delay_ms=300):
    """Full ranking run — DO NOT CALL until Q3 (EDHREC terms) clears.

    Fetches top/lands.json first (covers the top 100), then per-card JSON
    for every remaining served row in search_data.json. Writes
    most_used.json + a fetch log. Aborts loudly on repeated failures
    rather than writing partial counts.
    """
    raise RuntimeError(
        "fetch_all is gated on Q3 (EDHREC terms/licensing, with Charlie). "
        "Run the sample (python3 fetch_edhrec.py) until Q3 clears."
    )


def sample():
    print("EDHREC sample validation (Q3 still gates the full run)")
    top = fetch_top_lands()
    print(f"top/lands.json: {len(top)} entries; "
          f"#1 {top[0]['name']} {top[0]['num_decks']:,} decks; "
          f"min num_decks {min(c['num_decks'] for c in top):,}")
    cards = {}
    for slug in SAMPLE_SLUGS:
        time.sleep(0.3 + random.uniform(0, 0.2))
        cards[slug] = fetch_card(slug)
        print(f"  {slug}: {cards[slug]['num_decks']:,} / "
              f"{cards[slug]['potential_decks']:,} "
              f"(inclusion {cards[slug]['inclusion']:.4f})")
    SAMPLE_OUT.write_text(json.dumps(
        {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
         "top_lands_count": len(top),
         "top_lands_first5": top[:5],
         "sample_cards": cards},
        indent=1) + "\n")
    print(f"wrote {SAMPLE_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(sample())
