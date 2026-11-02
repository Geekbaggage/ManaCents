import React, { useMemo, useState } from "react";
import combosData from "../data/combos.json";
import { money } from "../api.js";
import { manaPoolCardUrl, tcgplayerListText, tcgplayerMassEntryUrl } from "../affiliates.js";

const combos = combosData.combos;

const COLOR_PIPS = [
  { id: "W", label: "White", bg: "#f8f6d8", fg: "#1e293b" },
  { id: "U", label: "Blue", bg: "#0e68ab", fg: "#f8fafc" },
  { id: "B", label: "Black", bg: "#3b2f2f", fg: "#f8fafc" },
  { id: "R", label: "Red", bg: "#d3202a", fg: "#f8fafc" },
  { id: "G", label: "Green", bg: "#00733e", fg: "#f8fafc" },
];

export function getCombo(slug) {
  return combos.find((c) => c.slug === slug) ?? null;
}

const PIP_BG = { W: "#f8f6d8", U: "#0e68ab", B: "#3b2f2f", R: "#d3202a", G: "#00733e" };

function ciGradient(identity) {
  const ids = identity.length > 0 ? identity : ["C"];
  const bg = (id) => PIP_BG[id] ?? "#475569";
  const segs = ids.map((id, i) => `${bg(id)} ${(i / ids.length) * 100}%, ${bg(id)} ${((i + 1) / ids.length) * 100}%`);
  return `linear-gradient(90deg, ${segs.join(", ")})`;
}

export function ColorPips({ identity, size = 26 }) {
  if (!identity || identity.length === 0) return <span className="combo-pips" title="Colorless">◯</span>;
  return (
    <span className="combo-pips" aria-label={`Color identity ${identity.join("")}`}>
      {identity.map((pip) => {
        const def = COLOR_PIPS.find((p) => p.id === pip);
        return (
          <span
            key={pip}
            className="combo-pip"
            style={{ background: def.bg, color: def.fg, width: size, height: size, fontSize: size * 0.55 }}
          >
            {pip}
          </span>
        );
      })}
    </span>
  );
}

function PreconBadge({ combo }) {
  if (!combo.precon) return null;
  const label =
    combo.precon.incremental_cost === 0
      ? `$0 for an unchanged ${combo.precon.name} owner`
      : `${money(combo.precon.incremental_cost)} add for a ${combo.precon.name} owner`;
  return (
    <span className="combo-precon-badge" title={combo.precon.detail}>
      🎯 {label}
    </span>
  );
}

function TypePill({ combo }) {
  const label = combo.combo_type === "infinite" ? "∞ Infinite" : "Non-infinite";
  return <span className={`combo-type-pill ${combo.combo_type}`}>{label}</span>;
}

// Homepage discovery panel — compact, subordinate to the builder.
export function CombosTeaser({ onOpen }) {
  return (
    <section className="combos-teaser" aria-label="Commander combos">
      <div className="combos-teaser-text">
        <h2>⚡ Commander Combos</h2>
        <p>Discover infinite loops and clever interactions that fit your colors. Verified cards, clear steps, estimated costs.</p>
      </div>
      <button type="button" className="btn-buy" onClick={onOpen}>
        Find combos
      </button>
    </section>
  );
}

function matchesQuery(c, q) {
  const hay = [c.title, c.outcome, c.precon?.name ?? "", ...c.pieces.map((p) => p.name)].join(" ").toLowerCase();
  return hay.includes(q);
}

export function CombosIndex({ onOpen }) {
  const [query, setQuery] = useState("");
  const [typeTab, setTypeTab] = useState("all");
  const [colors, setColors] = useState(new Set());
  const toggleColor = (id) => {
    setColors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(
    () =>
      combos.filter((c) => {
        if (typeTab !== "all" && c.combo_type !== typeTab) return false;
        if (colors.size > 0 && !c.color_identity.some((ci) => colors.has(ci))) return false;
        const q = query.trim().toLowerCase();
        if (q && !matchesQuery(c, q)) return false;
        return true;
      }),
    [query, typeTab, colors]
  );
  const hasFilters = query.trim() !== "" || typeTab !== "all" || colors.size > 0;
  const reset = () => {
    setQuery("");
    setTypeTab("all");
    setColors(new Set());
  };

  return (
    <div className="combos-page">
      <h1>Commander Combos</h1>
      <p className="combos-sub">
        A growing library of human-verified Commander combos — infinite loops and clever interactions.
        Every entry: real Oracle text, cheapest-printing prices, and the honest catches.
      </p>

      <div className="combo-filters">
        <input
          type="search"
          className="combo-search"
          placeholder="Search card or combo name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search combos by card or combo name"
        />
        <div className="combo-type-tabs" role="group" aria-label="Filter by combo type">
          {[
            ["all", "All"],
            ["infinite", "∞ Infinite"],
            ["non-infinite", "Non-infinite"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={typeTab === id ? "on" : ""}
              onClick={() => setTypeTab(id)}
              aria-pressed={typeTab === id}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="combo-color-filter" role="group" aria-label="Show combos that fit your deck colors">
          <span className="combo-color-label">Includes color:</span>
          {COLOR_PIPS.map((pip) => (
            <button
              key={pip.id}
              type="button"
              className={colors.has(pip.id) ? "pip on" : "pip"}
              style={{ "--pip-bg": pip.bg, "--pip-fg": pip.fg }}
              onClick={() => toggleColor(pip.id)}
              aria-pressed={colors.has(pip.id)}
              aria-label={`${pip.label} ${colors.has(pip.id) ? "on" : "off"}`}
              title={pip.label}
            >
              {pip.id}
            </button>
          ))}
        </div>
      </div>

      <p className="combo-result-count" role="status">
        {filtered.length} matching {filtered.length === 1 ? "combo" : "combos"}
        {hasFilters && (
          <button type="button" className="combo-reset" onClick={reset}>
            Reset filters
          </button>
        )}
      </p>

      {filtered.length === 0 ? (
        <p className="combo-empty">
          No matching verified combos yet.{" "}
          {hasFilters && (
            <button type="button" className="combo-reset" onClick={reset}>
              Reset filters
            </button>
          )}
        </p>
      ) : (
        <div className="combo-grid">
          {filtered.map((c) => (
            <button key={c.slug} type="button" className="combo-card" onClick={() => onOpen(c.slug)}>
              <span
                className="combo-card-ci-bar"
                style={{ background: ciGradient(c.color_identity) }}
                aria-hidden="true"
                title={`Colors: ${c.color_identity.join("") || "Colorless"}`}
              />
              <div className="combo-card-art">
                {c.pieces.slice(0, 3).map((p, i) => (
                  <img
                    key={p.name}
                    src={p.art}
                    alt=""
                    loading="lazy"
                    style={{ transform: `rotate(${(i - (c.pieces.length - 1) / 2) * 7}deg)` }}
                  />
                ))}
                {c.pieces.length > 1 && <span className="combo-card-plus">+</span>}
              </div>
              <div className="combo-card-ep">Episode {c.episode}</div>
              <div className="combo-card-title">{c.title}</div>
              <div className="combo-card-meta">
                <ColorPips identity={c.color_identity} />
                <TypePill combo={c} />
              </div>
              <div className="combo-card-outcome">{c.outcome}</div>
              <div className="combo-card-foot">
                <span className="combo-card-count">
                  {c.pieces.length} {c.pieces.length === 1 ? "card" : "cards"}
                </span>
                <span className="combo-card-total">{money(c.total_from_scratch)}</span>
              </div>
              <PreconBadge combo={c} />
              <span className="combo-card-cta">See how it works →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuyBox({ combo }) {
  const [copied, setCopied] = useState(false);
  const listText = useMemo(() => tcgplayerListText(combo.pieces.map((p) => ({ name: p.name }))), [combo]);
  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(listText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="combo-buybox">
      <h3>Get the pieces</h3>
      <div className="combo-buy-actions">
        {combo.pieces.map((p) => (
          <a key={p.name} className="btn-buy" href={manaPoolCardUrl(p.name)} target="_blank" rel="noopener noreferrer">
            {p.name} — {money(p.price)}
          </a>
        ))}
      </div>
      <div className="combo-buy-actions">
        <button type="button" className="btn-copy" onClick={copyList}>
          {copied ? "Copied!" : "Copy list for TCGplayer"}
        </button>
        <a className="btn-buy" href={tcgplayerMassEntryUrl()} target="_blank" rel="noopener noreferrer">
          Open TCGplayer mass entry
        </a>
      </div>
      <p className="combo-disclosure">
        Prices checked {combo.verified_date}; live prices may differ. We may earn a commission if you purchase
        through these links, at no extra cost to you.
      </p>
    </div>
  );
}

export function ComboDetail({ slug, onBack }) {
  const combo = getCombo(slug);
  if (!combo) {
    return (
      <div className="combos-page">
        <h1>Combo not found</h1>
        <p className="combos-sub">That combo isn't published yet.</p>
        <button type="button" className="btn-copy" onClick={onBack}>
          Back to all combos
        </button>
      </div>
    );
  }
  return (
    <div className="combos-page combo-detail">
      <button type="button" className="combo-back" onClick={onBack}>
        ← All combos
      </button>
      <div className="combo-card-ep">Episode {combo.episode}</div>
      <h1>{combo.title}</h1>
      <div className="combo-detail-meta">
        <ColorPips identity={combo.color_identity} size={26} />
        <TypePill combo={combo} />
      </div>
      <PreconBadge combo={combo} />

      <h2>The pieces — {money(combo.total_from_scratch)} from scratch</h2>
      <div className="combo-equation" aria-label={`${combo.title}: ${combo.outcome}`}>
        {combo.pieces.map((p, i) => (
          <React.Fragment key={p.name}>
            {i > 0 && <span className="combo-eq-plus" aria-hidden="true">+</span>}
            <div className="combo-eq-card">
              {p.art && <img src={p.art} alt={`${p.name} card art`} loading="lazy" />}
              <div className="combo-eq-name">{p.name}</div>
              <div className="combo-eq-print">
                {p.printing} · {p.finish}
              </div>
              <div className="combo-eq-price">{money(p.price)}</div>
              <a className="btn-copy combo-eq-buy" href={manaPoolCardUrl(p.name)} target="_blank" rel="noopener noreferrer">
                Buy this card
              </a>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="combo-eq-outcome">= {combo.outcome}</div>

      {combo.precon && (
        <p className="combo-precon-note">
          <strong>{combo.precon.name}</strong> ({combo.precon.detail}) ships{" "}
          {combo.precon.pieces_included.join(", ")}
          {combo.precon.incremental_cost === 0
            ? " — $0 if you own it unchanged."
            : ` — add ${combo.precon.pieces_not_included?.join(", ") || "the rest"} for ${money(
                combo.precon.incremental_cost
              )}.`}
          {combo.precon.incremental_note ? ` ${combo.precon.incremental_note}` : ""}
        </p>
      )}
      {combo.precon_note && <p className="combo-precon-note">{combo.precon_note}</p>}

      <h2>The loop</h2>
      <ol className="combo-steps">
        {combo.loop_steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>

      <h2>What you need first</h2>
      <ul className="combo-list">
        {combo.prerequisites.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      <h2>Honest catches</h2>
      <ul className="combo-list">
        {combo.caveats.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      {combo.reel_url && (
        <p>
          <a href={combo.reel_url} target="_blank" rel="noopener noreferrer">
            Watch the reel on Instagram →
          </a>
        </p>
      )}

      <BuyBox combo={combo} />
    </div>
  );
}
