import React, { useState } from "react";
import { money } from "../api.js";
import {
  AFFILIATE_CODES,
  tcgplayerListText,
  tcgplayerMassEntryUrl,
  cardKingdomSearchUrl,
  manaPoolCardUrl,
  manaPoolDeckUrl,
  cardTraderUrl,
  SLEEVES_URL,
  isEuLocale,
} from "../affiliates.js";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* noop */ }
    document.body.removeChild(ta);
    return ok;
  }
}

function decklistText(cards, budget, withFooter = true) {
  const lines = cards.map((c) => `1 ${c.name}`);
  if (withFooter) lines.push(`// Upgraded with ManaCents on a ${money(budget)} budget`);
  return lines.join("\n");
}

function shareText(commander, budget, cards, total) {
  const avg = cards.length
    ? Math.round(cards.reduce((s, c) => s + (c.score || 0), 0) / cards.length)
    : 0;
  const lines = [
    `ManaCents upgrade receipt for ${commander.name}`,
    `Budget ${money(budget)} · ${cards.length} upgrades · ${money(total)} total`,
    `Average ManaCents Score: ${avg}`,
    "",
    ...cards.map((c) => `• ${c.name} — ${c.score} Value — ${money(c.usd)}`),
  ];
  return lines.join("\n");
}

async function buildReceiptImage(commander, budget, cards, total) {
  const W = 640;
  const rowH = 44;
  const H = Math.min(140 + cards.length * rowH + 90, 1600);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#D4AF37";
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.fillText("ManaCents", 32, 52);
  ctx.fillStyle = "#94A3B8";
  ctx.font = "400 19px system-ui, sans-serif";
  ctx.fillText(`${commander.name} · Budget ${money(budget)}`, 32, 84);
  ctx.fillStyle = "#F8FAFC";
  ctx.font = "700 21px system-ui, sans-serif";
  ctx.fillText(`${cards.length} upgrades · ${money(total)} total`, 32, 118);
  let y = 118;
  ctx.font = "400 19px system-ui, sans-serif";
  for (const c of cards.slice(0, 30)) {
    y += rowH;
    if (y > H - 70) break;
    ctx.fillStyle = "#F8FAFC";
    ctx.fillText(c.name.length > 34 ? c.name.slice(0, 33) + "…" : c.name, 32, y);
    ctx.fillStyle = "#D4AF37";
    const right = `${c.score} Value · ${money(c.usd)}`;
    ctx.fillText(right, W - 32 - ctx.measureText(right).width, y);
  }
  ctx.fillStyle = "#94A3B8";
  ctx.font = "400 16px system-ui, sans-serif";
  const footer = "Commander upgrades that respect your wallet · by Geekbaggage";
  ctx.fillText(footer, W - 32 - ctx.measureText(footer).width, H - 28);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div style={{ marginTop: "1rem", textAlign: "right" }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutBar({ commander, budget, cards, total, remaining, onToast }) {
  const [modal, setModal] = useState(null); // 'ck' | 'mp' | 'ct' | 'share'
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [buildingReceipt, setBuildingReceipt] = useState(false);
  const eu = isEuLocale();

  const doCopy = async (text, msg) => {
    const ok = await copyText(text);
    onToast(ok ? msg : "Copy failed — your browser blocked it.");
  };

  const buyTcgplayer = async () => {
    await doCopy(tcgplayerListText(cards), "List copied — paste it into TCGplayer's mass entry.");
    window.open(tcgplayerMassEntryUrl(), "_blank", "noreferrer");
  };

  const generateReceipt = async () => {
    setBuildingReceipt(true);
    try {
      const blob = await buildReceiptImage(commander, budget, cards, total);
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
      setReceiptUrl(URL.createObjectURL(blob));
    } finally {
      setBuildingReceipt(false);
    }
  };

  const shareImage = async () => {
    if (!receiptUrl) return;
    try {
      const res = await fetch(receiptUrl);
      const blob = await res.blob();
      const file = new File([blob], "manacents-receipt.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "ManaCents upgrade receipt" });
      } else {
        onToast("Sharing is not supported here — use Download PNG instead.");
      }
    } catch { /* user cancelled */ }
  };

  return (
    <>
      <div className="checkout-bar">
        <div className="wrap">
          {total < 35 && cards.length > 0 && AFFILIATE_CODES.AMAZON_TAG && (
            <p className="upsell">
              Need {money(35 - total)} more for free shipping?{" "}
              <a href={SLEEVES_URL()} target="_blank" rel="noopener sponsored">Add 100x Dragon Shield Matte Sleeves</a>
            </p>
          )}
          <div className="row">
            <div className="totals">
              {cards.length} Upgrades Selected • Total: {money(total)}
              {remaining >= 0 ? (
                <small>Leaves ~{money(remaining)} for shipping</small>
              ) : (
                <small>{money(-remaining)} over target budget</small>
              )}
            </div>
            <div className="actions">
              {eu ? (
                <button className="primary" onClick={buyTcgplayer} disabled={!cards.length}>Buy All on TCGplayer</button>
              ) : (
                <>
                  <a
                    className={`button primary${!cards.length ? " disabled" : ""}`}
                    href={cards.length ? manaPoolDeckUrl(cards) : undefined}
                    target="_blank"
                    rel="noopener sponsored"
                    aria-disabled={!cards.length}
                  >
                    Buy All on Mana Pool
                  </a>
                  <button onClick={buyTcgplayer} disabled={!cards.length}>Buy All on TCGplayer</button>
                </>
              )}
              <button onClick={() => setModal("ck")} disabled={!cards.length}>Card Kingdom</button>
              {eu
                ? <button onClick={() => setModal("ct")} disabled={!cards.length}>CardTrader</button>
                : <button onClick={() => setModal("mp")} disabled={!cards.length}>Mana Pool (By Card)</button>}
              <button onClick={() => setModal("share")}>Share &amp; export</button>
            </div>
          </div>
          <p className="tcg-note">TCGplayer can&apos;t auto-fill your cart. We&apos;ll copy your list, then you paste it into TCGplayer&apos;s mass entry and tap Add to Cart.</p>
          <p className="ftc">Prices updated daily. Buying through these links supports ManaCents at no extra cost to you.</p>
        </div>
      </div>

      {modal === "ck" && (
        <Modal title="Card Kingdom products" onClose={() => setModal(null)}>
          <p className="note">Card Kingdom has no public mass-add link. Open each product below, or copy the list for reference.</p>
          {cards.map((c) => (
            <div className="vendor-row" key={c.scryfall_id}>
              <span>{c.name} · {money(c.usd)}</span>
              <a className="button" href={cardKingdomSearchUrl(c.name)} target="_blank" rel="noopener sponsored">
                Open on Card Kingdom ↗
              </a>
            </div>
          ))}
          <div style={{ marginTop: "0.8rem" }}>
            <button onClick={() => doCopy(decklistText(cards, budget, false), "List copied")}>Copy list</button>
          </div>
        </Modal>
      )}

      {modal === "mp" && (
        <Modal title="Mana Pool products" onClose={() => setModal(null)}>
          <p className="note">Buy the whole list at once — Mana Pool optimizes sellers and shipping at checkout — or open individual cards below.</p>
          <div style={{ marginBottom: "0.8rem" }}>
            <a className="button primary" href={manaPoolDeckUrl(cards)} target="_blank" rel="noopener sponsored">
              Buy All on Mana Pool
            </a>
          </div>
          {cards.map((c) => (
            <div className="vendor-row" key={c.scryfall_id}>
              <span>{c.name} · {money(c.usd)}</span>
              <a className="button" href={manaPoolCardUrl(c.name)} target="_blank" rel="noopener sponsored">
                Open on Mana Pool ↗
              </a>
            </div>
          ))}
          <div style={{ marginTop: "0.8rem" }}>
            <button onClick={() => doCopy(decklistText(cards, budget, false), "List copied")}>Copy list</button>
          </div>
        </Modal>
      )}

      {modal === "ct" && (
        <Modal title="CardTrader marketplace" onClose={() => setModal(null)}>
          <p className="note">Copy the list, then use CardTrader's marketplace or wishlist import for your EU/UK order.</p>
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <button onClick={() => doCopy(decklistText(cards, budget, false), "List copied")}>Copy list</button>
            <a className="button" href={cardTraderUrl()} target="_blank" rel="noopener sponsored">
              Open CardTrader
            </a>
          </div>
        </Modal>
      )}

      {modal === "share" && (
        <Modal title="Share and export" onClose={() => setModal(null)}>
          <p className="note">Includes the ManaCents budget footer.</p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button onClick={() => doCopy(decklistText(cards, budget), "Moxfield list copied")}>Copy for Moxfield</button>
            <button onClick={() => doCopy(decklistText(cards, budget), "Archidekt list copied")}>Copy for Archidekt</button>
            <button onClick={() => doCopy(shareText(commander, budget, cards, total), "Share text copied")}>Copy share text</button>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <button onClick={generateReceipt} disabled={buildingReceipt}>
              {buildingReceipt ? "Building receipt…" : "Generate receipt image"}
            </button>
          </div>
          {receiptUrl && (
            <div>
              <img className="receipt-preview" src={receiptUrl} alt="ManaCents upgrade receipt preview" />
              <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem", flexWrap: "wrap" }}>
                <a className="button" href={receiptUrl} download="manacents-receipt.png">Download PNG</a>
                <button onClick={shareImage}>Share image</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
