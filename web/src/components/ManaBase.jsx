import React, { useState, useEffect, useRef } from "react";
import { money } from "../api.js";
import { manaPoolCardUrl, tcgplayerMassEntryUrl } from "../affiliates.js";
import { trackAffiliateClick } from "../analytics.js";
import { buildDeckText, buildManaPoolAddDeckUrl, buildBuySet } from "./searchBuySet.js";
import { LAND_CYCLES } from "./landCycles.js";

const COLORS = ["W", "U", "B", "R", "G"];
const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const PIP_IMG = {
  W: "/mana/white-v2.png",
  U: "/mana/blue-v2.png",
  B: "/mana/black-v2.png",
  R: "/mana/red-v2.png",
  G: "/mana/green-v2.png",
  C: "/mana/colorless-v2.png",
};
const PRIORITIES = ["early", "main", "splash"];

function ColorToggle({ color, selected, priority, onToggle, onPriority }) {
  return (
    <div className={`mb-color${selected ? " on" : ""}`}>
      <button
        type="button"
        className="mb-color-btn"
        onClick={() => onToggle(color)}
        aria-pressed={selected}
        aria-label={`${COLOR_NAMES[color]}${selected ? " (selected)" : ""}`}
      >
        <img src={PIP_IMG[color]} alt={COLOR_NAMES[color]} draggable="false" />
      </button>
      {selected && (
        <div className="mb-priority" role="group" aria-label={`${COLOR_NAMES[color]} priority`}>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={`mb-prio${priority === p ? " on" : ""}`}
              onClick={() => onPriority(color, p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SEARCH_CYCLES = [
  ["", "All cycles"], ["basic", "Basic"], ["bicycle", "Bicycle"], ["bond", "Bond"],
  ["bounce", "Bounce"], ["check", "Check"], ["fast", "Fast"], ["filter", "Filter"],
  ["gainland", "Gain"], ["guildgate", "Guildgate"], ["horizon", "Horizon"],
  ["pain", "Pain"], ["panorama", "Panorama"], ["rainbow", "Rainbow"],
  ["shock", "Shock"], ["slow", "Slow"], ["snarl", "Snarl"], ["snow_dual", "Snow dual"],
  ["storage", "Storage"], ["surveil", "Surveil"], ["tango", "Tango"],
  ["temple", "Temple"], ["thriving", "Thriving"], ["triome", "Triome"],
  ["triple", "Triple"], ["urza", "Urza"], ["utility", "Utility"], ["vivid", "Vivid"],
  ["unclassified", "Unclassified"],
];
const SEARCH_COLORS = ["W", "U", "B", "R", "G", "C"];
const SEARCH_COLOR_NAMES = { ...COLOR_NAMES, C: "Colorless" };

function PriceStaleNote({ snapshot }) {
  if (!snapshot) return null;
  const ageDays = Math.floor(
    (Date.now() - new Date(snapshot + "T00:00:00Z").getTime()) / 86400000
  );
  if (ageDays > 30) {
    return (
      <span className="mb-stale mb-stale-expired">
        {" "}Pricing is over 30 days old — treat prices as expired and verify
        every card before buying.
      </span>
    );
  }
  if (ageDays > 7) {
    return (
      <span className="mb-stale">
        {" "}Prices are {ageDays} days old and may be stale — verify before you buy.
      </span>
    );
  }
  return null;
}

function entryBadge(entry) {
  if (entry.status === "untapped") return <span className="mb-land-entry mb-land-entry-untapped">Untapped</span>;
  if (entry.status === "tapped") return <span className="mb-land-entry">Enters tapped</span>;
  return (
    <span className="mb-land-entry" title={entry.condition || "Conditional entry"}>
      Conditional{entry.condition ? `: ${entry.condition}` : ""}
    </span>
  );
}

function LandSearch() {
  const [colors, setColors] = useState([]);
  const [sort, setSort] = useState("price_asc");
  const [hideBasics, setHideBasics] = useState(false);
  const [untappedOnly, setUntappedOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");
  const [cycle, setCycle] = useState("");
  const [gameChanger, setGameChanger] = useState("any");
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [copied, setCopied] = useState(null);
  const ranOnce = useRef(false);

  const toggleSearchColor = (c) => {
    setColors((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
    setResults([]);
    setMeta(null);
  };

  const search = async (offset = 0, append = false) => {
    setLoading(true);
    setError(null);
    setCopied(null);
    try {
      const params = new URLSearchParams({
        sort,
        include_basics: hideBasics ? "0" : "1",
        untapped_only: untappedOnly ? "1" : "0",
        game_changer: gameChanger,
        limit: "50",
        offset: String(offset),
      });
      if (colors.length > 0) params.set("colors", colors.join(""));
      if (maxPrice !== "") {
        const n = Number(maxPrice);
        if (!Number.isFinite(n) || n < 0) throw new Error("Max price must be a number of $0 or more.");
        params.set("max_price", String(n));
      }
      if (cycle) params.set("cycle", cycle);
      const res = await fetch(`/api/manabase-search?${params}`);
      if (res.status === 429) {
        throw new Error("Too many requests — please wait a moment and try again.");
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setMeta(data.meta);
      setResults((prev) => (append ? [...prev, ...data.results] : data.results));
    } catch (e) {
      if (!append) { setResults([]); setMeta(null); }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Run once when the tab first opens, so the search is not an empty page.
  useEffect(() => {
    if (!ranOnce.current) {
      ranOnce.current = true;
      search(0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      results.forEach((r) => next.add(r.name));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const buySet = buildBuySet(results, [...selected]);
  const deckText = buildDeckText(buySet.names);

  const copyFor = async (which) => {
    try {
      await navigator.clipboard.writeText(deckText);
      setCopied(which);
    } catch {
      setError("Copy failed — your browser blocked clipboard access. Select the list manually.");
    }
  };

  return (
    <div className="mb-search">
      <p className="combos-sub">
        Search every land by color — cheapest version shown. Most-used ranking
        is coming once our data source is confirmed; until then results sort by
        cheapest price.
      </p>

      <h2>Your colors</h2>
      <div className="mb-colors" role="group" aria-label="Choose colors">
        {SEARCH_COLORS.map((c) => (
          <div key={c} className={`mb-color${colors.includes(c) ? " on" : ""}`}>
            <button
              type="button"
              className="mb-color-btn"
              onClick={() => toggleSearchColor(c)}
              aria-pressed={colors.includes(c)}
              aria-label={`${SEARCH_COLOR_NAMES[c]}${colors.includes(c) ? " (selected)" : ""}`}
            >
              <img src={PIP_IMG[c]} alt={SEARCH_COLOR_NAMES[c]} draggable="false" />
            </button>
          </div>
        ))}
      </div>
      <p className="combos-sub">
        {colors.length === 0
          ? "No colors picked — showing every land."
          : "A land matches if it produces at least one of these colors."}
        {" "}Colorless-only lands match only when the colorless pip is picked.
      </p>

      <h2>Sort &amp; filters</h2>
      <div className="mb-search-filters">
        <label>
          Sort
          <select value={sort} onChange={(e) => { setSort(e.target.value); setResults([]); setMeta(null); }}>
            <option value="price_asc">Cheapest first</option>
            <option value="price_desc">Most expensive first</option>
            <option value="name">Name A–Z</option>
            <option value="most_used" disabled>Most used (coming soon)</option>
          </select>
        </label>
        <label>
          Cycle
          <select value={cycle} onChange={(e) => { setCycle(e.target.value); setResults([]); setMeta(null); }}>
            {SEARCH_CYCLES.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Game Changers
          <select value={gameChanger} onChange={(e) => { setGameChanger(e.target.value); setResults([]); setMeta(null); }}>
            <option value="any">Any</option>
            <option value="include">Only Game Changers</option>
            <option value="exclude">No Game Changers</option>
          </select>
        </label>
        <label>
          Max price ($)
          <input
            type="number" min="0" step="0.01" placeholder="No cap" value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </label>
        <label className="mb-search-check">
          <input
            type="checkbox" checked={hideBasics}
            onChange={(e) => { setHideBasics(e.target.checked); setResults([]); setMeta(null); }}
          />
          Hide basics
        </label>
        <label className="mb-search-check">
          <input
            type="checkbox" checked={untappedOnly}
            onChange={(e) => { setUntappedOnly(e.target.checked); setResults([]); setMeta(null); }}
          />
          Untapped only
        </label>
      </div>

      <button type="button" className="mb-run" onClick={() => search(0, false)} disabled={loading}>
        {loading ? "Searching…" : "Search lands"}
      </button>

      {error && <p className="mb-error">{error}</p>}

      {meta && (
        <p className="combos-sub">
          {meta.total.toLocaleString()} lands match · {meta.servedCount.toLocaleString()} searchable ·{" "}
          {meta.heldCount} held (double-faced, adventure &amp; fetchlands) · prices from{" "}
          {meta.priceSnapshot}.
          <PriceStaleNote snapshot={meta.priceSnapshot} />
        </p>
      )}

      {results.length > 0 && (
        <div className="mb-buybar">
          <div className="mb-buybar-summary">
            <strong>{selected.size} selected</strong>
            {selected.size > 0 && (
              <>
                {" · "}{buySet.names.length} in buy set · {money(buySet.total)} total
                {buySet.excludedBasics.length > 0 && (
                  <> · {buySet.excludedBasics.length} basic{buySet.excludedBasics.length > 1 ? "s" : ""} left out</>
                )}
                {buySet.capped && <> · capped at 100 lines ({buySet.overCap} more selected)</>}
              </>
            )}
          </div>
          <p className="combos-sub">
            Basics are left out of the buy set — a Plains is a Plains.
            Tick the lands you want, then buy the set.
          </p>
          <div className="mb-buybar-actions">
            <button type="button" onClick={selectPage}>Select all on this page</button>
            <button type="button" onClick={clearSelection} disabled={selected.size === 0}>Clear selection</button>
            {buySet.names.length > 0 && (
              <>
                <a
                  className="btn-copy combo-eq-buy"
                  href={buildManaPoolAddDeckUrl(buySet.names)}
                  target="_blank" rel="noopener noreferrer"
                >
                  Buy on Mana Pool
                </a>
                <button type="button" onClick={() => copyFor("manapool")}>
                  {copied === "manapool" ? "Copied ✓" : "Copy list for Mana Pool"}
                </button>
                <button type="button" onClick={() => copyFor("tcgplayer")}>
                  {copied === "tcgplayer" ? "Copied ✓" : "Copy list for TCGplayer"}
                </button>
              </>
            )}
          </div>
          {copied === "manapool" && (
            <p className="combos-sub">
              Copied — paste it into{" "}
              <a href="https://manapool.com/mass-entry-info" target="_blank" rel="noopener noreferrer">Mana Pool&rsquo;s mass entry</a>.
            </p>
          )}
          {copied === "tcgplayer" && (
            <p className="combos-sub">
              Copied — paste it at{" "}
              <a href={tcgplayerMassEntryUrl()} target="_blank" rel="noopener noreferrer">TCGplayer mass entry</a>.
            </p>
          )}
          {buySet.names.length > 0 && (
            <p className="combos-sub">Buying on Mana Pool opens the list ready to add to cart.</p>
          )}
        </div>
      )}

      {results.length === 0 && !loading && !error && meta && (
        <p className="combos-sub">No lands match — try fewer colors or a higher max price.</p>
      )}

      <div className="mb-lands">
        {results.map((r) => (
          <div key={r.oracle_id} className="mb-land mb-search-land">
            <label className="mb-search-pick">
              <input
                type="checkbox" checked={selected.has(r.name)}
                onChange={() => toggleSelect(r.name)}
              />
              <span className="mb-land-name">{r.name}</span>
            </label>
            <div className="mb-land-meta">
              {r.colors_produced.length > 0 ? (
                r.colors_produced.map((c) => (
                  <img key={c} src={PIP_IMG[c]} alt={COLOR_NAMES[c]} width={16} height={16} draggable="false" />
                ))
              ) : (
                <img src={PIP_IMG.C} alt="Colorless" width={16} height={16} draggable="false" />
              )}
              {entryBadge(r.entry)}
              {r.game_changer && <span className="mb-land-gc">Game Changer</span>}
            </div>
            <div className="mb-land-meta">
              <span className="mb-land-price">{money(r.cheapest.price)}</span>
              <span className="mb-land-cycle">{r.cycle === "unclassified" ? "" : r.cycle}</span>
              {r.is_basic && <span className="mb-land-basic">basic</span>}
            </div>
            <div className="mb-land-print">{r.cheapest.printing} · {r.cheapest.finish}</div>
            {r.status === "utility_display_only" && (
              <div className="mb-land-utility">
                <span className="mb-land-utility-tag">Utility land — shown for reference</span>
                {r.oracle_text && <p className="mb-land-oracle">{r.oracle_text}</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {meta && results.length > 0 && results.length < meta.total && (
        <button
          type="button" className="mb-run" onClick={() => search(results.length, true)} disabled={loading}
        >
          {loading ? "Loading…" : `Show more (${meta.total - results.length} left)`}
        </button>
      )}
    </div>
  );
}

function finishLabel(printing) {
  // "PLST #DMU-243 (usd)" → "PLST #DMU-243 · nonfoil"
  if (!printing) return "";
  return printing
    .replace(" (usd_foil)", " · foil")
    .replace(" (usd_etched)", " · etched")
    .replace(" (usd)", " · nonfoil");
}

function LandGallery() {
  const [lands, setLands] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch("/api/manabase?list=all")
      .then((r) => r.json())
      .then((d) => setLands(d.lands))
      .catch(() => setLands([]));
  }, []);

  if (lands === null) return <p className="combos-sub">Loading lands…</p>;
  const byName = Object.fromEntries(lands.map((l) => [l.name, l]));

  return (
    <div className="mb-gallery">
      {LAND_CYCLES.map((cycle) => {
        const members = cycle.members
          .map((n) => byName[n])
          .filter(Boolean);
        if (members.length === 0) return null;
        const prices = members.map((m) => m.price).filter((p) => p != null);
        const lo = Math.min(...prices), hi = Math.max(...prices);
        const isOpen = open === cycle.id;
        return (
          <div key={cycle.id} className={`mb-cycle${isOpen ? " open" : ""}`}>
            <button
              type="button" className="mb-cycle-head"
              onClick={() => setOpen(isOpen ? null : cycle.id)}
              aria-expanded={isOpen}
            >
              <span className="mb-cycle-name">{cycle.name}</span>
              <span className="mb-cycle-count">{members.length}</span>
              <span className="mb-cycle-range">
                {money(lo)}{lo !== hi && ` – ${money(hi)}`}
              </span>
              <span className="mb-cycle-arrow">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="mb-cycle-body">
                <p className="mb-cycle-trait">{cycle.trait}</p>
                <div className="mb-lands">
                  {members.map((l) => (
                    <div key={l.name} className="mb-land">
                      <div className="mb-land-name">{l.name}</div>
                      <div className="mb-land-meta">
                        <span className="mb-land-price">{money(l.price)}</span>
                        {l.lifeCost > 0 && (
                          <span className="mb-land-life">−{l.lifeCost} ♥</span>
                        )}
                        {l.conditional && <span className="mb-land-cond">conditional</span>}
                      </div>
                      <a
                        className="btn-copy combo-eq-buy"
                        href={manaPoolCardUrl(l.name)}
                        target="_blank" rel="noopener noreferrer"
                        onClick={() => trackAffiliateClick("manapool", { view: "manabase-browse" })}
                      >
                        Buy this card
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ManaBase() {
  const [tab, setTab] = useState("solver");
  const [colors, setColors] = useState([]);
  const [priorities, setPriorities] = useState({});
  const [budget, setBudget] = useState(25);
  const [slots, setSlots] = useState(10);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const toggleColor = (c) => {
    setColors((prev) => {
      if (prev.includes(c)) {
        const next = prev.filter((x) => x !== c);
        setPriorities((pp) => {
          const np = { ...pp };
          delete np[c];
          return np;
        });
        return next;
      }
      setPriorities((pp) => ({ ...pp, [c]: pp[c] || "main" }));
      return [...prev, c];
    });
    setResult(null);
  };

  const setPriority = (c, p) => {
    setPriorities((pp) => ({ ...pp, [c]: p }));
    setResult(null);
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        colors: colors.join(""),
        priorities: JSON.stringify(priorities),
        budget: String(budget),
        slots: String(slots),
        opponents: "3",
        bracket: "3",
      });
      const res = await fetch(`/api/manabase?${params}`);
      if (res.status === 429) {
        throw new Error("Too many requests — please wait a moment and try again.");
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Solver failed");
      setResult(data);
    } catch (e) {
      setResult(null); // never leave a stale package after a failed request
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="combos-page manabase-page">
      <div className="combo-card-ep">Beta</div>
      <h1>Fix My Mana Base</h1>
      <p className="combos-sub">
        Suggested land purchases optimized for your selected colors,
        priorities and budget under the stated assumptions. Or browse every
        land by cycle.
      </p>

      <div className="mb-tabs" role="tablist">
        <button
          type="button" role="tab" aria-selected={tab === "solver"}
          className={`mb-tab${tab === "solver" ? " on" : ""}`}
          onClick={() => setTab("solver")}
        >
          Find my lands
        </button>
        <button
          type="button" role="tab" aria-selected={tab === "browse"}
          className={`mb-tab${tab === "browse" ? " on" : ""}`}
          onClick={() => setTab("browse")}
        >
          Browse lands
        </button>
        <button
          type="button" role="tab" aria-selected={tab === "search"}
          className={`mb-tab${tab === "search" ? " on" : ""}`}
          onClick={() => setTab("search")}
        >
          Search lands
        </button>
      </div>

      {tab === "search" && <LandSearch />}
      {tab === "browse" && <LandGallery />}
      {tab === "solver" && (
      <>
      <h2>1. Your colors</h2>
      <div className="mb-colors" role="group" aria-label="Choose colors">
        {COLORS.map((c) => (
          <ColorToggle
            key={c}
            color={c}
            selected={colors.includes(c)}
            priority={priorities[c] || "main"}
            onToggle={toggleColor}
            onPriority={setPriority}
          />
        ))}
      </div>

      <h2>2. Budget &amp; size</h2>
      <div className="mb-controls">
        <label>
          Budget: <strong>{money(budget)}</strong>
          <input
            type="range" min="5" max="200" step="5" value={budget}
            onChange={(e) => { setBudget(Number(e.target.value)); setResult(null); }}
          />
        </label>
        <label>
          Max lands: <strong>{slots}</strong>
          <input
            type="range" min="1" max="10" step="1" value={slots}
            onChange={(e) => { setSlots(Number(e.target.value)); setResult(null); }}
          />
        </label>
      </div>

      <button type="button" className="mb-run" onClick={run} disabled={loading}>
        {loading ? "Solving…" : colors.length === 0 ? "Find colorless lands 💎" : "Find my lands 💎"}
      </button>
      {colors.length === 0 && (
        <p className="combos-sub">No colors picked — this searches colorless-producing lands only.</p>
      )}

      {error && <p className="mb-error">{error}</p>}

      {result && (
        <div className="mb-results">
          <h2>
            Your package — {money(result.score.priceDollars)}
            <span className={`mb-status mb-status-${result.stats.status}`}>
              {result.stats.status === "optimal"
                ? "Optimal"
                : result.stats.status === "best_found"
                  ? `Best found (interrupted: ${result.stats.interruptReason || "node budget"})`
                  : result.stats.status === "interrupted_without_result"
                    ? "No result before interruption"
                    : result.stats.status === "empty_proven"
                      ? "No lands match these colors and budget"
                      : result.stats.status}
            </span>
          </h2>
          <p className="combos-sub">
            {result.lands.length} lands · penalty {result.score.penalty} ·
            {result.stats.nodesVisited.toLocaleString()} nodes searched
          </p>
          {result.perColor && Object.keys(result.perColor).length > 0 && (
            <div className="mb-shortfalls">
              {Object.entries(result.perColor).map(([c, v]) => (
                <span key={c} className={`mb-short${v.shortfall > 0 ? " unmet" : " met"}`}>
                  <img src={PIP_IMG[c] ?? PIP_IMG.C} alt={COLOR_NAMES[c] ?? c} width={16} height={16} draggable="false" /> {v.qualifying}/{v.target}
                  {v.shortfall > 0 ? ` (short ${v.shortfall})` : " ✓"}
                </span>
              ))}
            </div>
          )}
          <div className="mb-lands">
            {result.lands.map((l) => (
              <div key={l.name} className="mb-land">
                <div className="mb-land-name">{l.name}</div>
                <div className="mb-land-meta">
                  <span className="mb-land-price">{money(l.price)}</span>
                  {l.lifeCost > 0 && (
                    <span className="mb-land-life" title="Modeled life cost under the 3-use scoring scenario, not measured per-game loss">
                      −{l.lifeCost} ♥
                    </span>
                  )}
                  {l.conditional && <span className="mb-land-cond">conditional</span>}
                </div>
                <div className="mb-land-print">{finishLabel(l.pricePrinting)}</div>
                <a
                  className="btn-copy combo-eq-buy"
                  href={manaPoolCardUrl(l.name)}
                  target="_blank" rel="noopener noreferrer"
                  onClick={() => trackAffiliateClick("manapool", { view: "manabase" })}
                >
                  Buy this card
                </a>
              </div>
            ))}
          </div>
          <p className="mb-disclaimer">
            Suggested land purchases optimized for your selected colors,
            priorities and budget under the stated assumptions. Prototype:
            43 lands, scoring policy v1, bond lands resolved for 3 opponents.
            Prices are a {result.meta?.priceSnapshot || "2026-11-04"} snapshot
            of cheapest printings — verify at checkout. Life costs are modeled
            scoring values, not measured per-game loss.
            {(() => {
              const snap = result.meta?.priceSnapshot;
              if (!snap) return null;
              const ageDays = Math.floor(
                (Date.now() - new Date(snap + "T00:00:00Z").getTime()) / 86400000
              );
              if (ageDays > 30) {
                return (
                  <span className="mb-stale mb-stale-expired">
                    {" "}Pricing is over 30 days old — treat prices as
                    expired and verify every card before buying.
                  </span>
                );
              }
              if (ageDays > 7) {
                return (
                  <span className="mb-stale">
                    {" "}Prices are {ageDays} days old and may be stale —
                    verify before you buy.
                  </span>
                );
              }
              return null;
            })()}
          </p>
        </div>
      )}
      </>)}
    </div>
  );
}
