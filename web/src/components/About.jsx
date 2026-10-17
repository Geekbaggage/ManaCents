import React from "react";

export default function About({ onBack }) {
  return (
    <main className="about">
      <button type="button" className="ghost about-back" onClick={onBack}>
        ← Back to ManaCents
      </button>
      <div className="kicker">About</div>
      <h1>Geekbaggage</h1>
      <p>
        Geekbaggage is a tiny independent outfit making tools for Magic: The
        Gathering players. We&apos;re players first — the kind who spend Friday
        nights debating mana curves and whether that $30 staple is really worth it.
      </p>
      <h2>ManaCents</h2>
      <p>
        ManaCents is our first project: <em>Commander upgrades that respect your
        wallet.</em> Pick your commander and your budget, and it builds you an
        optimized upgrade list — cards that punch above their price for your
        commander, balanced across synergy, ramp, card draw, and removal, priced
        with real market data that refreshes nightly.
      </p>
      <p>More tools are on the way.</p>
      <h2>Say hi</h2>
      <p>
        <a href="mailto:hello@manacents.com">hello@manacents.com</a>
      </p>
    </main>
  );
}
