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
        <div className="legal">
          ManaCents is unofficial Fan Content permitted under the Wizards of the Coast Fan
          Content Policy. Not approved/endorsed by Wizards. Portions of the materials used
          are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        </div>
        <div className="legal">
          Affiliate Disclosure: ManaCents participates in affiliate programs including
          TCGplayer, Card Kingdom, and Mana Pool. Buying cards through links on this site
          supports ManaCents at no extra cost to you.
        </div>
        <div className="credit">by Geekbaggage</div>
      </footer>
    </>
  );
}
