#!/usr/bin/env python3
"""ManaBase Search — land classifiers (Phase 2).

Pure functions over Scryfall oracle text + type line. No I/O, no network.
Used by build_search_data.py; tested by test_land_classify.py against real
oracle text from the pinned bulk.

Rules (auditable, recorded here):
- Colors produced: parsed from mana-ability "Add ..." fragments + intrinsic
  abilities from basic land types (CR 305.6). Unknown production = zero
  credit (empty list). "One mana of any color" = all five. Spend-only
  restrictions ("Spend this mana only to...") do NOT make production
  conditional; "Activate only if" / "only if you control" / "unless you
  control" DO. Colored mana only in colors_produced; colorless is a
  separate flag (mirrors the optimizer's producesColorless), so the
  colors-produced subset rule in search is not broken by pain lands.
- Entry: shock ("you may pay 2 life") and snarl ("you may reveal ... If you
  don't") are conditional; "unless ..." is conditional; a bare
  "enters tapped" is tapped; anything else is untapped.
- Cycle: text-pattern rules, most specific first; name lists only for the
  small named cycles (rainbow, utility, urza, guildgate). Anything else is
  "unclassified" (the plan allows that until classified).
"""

import re

WUBRG = ["W", "U", "B", "R", "G"]
BASIC_TYPE_TO_COLOR = {
    "Plains": "W",
    "Island": "U",
    "Swamp": "B",
    "Mountain": "R",
    "Forest": "G",
}

_COND_MARKERS = ("activate only if", "only if you control", "unless you control")

_RAINBOW_NAMES = {"City of Brass", "Mana Confluence"}
_UTILITY_NAMES = {"Command Tower", "Exotic Orchard"}
_URZA_NAMES = {"Urza's Mine", "Urza's Power Plant", "Urza's Tower"}
_GUILDGATE_NAMES = {
    "Azorius Guildgate", "Dimir Guildgate", "Rakdos Guildgate",
    "Gruul Guildgate", "Selesnya Guildgate", "Orzhov Guildgate",
    "Izzet Guildgate", "Golgari Guildgate", "Boros Guildgate",
    "Simic Guildgate",
}


def _clean_dependency(raw):
    """'a Plains or an Island' -> 'Plains or Island'; 'five or more lands' kept."""
    s = raw.strip().rstrip(".")
    s = re.sub(r"\b(a|an)\b", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _extract_dependency(line):
    """Pull the condition clause out of a conditional mana-ability line."""
    m = re.search(
        r"(?:activate only if you control|only if you control|unless you control)\s+(.+)",
        line,
        re.IGNORECASE,
    )
    if not m:
        return line.strip()
    return _clean_dependency(m.group(1))


def parse_colors(oracle_text, type_line):
    """Return colors produced + colorless flags + notes.

    {
      "colors_produced": ["W", "U"],          # unconditional, WUBRG order
      "conditional_colors": [{"color": "U", "dependency": "Plains or Island"}],
      "produces_colorless": False,             # unconditional {C}
      "conditional_colorless": False,          # {C} behind a condition
      "notes": ["commander color identity"],   # production caveats, if any
    }
    """
    colors = set()
    conditional = {}  # color -> dependency
    colorless = False
    cond_colorless = False
    notes = []

    text = oracle_text or ""
    for line in text.split("\n"):
        low = line.lower()
        is_conditional = any(m in low for m in _COND_MARKERS)
        dependency = _extract_dependency(line) if is_conditional else None
        for frag in re.finditer(r"Add ([^.;]+)", line):
            fl = frag.group(1).lower()
            if (
                "one mana of any color" in fl
                or "mana of any color" in fl
                # Old wording, still current on Reflecting Pool et al:
                # "any type" = "any color" for mana.
                or "one mana of any type" in fl
                or "mana of any type" in fl
                or "in any combination of colors" in fl
            ):
                for c in WUBRG:
                    if is_conditional:
                        conditional.setdefault(c, dependency)
                    else:
                        colors.add(c)
                if "commander's color identity" in fl:
                    notes.append("commander color identity")
                if "opponent controls" in fl:
                    notes.append("opponent lands")
                continue
            if "one mana of the chosen color" in fl or "mana of the chosen color" in fl:
                for c in WUBRG:
                    if is_conditional:
                        conditional.setdefault(c, dependency)
                    else:
                        colors.add(c)
                notes.append("chosen color")
                continue
            if "of that color" in fl and "choose a color" in text.lower():
                # Nykthos-style: "Choose a color. Add an amount of mana of
                # that color ..." — the player picks any color.
                for c in WUBRG:
                    if is_conditional:
                        conditional.setdefault(c, dependency)
                    else:
                        colors.add(c)
                notes.append("chosen color")
                continue
            for sym in re.findall(r"\{([WUBRGC])\}", frag.group(1)):
                if sym == "C":
                    if is_conditional:
                        cond_colorless = True
                    else:
                        colorless = True
                elif is_conditional:
                    conditional.setdefault(sym, dependency)
                else:
                    colors.add(sym)

    # "Choose a basic land type" on entry (Thran Portal, Multiversal
    # Passage): the land IS the chosen type, so it taps for that color —
    # any single color, player's choice.
    if re.search(r"choose a basic land type", text, re.IGNORECASE):
        for c in WUBRG:
            colors.add(c)
        notes.append("chosen basic land type")

    # Intrinsic abilities from basic land types (CR 305.6): a land with a
    # basic land type taps for that color even when the oracle text only
    # shows the reminder. This is what makes typed duals/triomes produce.
    for btype, color in BASIC_TYPE_TO_COLOR.items():
        if re.search(r"\b" + btype + r"\b", type_line or ""):
            colors.add(color)

    # Unconditional production wins over a conditional route to the same color.
    conditional_list = [
        {"color": c, "dependency": d}
        for c, d in sorted(conditional.items())
        if c not in colors
    ]
    return {
        "colors_produced": [c for c in WUBRG if c in colors],
        "conditional_colors": conditional_list,
        "produces_colorless": colorless,
        "conditional_colorless": cond_colorless,
        "notes": sorted(set(notes)),
    }


def classify_entry(oracle_text):
    """{"status": "untapped"|"tapped"|"conditional", "condition": str|None}"""
    text = oracle_text or ""
    if re.search(r"you may pay 2 life", text, re.IGNORECASE):
        return {
            "status": "conditional",
            "condition": "you may pay 2 life, otherwise enters tapped",
        }
    if (
        re.search(r"you may reveal an? .+ card from your hand", text, re.IGNORECASE)
        and re.search(r"if you don't", text, re.IGNORECASE)
    ):
        return {
            "status": "conditional",
            "condition": "reveal a matching land card from your hand, otherwise enters tapped",
        }
    m = re.search(
        r"enters (?:the battlefield )?tapped unless ([^.]+)", text, re.IGNORECASE
    )
    if m:
        return {"status": "conditional", "condition": "unless " + m.group(1).strip()}
    if re.search(r"enters (?:the battlefield )?tapped\b", text, re.IGNORECASE):
        return {"status": "tapped", "condition": None}
    return {"status": "untapped", "condition": None}


def _basic_types(type_line):
    return [
        t for t in BASIC_TYPE_TO_COLOR if re.search(r"\b" + t + r"\b", type_line or "")
    ]


def classify_cycle(oracle_text, type_line, name, is_basic=False,
                   colors_produced=None, entry_status=None):
    """Cycle id (gallery ids where they exist) or 'unclassified'.

    colors_produced / entry_status (from parse_colors / classify_entry)
    feed the 'triple' rule only — a 3-color land that enters tapped and
    matches no earlier rule is a Shards/Khans tri-land.
    """
    text = oracle_text or ""
    low = text.lower()
    types = _basic_types(type_line)

    if is_basic:
        return "basic"
    if re.search(r"you may pay 2 life", text, re.IGNORECASE):
        return "shock"
    if "{T}: Add {C}." in text and "deals 1 damage to you" in text:
        return "pain"
    if "Cycling {3}" in text and len(types) == 3:
        return "triome"
    if "Cycling {2}" in text and len(types) == 2:
        return "bicycle"
    if re.search(
        r"Add \{[WUBRG]\}\{[WUBRG]\}, \{[WUBRG]\}\{[WUBRG]\}, or \{[WUBRG]\}\{[WUBRG]\}",
        text,
    ):
        return "filter"
    if re.search(
        r"return an? (untapped )?\w+ you control to its owner'?s hand",
        text,
        re.IGNORECASE,
    ):
        return "bounce"
    if "two or more opponents" in low:
        return "bond"
    if "two or fewer other lands" in low:
        return "fast"
    if "two or more other lands" in low:
        return "slow"
    if "two or more basic lands" in low:
        return "tango"
    if re.search(
        r"unless you control an? (Plains|Island|Swamp|Mountain|Forest)",
        text,
        re.IGNORECASE,
    ):
        return "check"
    if re.search(r"when [^.]*?enters[^.]*?, surveil 1", text, re.IGNORECASE):
        return "surveil"
    if "pay 1 life: add" in low and "sacrifice" in low and "draw a card" in low:
        return "horizon"
    if re.search(r"when [^.]*?enters[^.]*?, scry 1", text, re.IGNORECASE):
        return "temple"
    if re.search(r"when [^.]*?enters[^.]*?, you gain 1 life", text, re.IGNORECASE):
        return "gainland"
    if "two charge counters" in low:
        return "vivid"
    if re.search(r"as [^.]*?enters[^.]*?, choose a color", text, re.IGNORECASE):
        return "thriving"
    if "storage counter" in low:
        return "storage"
    if re.search(r"you may reveal an? .+ card from your hand", text, re.IGNORECASE):
        return "snarl"
    if "snow" in (type_line or "").lower() and len(types) == 2:
        return "snow_dual"
    if name in _RAINBOW_NAMES:
        return "rainbow"
    if name in _UTILITY_NAMES:
        return "utility"
    if name in _URZA_NAMES:
        return "urza"
    if name in _GUILDGATE_NAMES:
        return "guildgate"
    if (
        colors_produced is not None
        and len(colors_produced) == 3
        and entry_status == "tapped"
    ):
        return "triple"
    if name.endswith("Panorama"):
        return "panorama"
    return "unclassified"
