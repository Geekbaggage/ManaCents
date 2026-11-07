#!/usr/bin/env python3
"""Spot-check face_rows.json cheapest quotes against LIVE Scryfall.

Usage: python3 spotcheck_face_rows.py
For each of 5 picked rows (one per Q4 class + one extra modal), fetches all
printings via the Scryfall search API (exact-name, paginated), skips
gold-bordered printings, and compares the live cheapest-any-finish quote
(price + set + collector_number + finish) and whole-card color identity
against face_rows.json. Exit 0 = all 5 match. Exit 1 = any mismatch.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path("/home/hatch/workspace/manabase-search")
FACE_PATH = BASE / "phase2/face_rows.json"
UA = "ManaCents/1.0 (contact: geekbaggage@gmail.com)"

PICKS = [
    "Bala Ged Recovery // Bala Ged Sanctuary",          # modal
    "Hagra Mauling // Hagra Broodpit",                  # modal (extra)
    "Westvale Abbey // Ormendahl, Profane Prince",      # transform_front
    "Aclazotz, Deepest Betrayal // Temple of the Dead", # transform_back
    "Ishgard, the Holy See // Faith & Grief",           # adventure
]

PRICE_FIELDS = (("usd", "nonfoil"), ("usd_foil", "foil"), ("usd_etched", "etched"))


def live_cheapest(name):
    """(cheapest dict, color_identity) from live Scryfall, or (None, None)."""
    q = f'!"{name}"'
    # unique=prints is REQUIRED: Scryfall's search defaults to
    # unique=cards (one representative printing per Oracle card), which
    # would silently miss cheaper printings.
    url = ("https://api.scryfall.com/cards/search?q="
           + urllib.parse.quote(q) + "&unique=prints")
    best = None
    ci = None
    pages = 0
    while url:
        req = urllib.request.Request(
            url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
        pages += 1
        for c in data.get("data", []):
            if c.get("name") != name:
                continue
            if ci is None:
                ci = c.get("color_identity")
            if c.get("border_color") == "gold":
                continue
            prices = c.get("prices") or {}
            for field, finish in PRICE_FIELDS:
                v = prices.get(field)
                if v is None:
                    continue
                n = float(v)
                if best is None or n < best["price"]:
                    best = {
                        "price": n,
                        "finish": finish,
                        "set": (c.get("set") or "").upper(),
                        "collector_number": c.get("collector_number"),
                        "printing": f"{(c.get('set') or '').upper()} "
                                    f"#{c.get('collector_number')}",
                    }
        url = data.get("next_page")
        if url:
            time.sleep(0.1)
    return best, ci, pages


def main():
    data = json.loads(FACE_PATH.read_text())
    by_name = {r["name"]: r for r in data["rows"]}
    fails = 0
    for name in PICKS:
        row = by_name[name]
        live, ci, pages = live_cheapest(name)
        filed = row["cheapest"]
        ok_price = (live is not None and live["price"] == filed["price"]
                    and live["set"] == filed["set"]
                    and live["collector_number"] == filed["collector_number"]
                    and live["finish"] == filed["finish"])
        ok_ci = ci == row["color_identity"]
        status = "MATCH" if (ok_price and ok_ci) else "MISMATCH"
        if not (ok_price and ok_ci):
            fails += 1
        print(f"{status} {name} [{row['face_class']}, {pages} page(s)]")
        print(f"  filed: ${filed['price']} {filed['printing']} {filed['finish']} "
              f"| CI {row['color_identity']} | drop {row['land_drop']['code']}")
        if live:
            print(f"  live:  ${live['price']} {live['printing']} {live['finish']} "
                  f"| CI {ci}")
        else:
            print("  live:  NO PRINTINGS FOUND")
        if not ok_price:
            print("  ^ PRICE/PRINTING MISMATCH")
        if not ok_ci:
            print("  ^ COLOR IDENTITY MISMATCH")
    print(f"\nspot-check: {len(PICKS) - fails}/{len(PICKS)} match")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
