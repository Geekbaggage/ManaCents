#!/usr/bin/env python3
"""ManaBase Search — $5 badge divergence check (gate 2 evidence).

Compares, for every one of Charlie's 284 ranked entries, the price the user
sees (serving row `cheapest.price`) against the gate quote that qualified it
(Charlie's `released_quote_usd` in the source sort file). Zero divergences
allowed: any divergence blocks a deploy until explained.

Why compare against the SOURCE file, not the serving row's embedded copy?
The generator copies Charlie's quote into each serving row's `budget_rankings`.
Comparing the serving file against its own embedded copy would be circular.
This script compares the serving file against the independent source file,
then separately verifies the embedded copy matches the source (generator
drift check).

Inputs (defaults are repo-relative; both files are committed):
  --serving  web/functions/api/_manabase_search.json
  --charlie  manabase-search/phase2/charlie-budget-land-sort-2026-11-07.json

Exit 0 = 0 divergences, 284 ranked entries checked, all resolvable.
Exit 1 = any divergence, any unresolvable ranked entry, or a count mismatch.
Prints input SHA-256s + snapshot identifiers so a rerun is attributable.

Usage (from the repo root):
  python3 manabase-search/phase3/check_budget_divergence.py
"""
import argparse
import hashlib
import json
import sys
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SERVING = REPO_ROOT / "web/functions/api/_manabase_search.json"
DEFAULT_CHARLIE = REPO_ROOT / "manabase-search/phase2/charlie-budget-land-sort-2026-11-07.json"

EXPECTED_RANKED = 284
BUDGET_GATE_USD = Decimal("5.00")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--serving", default=str(DEFAULT_SERVING))
    ap.add_argument("--charlie", default=str(DEFAULT_CHARLIE))
    args = ap.parse_args()

    serving_path, charlie_path = Path(args.serving), Path(args.charlie)
    serving = json.loads(serving_path.read_text())
    charlie = json.loads(charlie_path.read_text())

    print(f"serving: {serving_path} sha256={sha256(serving_path)}")
    print(f"charlie: {charlie_path} sha256={sha256(charlie_path)}")
    print(f"serving price_snapshot: {serving['meta'].get('price_snapshot')}")
    print(f"serving rows: {len(serving['rows'])}")
    print(f"charlie cards: {len(charlie['cards'])} types: {len(charlie['types'])}")

    by_oid = {r["oracle_id"]: r for r in serving["rows"]}
    if len(by_oid) != len(serving["rows"]):
        print("FAIL: duplicate oracle_id in serving rows")
        return 1

    ranked = []
    for t in charlie["types"]:
        for m in t["members"]:
            if m.get("default_recommendation"):
                ranked.append((t["id"], m))
    print(f"ranked entries (default_recommendation): {len(ranked)} "
          f"distinct cards: {len({m['oracle_id'] for _, m in ranked})}")

    problems = []
    divergences = []
    over_gate = []
    embedded_mismatch = []
    unresolved = []

    for type_id, m in ranked:
        oid = m["oracle_id"]
        row = by_oid.get(oid)
        if row is None:
            unresolved.append((type_id, m["name"], oid))
            continue
        displayed = Decimal(str(row["cheapest"]["price"]))
        gate = Decimal(m["released_quote_usd"])
        if displayed != gate:
            divergences.append({
                "type": type_id, "name": m["name"], "oracle_id": oid,
                "displayed_usd": str(displayed), "gate_usd": str(gate),
                "diff_usd": str(displayed - gate),
                "displayed_printing": row["cheapest"].get("printing"),
            })
        if displayed > BUDGET_GATE_USD:
            over_gate.append((type_id, m["name"], str(displayed)))
        # Embedded-copy check: the serving row's own budget_rankings entry
        # for this type must carry the same gate quote as the source file.
        embedded = [e for e in row.get("budget_rankings", [])
                    if e.get("type_id") == type_id and e.get("default_recommendation")]
        if not embedded:
            embedded_mismatch.append((type_id, m["name"], "no embedded entry"))
        elif Decimal(embedded[0]["released_quote_usd"]) != gate:
            embedded_mismatch.append((type_id, m["name"],
                                      f"embedded {embedded[0]['released_quote_usd']} != source {gate}"))

    print(f"checked: {len(ranked)}")
    print(f"divergences (displayed != gate quote): {len(divergences)}")
    for d in divergences:
        print("  DIVERGENT:", json.dumps(d))
    print(f"displayed over $5.00: {len(over_gate)}")
    for t in over_gate:
        print("  OVER GATE:", t)
    print(f"unresolved ranked entries (no serving row): {len(unresolved)}")
    for t in unresolved:
        print("  UNRESOLVED:", t)
    print(f"embedded-copy mismatches: {len(embedded_mismatch)}")
    for t in embedded_mismatch:
        print("  EMBEDDED:", t)

    if len(ranked) != EXPECTED_RANKED:
        problems.append(f"ranked count {len(ranked)} != expected {EXPECTED_RANKED}")
    if divergences:
        problems.append(f"{len(divergences)} divergences")
    if over_gate:
        problems.append(f"{len(over_gate)} displayed over $5.00")
    if unresolved:
        problems.append(f"{len(unresolved)} unresolved ranked entries")
    if embedded_mismatch:
        problems.append(f"{len(embedded_mismatch)} embedded-copy mismatches")

    if problems:
        print("RESULT: FAIL — " + "; ".join(problems))
        return 1
    print("RESULT: PASS — 0 divergences out of 284 ranked entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
