import React from "react";

export default function Footer() {
  return (
    <>
      <section className="method">
        <div className="kicker">How the math works</div>
        <h2>Proven value, balanced deck.</h2>
        <p>
          ManaCents rewards cards that are unusually strong for your commander, then balances
          commander synergy, extra mana, card draw, and removal. Widely played color-eligible
          staples are skipped by default. Every total uses Scryfall&apos;s USD price, with a
          $0.10 floor. Prices refresh nightly.
        </p>
      </section>
      <footer className="site-footer">
        <div>
          Fan-made tool. Not affiliated with or endorsed by Wizards of the Coast.
          Magic: The Gathering is a trademark of Wizards of the Coast LLC.
        </div>
        <div className="credit">by Geekbaggage</div>
      </footer>
    </>
  );
}
