#!/usr/bin/env python3
"""Tests for land_classify.py — run against REAL oracle text from the pinned
bulk (~/workspace/manabase-search/bulk/oracle-cards-20261106220205.jsonl.gz).

Usage: python3 test_land_classify.py
Exit 0 = all pass. Any failure prints the case and exits 1.
"""
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from land_classify import parse_colors, classify_entry, classify_cycle

BULK = Path("/home/hatch/workspace/manabase-search/bulk/oracle-cards-20261106220205.jsonl.gz")

# name -> (colors, conditional_colors, colorless, cond_colorless, entry, cycle)
CASES = {
    # basics
    "Plains": (["W"], [], False, False, "untapped", "basic"),
    "Forest": (["G"], [], False, False, "untapped", "basic"),
    "Wastes": ([], [], True, False, "untapped", "basic"),
    "Snow-Covered Island": (["U"], [], False, False, "untapped", "basic"),
    # shocks / pains / checks / tangos
    "Hallowed Fountain": (["W", "U"], [], False, False, "conditional", "shock"),
    "Watery Grave": (["U", "B"], [], False, False, "conditional", "shock"),
    "Blood Crypt": (["B", "R"], [], False, False, "conditional", "shock"),
    "Adarkar Wastes": (["W", "U"], [], True, False, "untapped", "pain"),
    "Caves of Koilos": (["W", "B"], [], True, False, "untapped", "pain"),
    "Glacial Fortress": (["W", "U"], [], False, False, "conditional", "check"),
    "Prairie Stream": (["W", "U"], [], False, False, "conditional", "tango"),
    "Sunken Hollow": (["U", "B"], [], False, False, "conditional", "tango"),
    # verges (conditional second color)
    "Floodfarm Verge": (
        ["W"],
        [{"color": "U", "dependency": "Plains or Island"}],
        False, False, "untapped", "unclassified",
    ),
    # bond / fast / slow / filter / bounce
    "Sea of Clouds": (["W", "U"], [], False, False, "conditional", "bond"),
    "Seachrome Coast": (["W", "U"], [], False, False, "conditional", "fast"),
    "Deserted Beach": (["W", "U"], [], False, False, "conditional", "slow"),
    "Mystic Gate": (["W", "U"], [], True, False, "untapped", "filter"),
    "Azorius Chancery": (["W", "U"], [], False, False, "tapped", "bounce"),
    "Karoo": (["W"], [], True, False, "tapped", "bounce"),
    # triome / bicycle / surveil / horizon
    "Raugrin Triome": (["W", "U", "R"], [], False, False, "tapped", "triome"),
    "Irrigated Farmland": (["W", "U"], [], False, False, "tapped", "bicycle"),
    "Undercity Sewers": (["U", "B"], [], False, False, "tapped", "surveil"),
    "Horizon Canopy": (["W", "G"], [], False, False, "untapped", "horizon"),
    # rainbow / utility
    "City of Brass": (["W", "U", "B", "R", "G"], [], False, False, "untapped", "rainbow"),
    "Mana Confluence": (["W", "U", "B", "R", "G"], [], False, False, "untapped", "rainbow"),
    "Command Tower": (["W", "U", "B", "R", "G"], [], False, False, "untapped", "utility"),
    "Exotic Orchard": (["W", "U", "B", "R", "G"], [], False, False, "untapped", "utility"),
    "Cavern of Souls": (["W", "U", "B", "R", "G"], [], True, False, "untapped", "unclassified"),
    # temples / gainlands / vivid / thriving / snarl / snow dual / guildgate
    "Temple of Enlightenment": (["W", "U"], [], False, False, "tapped", "temple"),
    "Tranquil Cove": (["W", "U"], [], False, False, "tapped", "gainland"),
    "Vivid Crag": (["W", "U", "B", "R", "G"], [], False, False, "tapped", "vivid"),
    "Thriving Bluff": (["W", "U", "B", "R", "G"], [], False, False, "tapped", "thriving"),
    "Frostboil Snarl": (["U", "R"], [], False, False, "conditional", "snarl"),
    "Alpine Meadow": (["W", "R"], [], False, False, "tapped", "snow_dual"),
    "Azorius Guildgate": (["W", "U"], [], False, False, "tapped", "guildgate"),
    # colorless-only / no colored production
    "Ancient Tomb": ([], [], True, False, "untapped", "unclassified"),
    "Temple of the False God": ([], [], False, True, "untapped", "unclassified"),
    "Maze's End": ([], [], True, False, "tapped", "unclassified"),
    # utility (no mana ability): zero credit
    "Dark Depths": ([], [], False, False, "untapped", "unclassified"),
    "Bazaar of Baghdad": ([], [], False, False, "untapped", "unclassified"),
    "Glacial Chasm": ([], [], False, False, "untapped", "unclassified"),
    "The Tabernacle at Pendrell Vale": ([], [], False, False, "untapped", "unclassified"),
    # urza
    "Urza's Mine": ([], [], True, False, "untapped", "urza"),
    # tightened rules: entry-trigger only (these must NOT match the old loose checks)
    "Path of Ancestry": (["W", "U", "B", "R", "G"], [], False, False, "tapped", "unclassified"),
    "Inventors' Fair": ([], [], True, False, "untapped", "unclassified"),
    "High Market": ([], [], True, False, "untapped", "unclassified"),
    "Prismari Campus": (["U", "R"], [], False, False, "tapped", "unclassified"),
    "Sinister Hideout": (["U", "B"], [], False, False, "tapped", "unclassified"),
    "Tocasia's Dig Site": ([], [], True, False, "untapped", "unclassified"),
    "Nykthos, Shrine to Nyx": (["W", "U", "B", "R", "G"], [], True, False, "untapped", "unclassified"),
    # entry-trigger survivors of the tightening
    "Glimmerpost": ([], [], True, False, "untapped", "gainland"),
    "Meticulous Archive": (["W", "U"], [], False, False, "tapped", "surveil"),
    # "any type" old wording = any color
    "Reflecting Pool": (["W", "U", "B", "R", "G"], [], False, False, "untapped", "unclassified"),
    "Horizon of Progress": (["W", "U", "B", "R", "G"], [], False, False, "untapped", "horizon"),
    "Cactus Preserve": (["W", "U", "B", "R", "G"], [], False, False, "tapped", "unclassified"),
    "Plaza of Harmony": (["W", "U", "B", "R", "G"], [], True, False, "untapped", "unclassified"),
    # chosen basic land type = any single color
    "Multiversal Passage": (["W", "U", "B", "R", "G"], [], False, False, "conditional", "shock"),
    "Thran Portal": (["W", "U", "B", "R", "G"], [], False, False, "conditional", "fast"),
    # triple lands (3 colors + enters tapped, no earlier rule)
    "Seaside Citadel": (["W", "U", "G"], [], False, False, "tapped", "triple"),
    "Arcane Sanctum": (["W", "U", "B"], [], False, False, "tapped", "triple"),
    # more true positives from the full-run audit
    "Murmuring Bosk": (["W", "B", "G"], [], False, False, "conditional", "snarl"),
    "Grand Coliseum": (["W", "U", "B", "R", "G"], [], True, False, "tapped", "pain"),
    "Caldera Lake": (["U", "R"], [], True, False, "tapped", "pain"),
    "Arid Archway": ([], [], True, False, "tapped", "bounce"),
    "Guildless Commons": ([], [], True, False, "tapped", "bounce"),
}

BASIC_NAMES = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
               "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
               "Snow-Covered Mountain", "Snow-Covered Forest", "Snow-Covered Wastes"}


def main():
    want = set(CASES)
    found = {}
    with gzip.open(BULK, "rt") as fh:
        for line in fh:
            c = json.loads(line)
            if c["name"] in want:
                found[c["name"]] = c
                if len(found) == len(want):
                    break
    missing = want - set(found)
    if missing:
        print(f"FAIL: missing from bulk: {sorted(missing)}")
        return 1

    failures = 0
    for name, (exp_colors, exp_cond, exp_cl, exp_ccl, exp_entry, exp_cycle) in sorted(CASES.items()):
        c = found[name]
        got_colors = parse_colors(c.get("oracle_text"), c.get("type_line"))
        got_entry = classify_entry(c.get("oracle_text"))
        got_cycle = classify_cycle(
            c.get("oracle_text"), c.get("type_line"), name,
            is_basic=name in BASIC_NAMES,
            colors_produced=got_colors["colors_produced"],
            entry_status=got_entry["status"],
        )
        problems = []
        if got_colors["colors_produced"] != exp_colors:
            problems.append(f"colors {got_colors['colors_produced']} != {exp_colors}")
        if got_colors["conditional_colors"] != exp_cond:
            problems.append(f"cond {got_colors['conditional_colors']} != {exp_cond}")
        if got_colors["produces_colorless"] != exp_cl:
            problems.append(f"colorless {got_colors['produces_colorless']} != {exp_cl}")
        if got_colors["conditional_colorless"] != exp_ccl:
            problems.append(f"cond_colorless {got_colors['conditional_colorless']} != {exp_ccl}")
        if got_entry["status"] != exp_entry:
            problems.append(f"entry {got_entry['status']} != {exp_entry}")
        if got_cycle != exp_cycle:
            problems.append(f"cycle {got_cycle} != {exp_cycle}")
        if problems:
            failures += 1
            print(f"FAIL {name}: " + "; ".join(problems))
    print(f"{len(CASES) - failures}/{len(CASES)} classifier cases pass")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
