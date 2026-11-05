import React from "react";

export default function Privacy({ onBack }) {
  return (
    <main className="about">
      <button type="button" className="ghost about-back" onClick={onBack}>← Back</button>
      <h1>Privacy Notice</h1>
      <p><em>Last updated: November 4, 2026</em></p>

      <h2>What we collect</h2>
      <p>
        When you use ManaCents, we record anonymous usage events: which pages
        you visit (home, combos, builder, etc.) and which buy links you tap.
        That's it.
      </p>

      <h2>What we don't collect</h2>
      <p>
        No cookies. No account data. No IP addresses stored. No device
        fingerprints. No cross-site tracking. We can't identify you from
        this data, and we don't try.
      </p>

      <h2>Why we collect it</h2>
      <p>
        To understand which parts of the site people actually use, so we can
        make ManaCents better. We also track which affiliate links get tapped
        so we know our partner integrations are working.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Raw events are automatically deleted after 30 days. We don't keep
        per-visitor histories beyond that.
      </p>

      <h2>Who sees it</h2>
      <p>
        Only the ManaCents team, in aggregate (totals and trends, not
        individual browsing). We don't sell data or share it with third
        parties beyond our affiliate partners' own click tracking when you
        tap a buy link (that's their site, their policy).
      </p>

      <h2>Questions</h2>
      <p>
        <a href="mailto:hello@manacents.com">hello@manacents.com</a>
      </p>
    </main>
  );
}
