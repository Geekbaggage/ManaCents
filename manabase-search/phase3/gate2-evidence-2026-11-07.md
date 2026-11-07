# ManaBase Search — Gate 2 Evidence: reproducible 0/284 $5-badge comparison (release SHA 1a27ccb)

**Date:** 2026-11-07 (evidence run ~13:30 PT)
**Branch:** `robin/manabase-search-2026-11-06`
**Release commit:** `1a27ccb2faecc23f75d2f01fdfad91e90a2a6b9d`
**Preview:** https://search-phase5.manacents.pages.dev
**Preview deployment:** `d1d26506-77f9-434c-8187-b529875981aa` (source 1a27ccb)
**Bundle (curl-verified on the preview in this run):** `index-N3Eougco.js`
**API live on the preview (this run):** total 1,202 · priceSnapshot 2026-11-07 · rankingSnapshot 2026-11-07

**What this is NOT:** no production deploy, no main merge, no optimizer changes.
Gate 2 asks that the reported 0/284 display/gate-quote comparison be preserved
and reproducible, with snapshot/input identifiers, alongside the recorded
69/69 combos, 24/24 search, 29/29 hosted matrix for this SHA. This document
is that package.

---

## 1. Result summary — all re-run in this task

| Check | Command (from repo root `~/workspace/manacents-infra`) | Result | Exit |
|---|---|---|---|
| $5 badge divergence | `python3 manabase-search/phase3/check_budget_divergence.py` | **0 divergences out of 284** ranked entries; 0 displayed over $5.00; 0 unresolved; 0 embedded-copy mismatches | 0 |
| Combos tests | `cd web && node --test scripts/validate_combos.test.mjs` | **69 pass / 0 fail** | 0 |
| Search tests | `cd web && node --test functions/api/manabase-search.test.mjs` | **24 pass / 0 fail** | 0 |
| Hosted API matrix (fresh, live preview) | `node manabase-search/phase3/search_matrix.mjs https://search-phase5.manacents.pages.dev` | **29 pass / 0 fail** | 0 |

No divergent rows exist, so there is no divergence list to attach. If the
script ever exits non-zero it prints every divergent row (type, name,
oracle_id, displayed price, gate quote, difference, displayed printing).

**Re-run vs recorded:** the four rows above were all re-run by the author of
this document in this task, on this SHA, against the committed files and the
live preview. NOT re-run here (recorded from earlier runs): the live browser
smoke check (parent agent, Nov 7 12:06–12:08 PT, deployment `d1d26506`, 4/4
pass) and Charlie's own desktop smoke check in his reassessment. The
Playwright browser smoke test (`web/scripts/smoke.manabase-search.mjs`) is
written and wired but still cannot run in this VM (Chromium binary download
fails); the node render test + hook guard are what run in prebuild.

---

## 2. How the comparison works (so a third party can trust the 0)

- **Source of truth for the gate quote:** Charlie's sort file,
  `manabase-search/phase2/charlie-budget-land-sort-2026-11-07.json`
  (committed). For each of the 284 members with `default_recommendation: true`
  across the 25 type lists, the script takes that member's
  `released_quote_usd` (283 distinct cards; Path of Ancestry is ranked in two
  types, which is why 284 entries ≠ 283 cards).
- **Displayed price:** the serving row's `cheapest.price`, looked up by
  `oracle_id` in `web/functions/api/_manabase_search.json`. All 284 ranked
  members resolve to a serving row (0 unresolved).
- **Comparison:** `Decimal(str(displayed)) == Decimal(gate_quote)` — exact
  decimal equality, no float tolerance. Any difference of any size counts.
- **Why not the embedded copy:** the generator copies Charlie's quote into
  each serving row's `budget_rankings`. Comparing the serving file against its
  own embedded copy would be circular. The script compares the serving file
  against the independent source file, and then separately verifies each
  serving row's embedded `budget_rankings` entry carries the same quote as
  the source (generator-drift check — 0 mismatches in this run).
- **Snapshot-date note:** the 118 divergences seen on Nov 6 prices were pure
  snapshot drift (Nov 6 bulk vs Charlie's Nov 7 gate quotes). The gate quotes
  and the serving data in this run are both from the Nov 7 bulk below, which
  is why the comparison closes at 0. A future refresh against a different
  bulk is expected to diverge until the gate quotes are refreshed with it —
  that is the divergence check doing its job, not a failure of the method.

---

## 3. Input identifiers (everything needed to reproduce)

### Release artifact
| Item | Value |
|---|---|
| Branch | `robin/manabase-search-2026-11-06` |
| Release commit (full SHA) | `1a27ccb2faecc23f75d2f01fdfad91e90a2a6b9d` |
| Preview deployment | `d1d26506-77f9-434c-8187-b529875981aa` |
| Bundle on the preview | `index-N3Eougco.js` (curl-verified this run) |

### Price snapshot + bulks (Nov 7 refresh)
| Item | Value |
|---|---|
| Price snapshot date | **2026-11-07** (shown in the Search tab as "prices from 2026-11-07") |
| Oracle bulk | `oracle-cards-20261107100202.jsonl.gz`, 25,360,661 bytes, SHA-256 `3a2ad385b3791fa3997fca5d6ffc9fcd4d6a8837ffe8871c1e120ed6a6318ed1`, updated 2026-11-07T10:02:02Z |
| Default bulk | `default-cards-20261107100655.jsonl.gz`, 80,897,089 bytes, SHA-256 `dab6246b7bdaefce96d1f49fe5f99359cc09fce3580dafa743d1fd916ebb8065`, updated 2026-11-07T10:06:55Z |
| Roster re-check (Nov 7) | Row-identical (1,312 rows; 1,212 legal; 1,053 verified / 159 held / 100 excluded); GC list identical (53 names) |

### Serving data (the file the comparison reads)
| Item | Value |
|---|---|
| Path (repo) | `web/functions/api/_manabase_search.json` |
| SHA-256 as committed at 1a27ccb | `996c30b8ebcde86d34d6354f7895accba458d7002330af29179f16364e955b5c` |
| Meta | `price_snapshot: 2026-11-07` · served 1,202 (1,101 search + 101 face) · held 10 fetches · cheapest set **$19,950.58** · `ranking.ranked_entries: 284` |
| Generator | `manabase-search/phase3/generate_serving_data.py` |

### Charlie's sort file (the gate-quote source)
| Item | Value |
|---|---|
| Path (repo, committed) | `manabase-search/phase2/charlie-budget-land-sort-2026-11-07.json` |
| Drive file ID | `1-wLvCOSkBSlgwsXJ34EhRD6b6cjUrkDn` |
| SHA-256 of the committed file | `5261fd25c198723f27d774a3697b6680747ecbee263f1ad325b26fd372f0a822` (the Nov 7 08:58 PT download) |
| SHA-256 of the 11:45 PT re-download | `8838474db0df8f0a922cfcfe4eeba68dd06db6f4ea99afb08a46332d5d301b5b` |
| Stable content identifier | `beeec6b6a6f5aafb80b56a12f4691c89a73c022ea83692df8d42b4a9afa22af5` — SHA-256 of the parsed JSON with `retrieved_at` removed, re-serialized `json.dumps(indent=2)`. **Recomputed for the committed file in this task: identical.** This is the identifier that ties the committed file to the re-download; the raw bytes differ only by the restamped `retrieved_at` timestamp. |
| SHA stated in Charlie's handoff | `dbfbf125d88a3335ee81b31ad8da02cb0497562287101df24df492cfb82b4da6` — **not claimed, not verified** (see provenance record). |
| Provenance | Accepted by Valerie Estrada 2026-11-07 12:43 PT, verified-by-content only; signed record: `manabase-search/phase3/provenance-acceptance-record-2026-11-07.md` (Drive `15sVnHW50ayNWn6QVKD2rqnlV5A5YRHSI`). Never describe as byte-identical. |
| File-internal bulk | `bulk_sha256: dab6246b…` — the same Nov 7 default-cards bulk used for the serving data |

### Comparison script
| Item | Value |
|---|---|
| Path (repo) | `manabase-search/phase3/check_budget_divergence.py` |
| Committed in | `7d52e424ba00e2f69bf8814524ea2ca3b01b7aab` (same commit also commits `manabase-search/phase3/search_matrix.mjs`, previously working-area-only) |
| Run | `python3 manabase-search/phase3/check_budget_divergence.py` from the repo root; no arguments needed (defaults are repo-relative). Exit 0 = pass, exit 1 = any divergence / unresolved entry / count mismatch. Prints both input SHA-256s so a rerun is attributable. |
| Run context for this evidence | Executed with HEAD at `1a27ccb` (verified `git rev-parse HEAD` before the run). The script was committed afterward in `7d52e42`, which touches only the two scripts — no serving data changed, so the comparison result stands for the 1a27ccb tree. |

### Test / matrix commands
| Check | Command | Result in this run |
|---|---|---|
| Combos | `cd web && node --test scripts/validate_combos.test.mjs` | 69 tests, 69 pass, 0 fail (581 ms) |
| Search | `cd web && node --test functions/api/manabase-search.test.mjs` | 24 tests, 24 pass, 0 fail (906 ms) |
| Hosted matrix | `node manabase-search/phase3/search_matrix.mjs https://search-phase5.manacents.pages.dev` | 29 pass, 0 fail (incl. total 1202, snapshot 2026-11-07, preorderWatch 7, budgetTypes 25, two_color_fixing 208/161, Hallowed Fountain $7.55 ECL #265, optimizer still 43 lands) |

---

## 4. What this evidence does and does not close

- **Closes:** gate 2 as Charlie stated it — the 0/284 comparison is now a
  committed, re-runnable script with recorded inputs, and the 69/69, 24/24,
  29/29 results were re-run on this SHA (not merely quoted from an earlier
  run).
- **Does not close:** gate 1 (scheduler evidence + a successful refresh run —
  first weekly cron run is Sun Nov 8 07:00 PT), gate 3 (Val's phone-scale
  visual check + Q6), gate 4 (Val's explicit production approval naming
  production, scope, and exact merge/deploy action). The artifact must be
  reassessed if it changes.
- **Residuals (unchanged):** 10 typed fetchlands held (1,202 served of 1,212);
  snapshot prices drift daily between weekly refreshes; 7 preorder-only
  cases need re-ingest at the Nov 13 release; Best budget — researched is an
  editorial within-type order, not measured popularity; EDHREC permission
  remains unresolved; provenance is content-only.

## 5. Files

- This document: Drive 04_Handoffs + `manabase-search/phase3/gate2-evidence-2026-11-07.md` (committed on the review branch)
- Comparison script: `manabase-search/phase3/check_budget_divergence.py` (commit `7d52e42`)
- Matrix runner: `manabase-search/phase3/search_matrix.mjs` (commit `7d52e42`)
- Closeout handoff (incl. Charlie's reassessment): Drive `10su5mO5TeKX3ahn-kDVP5Uwq1q3dyStD`
- Refresh runbook: `manabase-search/REFRESH.md`
- Build plan: Drive `1LBKXhiCdOXbZqOb_jCYgMMQk7KpAb2eK` (§10 Q-dispositions, §16 gate-2 evidence)
