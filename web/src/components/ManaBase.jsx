import React, { useState, useEffect, useRef, useCallback } from "react";
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
  const [mode, setMode] = useState("produces");
  const [sort, setSort] = useState("price_asc");
  const [type, setType] = useState("");
  const [hideBasics, setHideBasics] = useState(false);
  const [untappedOnly, setUntappedOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");
  const [maxPriceDebounced, setMaxPriceDebounced] = useState("");
  const [cycle, setCycle] = useState("");
  const [gameChanger, setGameChanger] = useState("any");
  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [copied, setCopied] = useState(null);
  const [showAllBusy, setShowAllBusy] = useState(false);
  // Monotonic generation: a newer search supersedes older in-flight ones,
  // and a filter change aborts a running show-all.
  const seqRef = useRef(0);

  // Debounce Max price so typing does not fire a search per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setMaxPriceDebounced(maxPrice), 500);
    return () => clearTimeout(t);
  }, [maxPrice]);

  // The filters a search runs with. Read through a ref so the stable search
  // callback always sees the latest values.
  const filtersRef = useRef(null);
  filtersRef.current = {
    colors, mode, sort, type, hideBasics, untappedOnly,
    maxPrice: maxPriceDebounced, cycle, gameChanger,
  };

  const fetchPage = async (f, offset, limit) => {
    const params = new URLSearchParams({
      sort: f.sort,
      mode: f.mode,
      include_basics: f.hideBasics ? "0" : "1",
      untapped_only: f.untappedOnly ? "1" : "0",
      game_changer: f.gameChanger,
      limit: String(limit),
      offset: String(offset),
    });
    if (f.colors.length > 0) params.set("colors", f.colors.join(""));
    if (f.type) params.set("type", f.type);
    if (f.maxPrice !== "") {
      const n = Number(f.maxPrice);
      if (!Number.isFinite(n) || n < 0) throw new Error("Max price must be a number of $0 or more.");
      params.set("max_price", String(n));
    }
    if (f.cycle) params.set("cycle", f.cycle);
    const res = await fetch(`/api/manabase-search?${params}`);
    if (res.status === 429) {
      throw new Error("Too many requests — please wait a moment and try again.");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    return data;
  };

  // Stale-while-revalidate: a filter change re-searches, but the previous
  // results + meta stay on screen until the new page lands — the list never
  // goes blank on a filter change, and the Type dropdown (fed by meta)
  // keeps its options. Only a successful empty response clears the list
  // (a genuine "no lands match"); errors keep the stale list and show the
  // error instead.
  const search = useCallback(async (offset = 0, append = false, overrides = null) => {
    const f = { ...filtersRef.current, ...(overrides ?? {}) };
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setCopied(null);
    try {
      const data = await fetchPage(f, offset, 50);
      if (seq !== seqRef.current) return; // superseded by a newer search
      setMeta(data.meta);
      setResults((prev) => (append ? [...prev, ...data.results] : data.results));
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e.message);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  // Auto re-search on any filter change (and once on mount) — no manual
  // "Search lands" press is needed after changing a filter.
  useEffect(() => {
    search(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, mode, sort, type, hideBasics, untappedOnly, cycle, gameChanger, maxPriceDebounced]);

  // "Show all" for a picked type: page through the rest of the type's set
  // (API limit is 100/page) until meta.total is reached. Bounded sets only —
  // never shown for the unfiltered whole catalog. Aborts if the filters
  // change mid-load (the new search supersedes it).
  const showAll = async () => {
    if (!meta || !type || showAllBusy) return;
    const f = { ...filtersRef.current };
    const seq = seqRef.current;
    setShowAllBusy(true);
    setError(null);
    try {
      let offset = results.length;
      while (offset < meta.total) {
        const data = await fetchPage(f, offset, 100);
        if (seq !== seqRef.current) return; // filters changed — stop
        setMeta(data.meta);
        setResults((prev) => [...prev, ...data.results]);
        offset += data.results.length;
        if (data.results.length < 100) break;
      }
    } catch (e) {
      if (seq === seqRef.current) setError(e.message);
    } finally {
      setShowAllBusy(false);
    }
  };

  const toggleSearchColor = (c) => {
    setColors((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

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
        Search every land by color — cheapest released version shown. Sort by
        “Best budget — researched” for type-by-type budget picks from
        community + official research (Charlie, Nov 7), or by cheapest price.
        Most-used ranking is still coming once our data source is confirmed.
      </p>

      <div className="mb-search-modes" role="group" aria-label="Search mode">
        <button
          type="button"
          className={`mb-search-mode${mode === "produces" ? " on" : ""}`}
          onClick={() => { setMode("produces"); }}
          aria-pressed={mode === "produces"}
        >
          Produces these colors
        </button>
        <button
          type="button"
          className={`mb-search-mode${mode === "fits" ? " on" : ""}`}
          onClick={() => { setMode("fits"); }}
          aria-pressed={mode === "fits"}
        >
          Fits my commander
        </button>
      </div>
      <p className="combos-sub">
        {mode === "produces"
          ? "Produces: a land matches if it can produce at least one of the picked colors — including conditionally, when the condition is met. Conditional matches are marked “conditional” and are not guaranteed sources."
          : "Fits my commander: only lands legal in a deck with this color identity (whole-card color identity + basic land types)."}
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
          : mode === "fits"
            ? "Only lands legal in a deck with this color identity."
            : "A land matches if it produces at least one of these colors."}
        {" "}{mode === "fits"
          ? "The colorless pip means a colorless commander identity."
          : "Colorless-only lands match only when the colorless pip is picked."}
      </p>

      <h2>Sort &amp; filters</h2>
      <div className="mb-search-filters">
        <label>
          Sort
          <select value={sort} onChange={(e) => {
            const next = e.target.value;
            setSort(next);
            // Best-budget ranks live inside one type — picking the sort
            // without a type picks the first type list (Two Color Fixing);
            // the type picker stays visible so it can be switched.
            if (next === "best_budget" && !type) setType("two_color_fixing");
          }}>
            <option value="price_asc">Cheapest first</option>
            <option value="price_desc">Most expensive first</option>
            <option value="name">Name A–Z</option>
            <option value="best_budget">Best budget — researched</option>
            <option value="most_used" disabled>Most used (coming soon)</option>
          </select>
        </label>
        <label>
          Type / role
          <select value={type} onChange={(e) => {
            const next = e.target.value;
            setType(next);
            // Best budget needs a type — clearing the type while it is the
            // sort would 400, so fall back to cheapest-first instead of
            // leaving the user on an error.
            if (next === "" && sort === "best_budget") setSort("price_asc");
          }}>
            <option value="">All lands</option>
            {(meta?.budgetTypes ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.label} ({t.ranked} ranked)</option>
            ))}
          </select>
        </label>
        <label>
          Cycle
          <select value={cycle} onChange={(e) => { setCycle(e.target.value); }}>
            {SEARCH_CYCLES.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Game Changers
          <select value={gameChanger} onChange={(e) => { setGameChanger(e.target.value); }}>
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
            onChange={(e) => { setHideBasics(e.target.checked); }}
          />
          Hide basics
        </label>
        <label className="mb-search-check">
          <input
            type="checkbox" checked={untappedOnly}
            onChange={(e) => { setUntappedOnly(e.target.checked); }}
          />
          Untapped only
        </label>
      </div>

      <button
        type="button" className="mb-run"
        onClick={() => {
          // Manual re-run: use the Max price as typed right now (don't wait
          // for the debounce), and sync the debounced value so the effect
          // does not fire the same search again a moment later.
          setMaxPriceDebounced(maxPrice);
          search(0, false, { maxPrice });
        }}
        disabled={loading}
      >
        {loading ? "Searching…" : "Search lands"}
      </button>

      {error && <p className="mb-error">{error}</p>}

      {meta && (
        <p className="combos-sub">
          {meta.total.toLocaleString()} lands match · {meta.servedCount.toLocaleString()} searchable ·{" "}
          {meta.heldCount} held (fetchlands) · prices from{" "}
          {meta.priceSnapshot}.
          {meta.typeLabel && (
            <>{" "}Showing {meta.typeLabel} — {meta.rankedCount} budget-ranked, the rest alphabetical.</>
          )}
          {loading && <>{" "}Updating…</>}
          <PriceStaleNote snapshot={meta.priceSnapshot} />
        </p>
      )}

      {meta && sort === "best_budget" && meta.preorderWatch.length > 0 && (
        <p className="combos-sub">
          Preorder watch list — under $5 only on preorder prices (releasing Nov 13);
          their released prices are higher:{" "}
          {meta.preorderWatch.map((w) => `${w.name} ($${w.all_quoted_usd} preorder / $${w.released_usd} released)`).join(", ")}.
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
                  Review selected lands on Mana Pool
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
            <p className="combos-sub">
              Reviewing on Mana Pool opens your list ready to check — it does
              not complete a purchase. Prices shown here are Scryfall
              cheapest-printing quotes, not a guaranteed Mana Pool checkout price.
            </p>
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
              {r.conditional_colors && r.conditional_colors.length > 0 && (
                <span className="mb-land-cond-colors" title={r.conditional_colors.map((cc) => `${cc.color}: ${cc.dependency}`).join("; ")}>
                  conditional:{" "}
                  {[...new Set(r.conditional_colors.map((cc) => cc.color))].map((c) => (
                    <img key={c} src={PIP_IMG[c]} alt={`${COLOR_NAMES[c]} (conditional)`} width={16} height={16} draggable="false" />
                  ))}
                </span>
              )}
              {entryBadge(r.entry)}
              {r.game_changer && <span className="mb-land-gc">Game Changer</span>}
            </div>
            <div className="mb-land-meta">
              <span className="mb-land-price">{money(r.cheapest.price)}</span>
              <span className="mb-land-cycle">{r.cycle === "unclassified" ? "" : r.cycle}</span>
              {r.is_basic && <span className="mb-land-basic">basic</span>}
              {r.budget_rank != null && (
                <span className="mb-land-rank" title={r.budget_rank_context || ""}>
                  #{r.budget_rank} budget
                </span>
              )}
              {r.preorder_only_under_5 && (
                <span className="mb-land-preorder" title="Under $5 only on a preorder price (releasing Nov 13); the released price is higher.">
                  Preorder only
                </span>
              )}
            </div>
            <div className="mb-land-print">{r.cheapest.printing} · {r.cheapest.finish}</div>
            {r.budget_rank != null && r.budget_rank_context && (
              <div className="mb-land-rank-note">{r.budget_rank_context}</div>
            )}
            {r.status === "face_row" && (
              <div className="mb-land-face">
                <span className="mb-land-face-tag" title={r.land_drop.note}>
                  {r.land_drop.code === "requires_transformation"
                    ? "Requires transformation — not a land drop from hand"
                    : r.land_drop.code === "playable_choice"
                      ? "Land face: playable choice"
                      : r.land_drop.code === "land_front"
                        ? "Land on the front face"
                        : "One card — land + Adventure"}
                </span>
                {r.land_faces.length > 1 && (
                  <span className="mb-land-faces">
                    Faces: {r.land_faces.map((f) => f.name).join(" / ")}
                  </span>
                )}
                {r.other_faces.length > 0 && (
                  <span className="mb-land-faces">
                    Other face: {r.other_faces.map((f) => `${f.name} (${f.type_line})`).join(", ")}
                  </span>
                )}
              </div>
            )}
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
        <>
          <button
            type="button" className="mb-run" onClick={() => search(results.length, true)} disabled={loading || showAllBusy}
          >
            {loading ? "Loading…" : `Show more (${meta.total - results.length} left)`}
          </button>
          {type && (
            <button
              type="button" className="mb-run" onClick={showAll} disabled={loading || showAllBusy}
            >
              {showAllBusy ? "Loading all…" : `Show all (${meta.total} in this type)`}
            </button>
          )}
        </>
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

// Browse lands by cycle — the FULL catalog (1,202 searchable), not the
// 43-land pilot. Collapsed rows show true full counts + price ranges from
// meta.cycleCounts (one cheap request); expanding a cycle loads that cycle's
// complete membership by paging the search API (limit 100/page) until the
// count is reached — no 50-cap, no truncation. Unclassified lands get their
// own group at the end: they are 861 of 1,202 lands, and leaving them out
// of Browse would silently hide most of the catalog. The optimizer's
// pilot-only gallery is gone; Search remains the place for color/type
// filtering and the buy set.
const LAND_TRAITS = Object.fromEntries(
  LAND_CYCLES.map((c) => [c.id, c.trait])
);

function LandGallery() {
  const [cycleCounts, setCycleCounts] = useState(null);
  const [open, setOpen] = useState(null);
  const [members, setMembers] = useState({});
  const [loadingCycle, setLoadingCycle] = useState(null);
  const [error, setError] = useState(null);
  const openSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/manabase-search?limit=1")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCycleCounts(d.meta?.cycleCounts ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the land list — try again.");
      });
    return () => { cancelled = true; };
  }, []);

  const toggleCycle = async (id) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next === null || members[id]) return;
    const total = (cycleCounts ?? []).find((c) => c.id === id)?.count ?? 0;
    const mySeq = ++openSeq.current;
    setLoadingCycle(id);
    setError(null);
    try {
      const rows = [];
      for (let offset = 0; offset < total; offset += 100) {
        const res = await fetch(
          `/api/manabase-search?cycle=${id}&sort=name&limit=100&offset=${offset}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Browse failed");
        if (mySeq !== openSeq.current) return; // user closed/switched — stop
        rows.push(...data.results);
        if (data.results.length < 100) break;
      }
      if (mySeq !== openSeq.current) return;
      if (rows.length !== total) {
        throw new Error(
          `Expected ${total} lands in this set but loaded ${rows.length} — try again.`
        );
      }
      setMembers((prev) => ({ ...prev, [id]: rows }));
    } catch (e) {
      if (mySeq === openSeq.current) setError(e.message);
    } finally {
      if (mySeq === openSeq.current) setLoadingCycle(null);
    }
  };

  if (cycleCounts === null) {
    return error
      ? <p className="mb-error">{error}</p>
      : <p className="combos-sub">Loading lands…</p>;
  }

  const byId = Object.fromEntries(cycleCounts.map((c) => [c.id, c]));
  const labelOf = (id) =>
    (SEARCH_CYCLES.find(([cid]) => cid === id) ?? [id, id])[1];
  // Order: the Search tab's cycle order, then any cycle the data has that
  // the list does not, with Unclassified last.
  const ordered = [
    ...SEARCH_CYCLES
      .filter(([id]) => id !== "" && id !== "unclassified" && byId[id])
      .map(([id]) => id),
    ...Object.keys(byId).filter(
      (id) => id !== "unclassified" && !SEARCH_CYCLES.some(([cid]) => cid === id)
    ),
    ...(byId.unclassified ? ["unclassified"] : []),
  ];

  return (
    <div className="mb-gallery">
      <p className="combos-sub">
        Every land by set — {cycleCounts.reduce((n, c) => n + c.count, 0).toLocaleString()} searchable
        lands, full sets, cheapest released version shown. Tap a set to see all of it.
      </p>
      {error && <p className="mb-error">{error}</p>}
      {ordered.map((id) => {
        const c = byId[id];
        const isOpen = open === id;
        const rows = members[id] ?? null;
        return (
          <div key={id} className={`mb-cycle${isOpen ? " open" : ""}`}>
            <button
              type="button" className="mb-cycle-head"
              onClick={() => toggleCycle(id)}
              aria-expanded={isOpen}
            >
              <span className="mb-cycle-name">{labelOf(id)}</span>
              <span className="mb-cycle-count">{c.count}</span>
              <span className="mb-cycle-range">
                {money(c.minPrice)}{c.minPrice !== c.maxPrice && ` – ${money(c.maxPrice)}`}
              </span>
              <span className="mb-cycle-arrow">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="mb-cycle-body">
                {LAND_TRAITS[id] && <p className="mb-cycle-trait">{LAND_TRAITS[id]}</p>}
                {loadingCycle === id && <p className="combos-sub">Loading all {c.count} lands…</p>}
                {rows && (
                  <div className="mb-lands">
                    {rows.map((l) => (
                      <div key={l.oracle_id} className="mb-land">
                        <div className="mb-land-name">{l.name}</div>
                        <div className="mb-land-meta">
                          <span className="mb-land-price">{money(l.cheapest.price)}</span>
                          {l.entry && entryBadge(l.entry)}
                          {l.game_changer && <span className="mb-land-gc">Game Changer</span>}
                          {l.status === "face_row" && (
                            <span className="mb-land-face-tag" title={l.land_drop.note}>
                              {l.land_drop.code === "requires_transformation"
                                ? "Requires transformation — not a land drop from hand"
                                : l.land_drop.code === "playable_choice"
                                  ? "Land face: playable choice"
                                  : l.land_drop.code === "land_front"
                                    ? "Land on the front face"
                                    : "One card — land + Adventure"}
                            </span>
                          )}
                        </div>
                        <div className="mb-land-print">{l.cheapest.printing} · {l.cheapest.finish}</div>
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
                )}
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
        land by set, or search the full catalog by color and type.
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
