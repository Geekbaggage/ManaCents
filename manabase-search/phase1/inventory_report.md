# ManaBase Search — Phase 1 inventory report (2026-11-07)

## Counts vs Nov 5 baseline (live Scryfall, 2026-11-05)

| Split | Baseline (Nov 5) | This run (Nov 7 bulk) | Diff |
|---|---|---|---|
| total | 1212 | 1212 | +0 |
| basic | 12 | 12 | +0 |
| nonbasic | 1200 | 1200 | +0 |
| mdfc_land_face | 108 | 96 | -12 |
| fetchland | 10 | 10 | +0 |
| snow | 27 | 27 | +0 |
| legendary | 85 | 85 | +0 |
| adventure_land_face | n/a (not split out Nov 5) | 5 | — |

## Baseline corrections found by this run (bulk re-verification)

- **MDFC land face: Nov 5 baseline 108 was WRONG; the true count is 96.**
  The Nov 5 count came from the Scryfall search `t:land is:dfc`, which
  returns 12 single-faced lands as false positives (verified live Nov 7:
  `!"Blood Crypt" is:dfc` returns 1, yet the bulk shows Blood Crypt is
  layout `normal` with no card_faces). The 12 false positives are the 5
  basics, the 5 shock lands, Command Tower and Unholy Grotto. The bulk
  (layout + card_faces) is authoritative: 96 true DFCs with a land face.
  `is:dfc` is therefore NOT a reliable MDFC test in search — use bulk layout.
- **Adventure lands are a separate class (6 total, 5 legal):** Ishgard, the
  Holy See; Jidoor, Aristocratic Capital; Lindblum, Industrial Regency;
  Midgar, City of Mako; Zanarkand, Ancient Metropolis (all legal) + Value Town
  (illegal). They have card_faces but layout `adventure`, not a DFC layout —
  they were inside the old 102 'mdfc' count and are now split out. The
  face-policy decision covers them too (land face + spell face).
- **Fetchland pattern fixed (twice):** the first pass matched 12 (the 4 Mirage
  slow fetches) and missed Polluted Delta + Scalding Tarn ('an Island or …').
  The second pass matched 15: the 5 Mirage slow fetches (Bad River, Flood Plain,
  Grasslands, Mountain Valley, Rocky Tar Pit) carry 'This land enters tapped' as
  a separate first line — the fetch land itself enters tapped, which is what
  makes them slow fetches. Corrected pattern (a/an + untapped entry, excluding
  both 'onto the battlefield tapped' and 'enters tapped') returns exactly the 10.
- **Legendary is card-level, not land-face-level:** the 7 missing legendary rows
  are DFCs whose LAND face is not legendary but whose other face is (Aclazotz,
  Balamb Garden, the four Ojer gods, Westvale Abbey). Scryfall's t:legendary
  search matches on any face, so the roster flag does too.
- **Basic 13 → 12:** the 13th basic is Barry's Land (Unglued), which is
  Commander-illegal and excluded. Legal basics are 12 (5 + 5 snow + 2 Wastes).
- **Illegal set (97 + 3 banned = 100 excluded) is mostly Un-set/acorn cards
  plus unreleased Star Trek cards (e.g. Bajor, Cardassia Prime) whose
  Commander legality flips to legal at the Nov 13 release. Re-run the roster
  after Nov 13 — the excluded set will shrink and the legal total will grow.

## Status breakdown (roster.json)

- excluded: 100
- held: 159
- verified: 1053
- rows seen (any land face): 1312

## 12-basic decomposition (Stage 2 gate)

- Forest: 1
- Island: 1
- Mountain: 1
- Plains: 1
- Snow-Covered Forest: 1
- Snow-Covered Island: 1
- Snow-Covered Mountain: 1
- Snow-Covered Plains: 1
- Snow-Covered Swamp: 1
- Snow-Covered Wastes: 1
- Swamp: 1
- Wastes: 1

Note: a 13th basic exists in the bulk — Barry's Land (Unglued) — but it is
Commander-illegal (silver-bordered) and excluded, so the legal set is 12:
5 regular + 5 Snow-Covered + Wastes + Snow-Covered Wastes.

## Banned (excluded)

- Karakas (expected: yes)
- Library of Alexandria (expected: yes)
- Tolarian Academy (expected: yes)
- expected but NOT found: none

## Commander-illegal lands (excluded, non-banned)

- count: 97
- A-Town
- Aggressive Crag
- Andoria
- Artifact Unknown Shores
- Artificial Anomaly
- Artist Alley
- Bajor
- Barry's Land
- Blustering Barnyard
- Captivating Crossroads
- Cardassia Prime
- Chicago Loop
- City of Ass
- Command Mine
- Command Power Plant
- Desert Cenote
- Domesticated Watercourse
- Earth, Sector 001
- Echoing Cavern
- Enchanted Prairie
- …and 77 more (see roster.json)

## Game Changer lands found in the universe

- Ancient Tomb (expected: yes)
- Field of the Dead (expected: yes)
- Gaea's Cradle (expected: yes)
- Glacial Chasm (expected: yes)
- Mishra's Workshop (expected: yes)
- Serra's Sanctum (expected: yes)
- The Tabernacle at Pendrell Vale (expected: yes)
- expected but NOT found: none
- live GC list total: 53 names

## True fetchlands found (pattern: typed search + put onto battlefield + sacrifice)

- Arid Mesa
- Bloodstained Mire
- Flooded Strand
- Marsh Flats
- Misty Rainforest
- Polluted Delta
- Scalding Tarn
- Verdant Catacombs
- Windswept Heath
- Wooded Foothills

## No-mana-ability + no-basic-type (held for utility review)

- count: 62
- Adventurers' Guildhouse
- Arena
- Arid Mesa
- Bad River
- Bazaar of Baghdad
- Bloodstained Mire
- Brokers Hideout
- Cabaretti Courtyard
- Cathedral of Serra
- Dark Depths
- Diamond Valley
- Elven Passage
- Escape Tunnel
- Evolving Wilds
- Eye of Ugin
- Fabled Passage
- Flood Plain
- Flooded Strand
- Gemstone Mine
- Glacial Chasm
- Grasslands
- Halls of Mist
- Hobbit Hole
- Horizon of Progress
- Ice Floe
- Island of Wak-Wak
- Lander Rizzi
- Maestros Theater
- Mana Conference
- Mana Confluence
- …and 32 more (see roster.json)

## Method

- Source: pinned Scryfall oracle_cards bulk
  (oracle-cards-20261106220205.jsonl.gz, sha256 ccbc99fd81dd4fd1a6109b40f61b9d449253204217a93cd4037ba490e452135f).
- One row per oracle_id; printings are child records, never rows.
- Land = any card face whose type line contains 'Land'.
- Commander-legal = legalities.commander == 'legal'; banned/illegal excluded.
- Fetchland pattern: 'Search your library for a/an <Type> or <Type> card' +
  'put it/that card onto the battlefield' (UNTAPPED — 'onto the battlefield tapped'
  excludes the Mirage slow fetches) + 'Sacrifice' (excludes basic-only fetchers).
- Price status is 'unknown' for every row in Phase 1; Phase 2 pricing
  moves price-unknown rows to held. colors_produced is 'pending_classifier'.
- Basics are classified verified with basic=true; whether the buy-whole-set
  flow includes them is an open CEO question (see build plan).
