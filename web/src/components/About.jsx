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
        Geekbaggage is a tiny indie outfit. Made by women, for nerds, by nerds.
      </p>
      <h2>ManaCents</h2>
      <p>
        ManaCents is our first web project: <em>Commander upgrades that respect
        your wallet.</em> Pick your commander and your budget, get an optimized
        upgrade list. Cards that punch above their price — synergy, ramp, card
        draw, removal — priced with real market data, refreshed nightly.
      </p>
      <p>
        Built after years of playing Magic with friends, the way it&apos;s meant
        to be played.
      </p>
      <p className="dedication">
        <em>
          In memory of Mortise &ldquo;Tony&rdquo; Addams — my best friend, who
          taught me Magic. He is gone, but the magic he shared stayed.
        </em>
      </p>
      <h2>Say hi</h2>
      <p>
        <a href="mailto:hello@manacents.com">hello@manacents.com</a>
      </p>
    </main>
  );
}
