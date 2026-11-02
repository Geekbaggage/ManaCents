import React, { useMemo, useState } from "react";
import combosData from "../data/combos.json";
import { money } from "../api.js";
import { manaPoolCardUrl, tcgplayerListText, tcgplayerMassEntryUrl } from "../affiliates.js";

const combos = combosData.combos;

export function getCombo(slug) {
  return combos.find((c) => c.slug === slug) ?? null;
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

export function CombosIndex({ onOpen }) {
  return (
    <div className="combos-page">
      <h1>Cheap Infinite Combos for Commander</h1>
      <p className="combos-sub">
        Every loop below is human-verified: real Oracle text, real cheapest-printing prices, and the honest
        catches. New combos land here after their reel ships.
      </p>
      <div className="combo-grid">
        {combos.map((c) => (
          <button key={c.slug} type="button" className="combo-card" onClick={() => onOpen(c.slug)}>
            <div className="combo-card-ep">Episode {c.episode}</div>
            <div className="combo-card-title">{c.title}</div>
            <div className="combo-card-total">
              {money(c.total_from_scratch)} <span>from scratch</span>
            </div>
            <div className="combo-card-outcome">{c.outcome}</div>
            <PreconBadge combo={c} />
          </button>
        ))}
      </div>
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
      <p className="combos-sub">{combo.outcome}</p>
      <PreconBadge combo={combo} />

      <h2>The pieces — {money(combo.total_from_scratch)} from scratch</h2>
      <table className="combo-pieces">
        <tbody>
          {combo.pieces.map((p) => (
            <tr key={p.name}>
              <td className="combo-piece-name">{p.name}</td>
              <td className="combo-piece-print">
                {p.printing} · {p.finish}
              </td>
              <td className="combo-piece-role">{p.role}</td>
              <td className="combo-piece-price">{money(p.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
