import React, { useState } from "react";
import { money } from "../api.js";
import { manaPoolCardUrl } from "../affiliates.js";
import { trackAffiliateClick } from "../analytics.js";

const COLORS = ["W", "U", "B", "R", "G"];
const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const PIP_IMG = {
  W: "/mana/white-v2.png",
  U: "/mana/blue-v2.png",
  B: "/mana/black-v2.png",
  R: "/mana/red-v2.png",
  G: "/mana/green-v2.png",
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

export function ManaBase() {
  const [colors, setColors] = useState([]);
  const [priorities, setPriorities] = useState({});
  const [budget, setBudget] = useState(50);
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
    if (colors.length === 0) {
      setError("Pick at least one color first.");
      return;
    }
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Solver failed");
      setResult(data);
    } catch (e) {
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
        Pick your colors, set priorities, name a budget — get the optimal
        land package. Prices are cheapest printings as of{" "}
        {result?.meta?.priceSnapshot || "2026-11-04"}.
      </p>

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

      {colors.length > 0 && (
        <>
          <h2>2. Budget &amp; size</h2>
          <div className="mb-controls">
            <label>
              Budget: <strong>{money(budget)}</strong>
              <input
                type="range" min="5" max="500" step="5" value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </label>
            <label>
              Max lands: <strong>{slots}</strong>
              <input
                type="range" min="1" max="20" step="1" value={slots}
                onChange={(e) => setSlots(Number(e.target.value))}
              />
            </label>
          </div>

          <button type="button" className="mb-run" onClick={run} disabled={loading}>
            {loading ? "Solving…" : "Find my lands 💎"}
          </button>
        </>
      )}

      {error && <p className="mb-error">{error}</p>}

      {result && (
        <div className="mb-results">
          <h2>
            Your package — {money(result.score.priceDollars)}
            <span className="mb-status">{result.stats.status}</span>
          </h2>
          <p className="combos-sub">
            {result.lands.length} lands · penalty {result.score.penalty} ·
            {result.stats.nodesVisited.toLocaleString()} nodes searched
          </p>
          <div className="mb-lands">
            {result.lands.map((l) => (
              <div key={l.name} className="mb-land">
                <div className="mb-land-name">{l.name}</div>
                <div className="mb-land-meta">
                  <span className="mb-land-price">{money(l.price)}</span>
                  {l.lifeCost > 0 && (
                    <span className="mb-land-life" title="Expected life cost per game">
                      −{l.lifeCost} ♥
                    </span>
                  )}
                  {l.conditional && <span className="mb-land-cond">conditional</span>}
                </div>
                <div className="mb-land-print">{l.pricePrinting}</div>
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
            Prototype: 43 lands, scoring policy v1, bond lands assume 3 opponents.
            Prices are a snapshot — verify at checkout. Not financial advice.
          </p>
        </div>
      )}
    </div>
  );
}
