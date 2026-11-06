import React, { useState, useEffect } from "react";
import { money } from "../api.js";
import { manaPoolCardUrl } from "../affiliates.js";
import { trackAffiliateClick } from "../analytics.js";
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

function finishLabel(printing) {
  // "PLST #DMU-243 (usd)" → "PLST #DMU-243 · nonfoil"
  if (!printing) return "";
  return printing
    .replace(" (usd_foil)", " · foil")
    .replace(" (usd_etched)", " · etched")
    .replace(" (usd)", " · nonfoil");
}

function conditionalCopy(l) {
  // Design B: the exact per-verge copy, derived from the land's
  // conditionalColors (never hardcoded). "Second color only if you control
  // a Plains or Island." / "...an Island or Swamp."
  const cc = l.conditionalColors;
  if (!cc || !cc.length) return "";
  const dep = cc[0].dependency;
  if (!dep || !dep.types || !dep.types.length) return "";
  const types = dep.types.join(" or ");
  const article = /^[AEIOU]/.test(dep.types[0]) ? "an" : "a";
  return `Second color only if you control ${article} ${types}.`;
}

function etbModeCopy(l) {
  // Design A: the mode the solver assumed for this land in this request.
  // The paid mode is an explicit scoring assumption, not a fact about what
  // the player will do — the label says so.
  if (l.assumedEtbMode === "pay_life") {
    return "Enters untapped — pay 2 life (assumed for scoring)";
  }
  if (l.assumedEtbMode === "tapped") {
    return "Enters tapped";
  }
  return "";
}

function LandGallery() {
  const [lands, setLands] = useState(null);
  const [held, setHeld] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch("/api/manabase?list=all")
      .then((r) => r.json())
      .then((d) => { setLands(d.lands); setHeld(d.meta?.heldExcluded ?? []); })
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
                        <span className="mb-land-served">served</span>
                        <span className="mb-land-price">{money(l.price)}</span>
                        {l.lifeCost > 0 && (
                          <span className="mb-land-life">−{l.lifeCost} ♥</span>
                        )}
                        {l.conditional && <span className="mb-land-cond">conditional</span>}
                      </div>
                      {conditionalCopy(l) && (
                        <div className="mb-land-note">{conditionalCopy(l)}</div>
                      )}
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
      {held.length > 0 && (
        <p className="combos-sub">
          Held from optimization (not served): {held.join(", ")} — true
          typed fetchlands, no reviewed evaluator yet. The pilot catalog
          covers 43 lands, not every Commander-legal land.
        </p>
      )}
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
      </div>

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
              {Object.entries(result.perColor).map(([c, v]) => {
                // A color is met ONLY when the guaranteed shortfall is 0.
                // Conditional-only (scored shortfall 0, guaranteed
                // shortfall > 0) is NOT met — it reads as conditional, with
                // no checkmark. Defensive fallback: older responses without
                // guaranteed_shortfall use the scored shortfall.
                const gs = v.guaranteed_shortfall ?? v.shortfall;
                const state = gs === 0 ? "met" : (v.conditional_only ? "cond" : "unmet");
                return (
                  <span key={c} className={`mb-short ${state}`}>
                    <img src={PIP_IMG[c] ?? PIP_IMG.C} alt={COLOR_NAMES[c] ?? c} width={16} height={16} draggable="false" /> {v.qualifying}/{v.target}
                    {state === "met" ? " ✓"
                      : state === "cond" ? " · conditional only"
                      : ` (short ${v.shortfall})`}
                  </span>
                );
              })}
            </div>
          )}
          {result.perColor && Object.values(result.perColor).some((v) => v.conditional_only) && (
            <p className="combos-sub">
              Conditional only: {Object.entries(result.perColor)
                .filter(([, v]) => v.conditional_only)
                .map(([c, v]) => {
                  const src = (v.conditional_sources || [])
                    .map((s) => `${s.land} needs ${s.dependency_types.join(" or ")}` +
                      (s.dependency_in_package ? " (in this package)" : " (not in this package)"))
                    .join("; ");
                  return `${COLOR_NAMES[c]} — ${src || "verge dependency unverified"}`;
                })
                .join(" · ")}. The solver cannot verify from your colors
              alone that the dependency is satisfied, so the color is not
              shown as met.
            </p>
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
                {etbModeCopy(l) && (
                  <div className="mb-land-note">{etbModeCopy(l)}</div>
                )}
                {conditionalCopy(l) && (
                  <div className="mb-land-note">{conditionalCopy(l)}</div>
                )}
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
            priorities and budget under the stated assumptions. Pilot catalog:
            43 lands (a small subset of all Commander-legal lands, not a
            complete catalog), scoring policy v1, bond lands resolved for 3
            opponents. Shock lands are scored in pay_life mode (untapped, pay
            2 life) when they cover an early-priority color, else tapped
            mode — the paid mode is an explicit scoring assumption, not a
            promise about the entry choice. A color shown as conditional only
            is met only if the verge dependency (for example, controlling a
            Plains or Island) is satisfied — the solver cannot verify that
            from your colors alone. Prices are a {result.meta?.priceSnapshot || "2026-11-04"} snapshot
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
