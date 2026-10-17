import React from "react";

export default function Footer({ onAbout }) {
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
          Questions or feedback? <a href="mailto:hello@manacents.com">hello@manacents.com</a>
          {" · "}
          <button type="button" className="linklike" onClick={onAbout}>About</button>
        </div>
        <div className="credit">by Geekbaggage</div>
        <div className="legal memorial">In memory of Mortise &ldquo;Tony&rdquo; Addams</div>
      </footer>
    </>
  );
}
