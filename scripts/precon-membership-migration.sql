-- Precon membership migration (v3, Charlie second review).
-- Durable source independent of commander_synergy/cards rows, which
-- synergy-sync deletes/replaces on printing normalization.
-- DO NOT run DELETE on precon_membership in any sync script.
-- NOT DEPLOYED / NOT APPLIED TO LIVE D1 YET — part of the exact
-- reviewed commit for Charlie third review + CEO approval.
CREATE TABLE IF NOT EXISTS precon_membership (
  commander_slug TEXT NOT NULL,
  card_name TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (commander_slug, card_name)
);
CREATE TABLE IF NOT EXISTS precon_coverage (
  commander_slug TEXT PRIMARY KEY,
  precon_name TEXT,
  source_url TEXT,
  distinct_names INTEGER,
  verified_at TEXT
);
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Ant-Man, Elusive Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Arcane Denial', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Arcane Signet', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Austere Command', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Avenge', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Avengers Quinjet', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Avengers Tower', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Bastion Protector', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Black Widow, Agile Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Captain America, Living Legend', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Captain America, Team Leader', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Captain Mar-Vell, Space-Born', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Captain Marvel, Apex Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Clifftop Retreat', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Coastal Peak', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Command Tower', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Destroy Evil', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Director Nick Fury', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Dismantling Wave', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Door of Destinies', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Exotic Orchard', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Falcon and Redwing', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Fellwar Stone', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Firebird, Blazing Ranger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Folk Hero', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Frostboil Snarl', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Furycalm Snarl', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Gift of Immortality', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Glacial Fortress', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Glittering Massif', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Hawkeye, Avenging Archer', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Herald''s Horn', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Hercules, Olympian Hero', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Hero''s Blade', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Heroic Return', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Heroic Sacrifice', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Hulkbuster Armor', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Iron Man, Armored Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Irrigated Farmland', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Island', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Jarvis, Earth''s Mightiest Butler', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Jocasta, Automaton Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Kindred Discovery', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Love on the Battlefield', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Make Your Move', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Metallic Mimic', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Methods of the Mighty', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Mountain', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Mystic Monastery', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Path of Ancestry', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Patriot, Shield Wielder', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Photon, Mighty Marvel', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Plains', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Plaza of Heroes', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Port Town', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Prairie Stream', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Professor Hulk', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Quicksilver, Speedster', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Radiant Summit', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Raise the Palisade', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Reconnaissance Mission', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Relic of Legends', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Rescue, Pepper Potts', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Rip Apart', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Scarlet Witch, Chaotic Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Scavenger Grounds', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Scorched Geyser', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Secluded Courtyard', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Shang-Chi and the Ten Rings', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'She-Hulk, Wallbreaker', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Sol Ring', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Spectator Seating', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Speed, Young Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Sulfur Falls', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Swords to Plowshares', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Talisman of Conviction', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Talisman of Creativity', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Talisman of Progress', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'The Wasp, Winsome Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Thor, Asgard''s Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Thought Vessel', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Tome of Legends', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Unclaimed Territory', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Vision, Synthezoid Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'War Machine, Avenging Arsenal', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'West Coast Expansion', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR IGNORE INTO precon_membership (commander_slug, card_name, source) VALUES ('captain-america-team-leader', 'Winter Soldier, Reborn Avenger', 'Wizards official Marvel Super Heroes Commander Decklists — Avengers Assemble');
INSERT OR REPLACE INTO precon_coverage (commander_slug, precon_name, source_url, distinct_names, verified_at) VALUES ('captain-america-team-leader', 'Avengers Assemble', 'https://magic.wizards.com/en/news/announcements/marvel-super-heroes-commander-decklists', 87, '2026-10-25');
-- After applying, reapply synergy flags from membership (see synergy-sync companion):
-- UPDATE commander_synergy SET in_base_precon = 1 WHERE EXISTS (SELECT 1 FROM cards c JOIN precon_membership pm ON pm.card_name = c.name AND pm.commander_slug = commander_synergy.commander_slug WHERE c.scryfall_id = commander_synergy.scryfall_id);
