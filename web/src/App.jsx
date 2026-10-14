import React, { useEffect, useMemo, useRef, useState } from "react";
import { searchCommanders, fetchUpgrades, money } from "./api.js";
import CheckoutBar from "./components/CheckoutBar.jsx";
import Footer from "./components/Footer.jsx";

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CardTile({ card, selected, onToggle, onSwap }) {
  return (
    <div className={`card-tile${selected ? " selected" : ""}`}>
      <div className="imgwrap" onClick={onToggle} role="button" tabIndex={0}
        aria-label={`${selected ? "Remove" : "Add"} ${card.name}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}>
        {card.image_url ? (
          <img className="card-img" src={card.image_url} alt={card.name} loading="lazy" />
        ) : (
          <div className="card-img" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>{card.name}</div>
        )}
      </div>
      <div className="meta">
        <div className="meta-head">
          <span className={`select-dot${selected ? " on" : ""}`}>{selected ? "✓" : "＋"}</span>
          <span className="name">{card.name}</span>
        </div>
        <div className="price-row">
          <span className="price">{money(card.usd)}</span>
          {card.score != null && (
            <span className={`value-badge ${card.tier}`}>{card.score} Value</span>
          )}
        </div>
        <span className="role">{card.roleLabel}</span>
        <button className="swap" onClick={onSwap}>Already own this? Swap it</button>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("landing");
  const [cmdrInput, setCmdrInput] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [selectedCmdr, setSelectedCmdr] = useState(null);
  const [budgetInput, setBudgetInput] = useState("40");
  const [mode, setMode] = useState("tuneup");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState(null);
  const [resultError, setResultError] = useState("");
  const [deselected, setDeselected] = useState(new Set());
  const [swaps, setSwaps] = useState({});
  const [addedBreakers, setAddedBreakers] = useState([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [includeUniversal, setIncludeUniversal] = useState(false);
  const [including, setIncluding] = useState(false);
  const [toast, setToast] = useState("");
  const suggestRef = useRef(null);

  const debouncedQuery = useDebounced(cmdrInput, 260);

  useEffect(() => {
    let alive = true;
    if (debouncedQuery.trim().length >= 2 && !selectedCmdr) {
      searchCommanders(debouncedQuery.trim())
        .then((list) => { if (alive) { setSuggestions(list); setShowSuggest(true); } })
        .catch(() => { if (alive) { setSuggestions([]); setShowSuggest(true); } });
    } else {
      setSuggestions([]);
      setShowSuggest(false);
    }
    return () => { alive = false; };
  }, [debouncedQuery, selectedCmdr]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const pickCommander = (c) => {
    setSelectedCmdr(c);
    setCmdrInput(c.name);
    setShowSuggest(false);
  };

  const submit = async (withUniversal = false, overrides = {}) => {
    setFormError("");
    if (!selectedCmdr) { setFormError("Choose a commander first."); return; }
    const effMode = overrides.mode ?? mode;
    const effBudgetInput = overrides.budgetInput ?? budgetInput;
    const budget = parseFloat(effBudgetInput);
    if (!Number.isFinite(budget) || budget < 1 || budget > 1000) {
      setFormError("Enter a budget between $1 and $1,000.");
      return;
    }
    if (withUniversal) setIncluding(true);
    else setLoading(true);
    setResultError("");
    try {
      const data = await fetchUpgrades(selectedCmdr.slug, budget, effMode, withUniversal);
      setResult(data);
      if (overrides.mode) setMode(overrides.mode);
      if (overrides.budgetInput) setBudgetInput(overrides.budgetInput);
      setIncludeUniversal(withUniversal);
      setDeselected(new Set());
      setSwaps({});
      setAddedBreakers([]);
      setShowSkipped(false);
      setView("results");
      window.scrollTo(0, 0);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setLoading(false);
      setIncluding(false);
    }
  };

  // Rebuild the current results with a different mode/budget (hero controls).
  const rebuild = (patch) => {
    if (loading || including) return;
    submit(false, patch);
  };

  const visibleUpgrades = useMemo(() => {
    if (!result) return [];
    const applySwaps = (list) =>
      list.map((c) => {
        const s = swaps[c.scryfall_id];
        return s ? { ...s, _origId: c.scryfall_id, swappedIn: true } : c;
      });
    return [...applySwaps(result.upgrades), ...applySwaps(addedBreakers)];
  }, [result, swaps, addedBreakers]);

  const selectedCards = useMemo(
    () => visibleUpgrades.filter((c) => !deselected.has(c.scryfall_id)),
    [visibleUpgrades, deselected]
  );

  const total = useMemo(
    () => Math.round(selectedCards.reduce((s, c) => s + c.usd, 0) * 100) / 100,
    [selectedCards]
  );
  const remaining = result ? Math.round((result.budget - total) * 100) / 100 : 0;

  const toggleCard = (id) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const swapCard = (card) => {
    if (!result) return;
    const origId = card._origId ?? card.scryfall_id;
    const headroom = result.budget - (total - card.usd);
    const swappedInIds = new Set(Object.values(swaps).map((s) => s.scryfall_id));
    const pool = result.alternates.filter(
      (a) => a.usd <= headroom + 1e-9 && !swappedInIds.has(a.scryfall_id) && a.scryfall_id !== origId
    );
    const pick = pool.find((a) => a.role === card.role) ?? pool[0];
    if (!pick) {
      setToast("No affordable swap available right now.");
      return;
    }
    setSwaps((prev) => ({ ...prev, [origId]: pick }));
    setToast(`Swapped in ${pick.name}.`);
  };

  const selectAll = () => setDeselected(new Set());
  const clearAll = () => setDeselected(new Set(visibleUpgrades.map((c) => c.scryfall_id)));

  // Heavy-hitter add/remove, strictly per card: each breaker callout gets its
  // own button, and the added card joins the grid as a normal tile (tappable
  // to remove, counted in the total even when it blows past the budget).
  const toggleBreaker = (b) => {
    const exists = addedBreakers.some((c) => c.scryfall_id === b.scryfall_id);
    if (exists) {
      setSwaps((sp) => {
        const n = { ...sp };
        delete n[b.scryfall_id];
        return n;
      });
      setDeselected((prev) => {
        const n = new Set(prev);
        n.delete(b.scryfall_id);
        return n;
      });
      setAddedBreakers((prev) => prev.filter((c) => c.scryfall_id !== b.scryfall_id));
      return;
    }
    setAddedBreakers((prev) => [
      ...prev,
      {
        scryfall_id: b.scryfall_id,
        name: b.expensiveName,
        usd: b.expensiveUsd,
        image_url: b.expensiveImage,
        role: b.role,
        roleLabel: b.roleLabel,
        score: null, // tile hides the Value badge; inclusion % is in the callout
        tier: "gold",
        cmdr_rate: b.expensiveRate / 100,
        breakerAdded: true,
      },
    ]);
  };

  const checkedLabel = result?.checkedAt
    ? new Date(result.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <>
      <div className="wrap">
        <header className="site-header">
          <img src="/logo-mark.png" alt="ManaCents" />
          <div>
            <div className="brand">Mana<span className="brand-cents">Cents</span></div>
          </div>
        </header>

        {view === "landing" && (
          <main className="landing">
            <h1>Commander upgrades that respect your wallet.</h1>
            <div className="fill-blank">
              <span>Upgrade my</span>
              <span className="cmdr-suggest" ref={suggestRef}>
                <input
                  type="text"
                  placeholder="Type Commander Name..."
                  value={cmdrInput}
                  onChange={(e) => { setCmdrInput(e.target.value); setSelectedCmdr(null); }}
                  onFocus={() => { if (suggestions.length) setShowSuggest(true); }}
                  aria-label="Commander name"
                />
                {showSuggest && (
                  <ul role="listbox">
                    {suggestions.length === 0 && <li><button type="button" disabled>No commanders found.</button></li>}
                    {suggestions.map((c) => (
                      <li key={c.slug}>
                        <button type="button" onClick={() => pickCommander(c)}>
                          <span>{c.name}</span>
                          <span className="decks">{c.deck_count?.toLocaleString?.() ?? ""} decks</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
              <span>deck with a budget of $</span>
              <input
                className="budget"
                inputMode="decimal"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                aria-label="Budget in dollars"
              />
            </div>
            <div className="mode-toggle" role="group" aria-label="Upgrade style">
              <button className={mode === "tuneup" ? "on" : ""} onClick={() => setMode("tuneup")}>
                Full Tune-Up<small>12–15 smart upgrades</small>
              </button>
              <button className={mode === "splash" ? "on" : ""} onClick={() => setMode("splash")}>
                Big Splash<small>4–6 powerhouse cards</small>
              </button>
            </div>
            <div>
              <button className="primary" onClick={() => submit(false)} disabled={loading} style={{ fontSize: "1.1rem", padding: "0.8rem 2rem" }}>
                {loading ? "Building your list…" : "Find my upgrades"}
              </button>
            </div>
            <p className="form-error" role="alert">{formError}</p>
          </main>
        )}

        {view === "results" && result && (
          <main>
            <div className="hero">
              <div className="hero-glow" aria-hidden="true">
                <img
                  src={`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(result.commander.name)}&format=image&version=large`}
                  alt=""
                />
              </div>
              <img
                className="hero-art"
                src={`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(result.commander.name)}&format=image&version=art_crop`}
                alt={`${result.commander.name} card art`}
                loading="lazy"
              />
              <div className="hero-body">
                <div className="kicker">Your upgrade plan</div>
                <h2>{result.commander.name}</h2>
                <div className="hero-controls">
                  <div className="mode-toggle small" role="group" aria-label="Upgrade style">
                    <button className={mode === "tuneup" ? "on" : ""} onClick={() => rebuild({ mode: "tuneup" })}>
                      Full Tune-Up
                    </button>
                    <button className={mode === "splash" ? "on" : ""} onClick={() => rebuild({ mode: "splash" })}>
                      Big Splash
                    </button>
                  </div>
                  <label className="hero-budget">
                    <span>$</span>
                    <input
                      inputMode="decimal"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      aria-label="Budget in dollars"
                    />
                    <button className="ghost" onClick={() => rebuild({})}>Update</button>
                  </label>
                  <button className="ghost" onClick={() => setView("landing")}>Change Commander</button>
                </div>
                <div
                  className="budget-bar"
                  role="progressbar"
                  aria-label="Budget used"
                  aria-valuenow={Math.round(Math.min(100, (total / result.budget) * 100))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`budget-fill${remaining < 0 ? " over" : ""}`}
                    style={{ width: `${Math.min(100, (total / result.budget) * 100)}%` }}
                  />
                </div>
                <div className="results-metrics">
                  <span>Total <strong>{money(total)}</strong> of {money(result.budget)}</span>
                  {remaining >= 0 ? (
                    <span>Budget left <strong>{money(remaining)}</strong></span>
                  ) : (
                    <span><strong>{money(-remaining)}</strong> over budget</span>
                  )}
                  <span>checked {checkedLabel}</span>
                </div>
              </div>
            </div>

            {result.skipped.length > 0 && !includeUniversal && (
              <div className="smart-banner merged">
                <p>
                  ✨ Tailored for your Commander. We skipped {result.skipped.length} basics you
                  probably already have (like {result.skipped.slice(0, 2).map((s) => s.name).join(" & ")}).
                </p>
                <div className="banner-actions">
                  <button onClick={() => setShowSkipped((v) => !v)}>{showSkipped ? "Hide them" : "Show them"}</button>
                  <button onClick={() => submit(true)} disabled={including}>
                    {including ? "Including…" : "Include them anyway"}
                  </button>
                </div>
                {showSkipped && (
                  <div className="skipped-list">
                    {result.skipped.map((s) => (
                      <span className="skipped-chip" key={s.scryfall_id}>
                        {s.image_url && <img src={s.image_url} alt="" loading="lazy" />}
                        {s.name} · {money(s.usd)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {visibleUpgrades.length === 0 ? (
              <p className="note">No list this round — no upgrades fit inside {money(result.budget)} right now. Try a higher budget or check back after prices refresh.</p>
            ) : (
              <>
                <div className="grid-tools">
                  <h2>Choose your upgrades</h2>
                  <div>
                    <button className="ghost" onClick={selectAll} style={{ marginRight: "0.5rem" }}>Select all</button>
                    <button className="ghost" onClick={clearAll}>Clear</button>
                  </div>
                  <span className="hint">Tap a card image to add or remove it.</span>
                </div>
                <div className="card-grid">
                  {visibleUpgrades.map((c) => (
                    <CardTile
                      key={c.scryfall_id}
                      card={c}
                      selected={!deselected.has(c.scryfall_id)}
                      onToggle={() => toggleCard(c.scryfall_id)}
                      onSwap={() => swapCard(c)}
                    />
                  ))}
                </div>
                {(result.budgetBreakers ?? []).map((b) => {
                  const added = addedBreakers.some((c) => c.scryfall_id === b.scryfall_id);
                  return (
                    <div className="breaker-callout" key={b.scryfall_id}>
                      <p>
                        💡 <strong>Popular Heavy Hitter: {b.expensiveName} ({money(b.expensiveUsd)})</strong> — Played
                        in {b.expensiveRate}% of decks, {b.expensiveName} alone
                        takes up a big chunk of a {money(result.budget)} budget. Your list includes{" "}
                        <strong>{b.partnerName} ({money(b.partnerUsd)})</strong>{" "}
                        to cover {b.roleLabel} while leaving room for the rest of your upgrades.
                      </p>
                      <button className={added ? "ghost" : "primary"} onClick={() => toggleBreaker(b)}>
                        {added ? "Added ✓ — tap to remove" : "Add anyway"}
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            <CheckoutBar
              commander={result.commander}
              budget={result.budget}
              cards={selectedCards}
              total={total}
              remaining={remaining}
              onToast={setToast}
            />
          </main>
        )}

        <Footer />
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
