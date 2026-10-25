import React, { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { searchCommanders, fetchAllCommanders, fetchUpgrades, money, previewCommanderRequest, confirmCommanderRequest, voteCommander, checkRequestStatus } from "./api.js";
import CheckoutBar from "./components/CheckoutBar.jsx";
import About from "./components/About.jsx";
import Footer from "./components/Footer.jsx";

// Color-identity filter chips. Exact-match semantics: a commander shows only
// when its color identity is exactly the selected pips (so W+U+R finds Jeskai
// commanders, not every mono-colored deck that happens to fit). "C" matches
// colorless (empty identity) only, and only when selected alone. With no chips
// selected there is no filtering.
const COLOR_PIPS = [
  { id: "W", label: "White", bg: "#f8f6d8", fg: "#1e293b" },
  { id: "U", label: "Blue", bg: "#0e68ab", fg: "#f8fafc" },
  { id: "B", label: "Black", bg: "#3b2f2f", fg: "#f8fafc" },
  { id: "R", label: "Red", bg: "#d3202a", fg: "#f8fafc" },
  { id: "G", label: "Green", bg: "#00733e", fg: "#f8fafc" },
  { id: "C", label: "Colorless", bg: "#94a3b8", fg: "#1e293b" },
];
function matchesColorFilter(commander, selected) {
  if (selected.size === 0) return true;
  const pips = (commander.color_identity ?? "").replace(/[^WUBRG]/g, "");
  if (pips.length === 0) return selected.has("C") && selected.size === 1;
  if (selected.has("C")) return false;
  return pips.length === selected.size && [...pips].every((p) => selected.has(p));
}

// localStorage watchlist: requested oracle_ids the user wants to hear about.
// On app load we check whether any transitioned to live and toast.
const WATCH_KEY = "manacents-watchlist";
function loadWatchlist() {
  try {
    return JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  } catch {
    // Private mode etc. — watchlist is best-effort.
  }
}
function addToWatchlist(oracle_id, slug, name) {
  if (!oracle_id) return;
  const list = loadWatchlist();
  if (!list.some((w) => w.oracle_id === oracle_id)) {
    list.push({ oracle_id, slug, name, seen: false });
    saveWatchlist(list);
  }
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function FeedbackWidget({ commander, budget, mode, cards }) {
  const [rating, setRating] = useState(null);
  const [category, setCategory] = useState("missing_card");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const submitFeedback = async () => {
    if (!rating || sending) return;
    setSending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commander: commander.name,
          budget,
          mode,
          rating,
          category,
          comment,
          cards_shown: cards.map((c) => c.name).join(", "),
        }),
      });
      if (!res.ok) throw new Error("bad status");
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="feedback-widget">
        <p>Thanks — your feedback helps ManaCents get smarter. 💚</p>
      </div>
    );
  }

  return (
    <div className="feedback-widget">
      <p><strong>Was this list helpful?</strong></p>
      <div className="feedback-row">
        <button
          type="button"
          className={rating === "up" ? "on" : ""}
          onClick={() => setRating("up")}
          aria-label="Thumbs up"
        >👍</button>
        <button
          type="button"
          className={rating === "down" ? "on" : ""}
          onClick={() => setRating("down")}
          aria-label="Thumbs down"
        >👎</button>
        {rating && (
          <>
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Feedback category">
              <option value="missing_card">Missing card</option>
              <option value="wrong_role">Wrong role label</option>
              <option value="price_issue">Price looks off</option>
              <option value="other">Other</option>
            </select>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us more (optional)"
              maxLength={1000}
              aria-label="Feedback comment"
            />
            <button type="button" className="primary" onClick={submitFeedback} disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </button>
          </>
        )}
      </div>
      {failed && <p className="form-error">Couldn't send — try again in a moment.</p>}
    </div>
  );
}

function CardTile({ card, selected, onToggle, onSwap, canHover, onHoverCard, onHoverMove, onZoomCard }) {
  return (
    <div className={`card-tile${selected ? " selected" : ""}`}>
      <div className="imgwrap" onClick={onToggle} role="button" tabIndex={0}
        aria-label={`${selected ? "Remove" : "Add"} ${card.name}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
        onMouseEnter={() => { if (canHover && card.image_url) onHoverCard(card); }}
        onMouseLeave={() => { if (canHover) onHoverCard(null); }}
        onMouseMove={(e) => { if (canHover) onHoverMove(e.clientX, e.clientY); }}>
        {card.image_url ? (
          <img className="card-img" src={card.image_url} alt={card.name} loading="lazy" />
        ) : (
          <div className="card-img" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>{card.name}</div>
        )}
        {card.image_url && (
          <button type="button" className="zoom-btn" aria-label={`Enlarge ${card.name}`}
            onClick={(e) => { e.stopPropagation(); onZoomCard(card); }}>
            🔍
          </button>
        )}
      </div>
      <div className="meta">
        <div className="meta-head">
          <span className={`select-dot${selected ? " on" : ""}`}>{selected ? "✓" : "＋"}</span>
          <span className="name">{card.name}</span>
        </div>
        <div className="price-row">
          <span className="price">{money(card.usd)}</span>
          {card.score != null && (
            <span className={`value-badge ${card.tier}`}>{card.score} Value</span>
          )}
        </div>
        <span className="role">{card.roleLabel}</span>
        <button className="swap" onClick={onSwap}>Already own this? Swap it</button>
      </div>
    </div>
  );
}

// Scryfall serves the same card art at several sizes under one URL pattern
// (…/small/…, …/normal/…, …/large/…). The DB stores `normal`; swapping the
// path segment gets the 672px `large` version, readable without new storage.
function largeImage(url) {
  return url ? url.replace("/normal/", "/large/").replace("/small/", "/large/") : url;
}

// Progressive zoom image: the tile's `/normal/` file is already in the
// browser cache, so show it instantly while the sharper `/large/` loads
// in the background — no blank flash on first hover/tap.
function ZoomImg({ url, alt, className, onClick }) {
  const large = largeImage(url);
  const [src, setSrc] = useState(url);
  useEffect(() => {
    setSrc(url);
    if (!large || large === url) return;
    const img = new Image();
    img.onload = () => setSrc(large);
    img.src = large;
  }, [url, large]);
  return <img src={src} alt={alt} className={className} onClick={onClick} />;
}

function CardLightbox({ cards, index, onClose, onNav, selected, onToggle }) {
  const card = cards[index];
  const touchX = React.useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNav(1);
      if (e.key === "ArrowLeft") onNav(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onNav]);
  if (!card?.image_url) return null;
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 40) onNav(dx < 0 ? 1 : -1);
  };
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={card.name}>
      <button type="button" className="lightbox-nav prev" aria-label="Previous card"
        onClick={(e) => { e.stopPropagation(); onNav(-1); }}>‹</button>
      <div className="lightbox-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <ZoomImg url={card.image_url} alt={card.name} onClick={(e) => e.stopPropagation()} />
      </div>
      <button type="button" className="lightbox-nav next" aria-label="Next card"
        onClick={(e) => { e.stopPropagation(); onNav(1); }}>›</button>
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      <div className="lightbox-meta">
        <div className="lightbox-count">{index + 1} of {cards.length}</div>
        <div className="lightbox-name">{card.name} · {money(card.usd)}</div>
        <button type="button" className={selected ? "ghost" : "primary"}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          {selected ? "Remove from list ✓" : "Add to list"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("landing");

  // Scroll to top and set the page title when switching views.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = view === "about" ? "About — ManaCents" : "ManaCents — Commander upgrades that respect your wallet";
  }, [view]);
  // Respect reduced-motion: show the poster's still instead of autoplaying.
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
  const [cmdrInput, setCmdrInput] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  // Full registry for client-side fuzzy search + color filtering. Null until
  // loaded; if the fetch fails we fall back to the server substring search.
  const [allCommanders, setAllCommanders] = useState(null);
  const [colorFilter, setColorFilter] = useState(new Set());
  const [selectedCmdr, setSelectedCmdr] = useState(null);
  const [budgetInput, setBudgetInput] = useState("40");
  const [mode, setMode] = useState("tuneup");
  // Deep links: ?commander=<slug>&budget=<n>&mode=<tuneup|splash> opens with
  // that list already built (shared from Reddit/Discord/IG). Parsed once.
  const [deepLink] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const slug = p.get("commander");
      if (!slug) return null;
      return {
        slug,
        budget: p.get("budget") ?? undefined,
        mode: ["tuneup", "splash"].includes(p.get("mode")) ? p.get("mode") : undefined,
      };
    } catch {
      return null;
    }
  });
  const deepLinkDone = useRef(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [result, setResult] = useState(null);
  const [resultError, setResultError] = useState("");
  const [deselected, setDeselected] = useState(new Set());
  const [swaps, setSwaps] = useState({});
  const [addedBreakers, setAddedBreakers] = useState([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [includeUniversal, setIncludeUniversal] = useState(false);
  const [including, setIncluding] = useState(false);
  const [toast, setToast] = useState("");
  // Card zoom: hover preview (desktop) + tap lightbox (touch).
  const [canHover] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches
  );
  const [hoverCard, setHoverCard] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [zoomIdx, setZoomIdx] = useState(null);
  // Commander request flow (empty search → Scryfall preview → one-tap request).
  const [requestPreview, setRequestPreview] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestDone, setRequestDone] = useState(null);
  const suggestRef = useRef(null);

  const debouncedQuery = useDebounced(cmdrInput, 260);

  // Load the full registry once for fuzzy search. Best-effort: on failure the
  // search effect below falls back to the server-side substring endpoint.
  useEffect(() => {
    let alive = true;
    fetchAllCommanders()
      .then((list) => { if (alive) setAllCommanders(list); })
      .catch(() => { if (alive) setAllCommanders(null); });
    return () => { alive = false; };
  }, []);

  const fuse = useMemo(() => {
    if (!allCommanders) return null;
    return new Fuse(allCommanders, {
      keys: ["name"],
      threshold: 0.35,       // typo-tolerant ("Atraxa" still matches "Atraxa")
      ignoreLocation: true,   // match anywhere in the name, not just the start
      includeScore: false,
    });
  }, [allCommanders]);

  // Home button (header logo): back to a fresh landing search from any view,
  // including inside a commander results page. Clears the deep-link URL so a
  // refresh stays on home instead of rebuilding the last commander list.
  const goHome = () => {
    setView("landing");
    setCmdrInput("");
    setSelectedCmdr(null);
    setShowSuggest(false);
    setSuggestions([]);
    setResult(null);
    setResultError("");
    try {
      window.history.replaceState(null, "", "/");
    } catch { /* URL reset is best-effort */ }
  };

  const toggleColorPip = (pip) => {
    setColorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(pip)) next.delete(pip);
      else next.add(pip);
      return next;
    });
  };

  useEffect(() => {
    let alive = true;
    const query = debouncedQuery.trim();
    if (query.length >= 2 && !selectedCmdr) {
      if (fuse) {
        // Client-side fuzzy search over the full registry, then color filter.
        // No fuse-level limit: the registry is only ~300 rows, and capping
        // before color filtering could cut matching commanders.
        const matches = fuse.search(query)
          .map((r) => r.item)
          .filter((c) => matchesColorFilter(c, colorFilter))
          .slice(0, 15);
        setSuggestions(matches);
        setShowSuggest(true);
      } else {
        // Fallback: server substring search (also used before registry loads).
        searchCommanders(query)
          .then((list) => {
            if (!alive) return;
            setSuggestions(list.filter((c) => matchesColorFilter(c, colorFilter)));
            setShowSuggest(true);
          })
          .catch(() => { if (alive) { setSuggestions([]); setShowSuggest(true); } });
      }
    } else if (query.length === 0 && colorFilter.size > 0 && !selectedCmdr) {
      // Browsing: color chips selected but no text — show matching commanders.
      const pool = allCommanders ?? [];
      setSuggestions(pool.filter((c) => matchesColorFilter(c, colorFilter)).slice(0, 15));
      setShowSuggest(true);
    } else {
      setSuggestions([]);
      setShowSuggest(false);
    }
    return () => { alive = false; };
  }, [debouncedQuery, selectedCmdr, fuse, allCommanders, colorFilter]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Watchlist: on load, check whether any requested commander went live.
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = loadWatchlist().filter((w) => !w.seen && w.oracle_id);
      if (!list.length) return;
      let changed = false;
      for (const w of list) {
        try {
          const s = await checkRequestStatus(w.oracle_id);
          if (!alive) return;
          if (s.status === "live") {
            w.seen = true;
            changed = true;
            setToast(`🎉 ${w.name} is now live — search for it to see upgrades!`);
            break; // one toast at a time
          }
        } catch {
          // Status check is best-effort.
        }
      }
      if (changed) saveWatchlist(list);
    })();
    return () => { alive = false; };
  }, []);

  // Empty-search request flow: preview the Scryfall match, then one-tap request.
  const startRequestPreview = async () => {
    const q = cmdrInput.trim();
    if (q.length < 2 || requestLoading) return;
    setRequestLoading(true);
    setRequestError("");
    setRequestPreview(null);
    try {
      const data = await previewCommanderRequest(q);
      setRequestPreview(data);
    } catch (e) {
      setRequestError(e.message);
    } finally {
      setRequestLoading(false);
    }
  };

  const sendCommanderRequest = async (candidate) => {
    const q = cmdrInput.trim();
    if (requestLoading || !candidate) return;
    setRequestLoading(true);
    setRequestError("");
    try {
      const data = await confirmCommanderRequest({ oracle_id: candidate.oracle_id, query: q });
      setRequestDone(data);
      setRequestPreview(null);
      if (data.oracle_id) addToWatchlist(data.oracle_id, data.slug, data.name);
      // If the stub was created, make it selectable immediately.
      if (data.slug && data.name && !data.alreadyLive) {
        setSelectedCmdr({ slug: data.slug, name: data.name, status: "pending_sync", vote_count: data.vote_count ?? 1 });
        setCmdrInput(data.name);
        setShowSuggest(false);
      }
    } catch (e) {
      setRequestError(e.message);
    } finally {
      setRequestLoading(false);
    }
  };

  const cancelRequestFlow = () => {
    setRequestPreview(null);
    setRequestDone(null);
    setRequestError("");
  };

  // Vote on a stub commander page ("+1 / Notify me when ready").
  const voteForStub = async () => {
    if (!result?.stub || requestLoading) return;
    setRequestLoading(true);
    try {
      const data = await voteCommander(result.commander.slug);
      setResult((r) => ({ ...r, vote_count: data.vote_count }));
      if (data.oracle_id) addToWatchlist(data.oracle_id, data.slug, data.name);
      setToast(data.already_live ? "This commander is already live!" : "Vote counted — we'll let you know when it's ready! 🎉");
    } catch (e) {
      setToast(e.message);
    } finally {
      setRequestLoading(false);
    }
  };

  const pickCommander = (c) => {
    setSelectedCmdr(c);
    setCmdrInput(c.name);
    setShowSuggest(false);
  };

  const submit = async (withUniversal = false, overrides = {}) => {
    setFormError("");
    const effCmdr = overrides.cmdr ?? selectedCmdr;
    if (!effCmdr) { setFormError("Choose a commander first."); return; }
    const effMode = overrides.mode ?? mode;
    const effBudgetInput = overrides.budgetInput ?? budgetInput;
    const budget = parseFloat(effBudgetInput);
    if (!Number.isFinite(budget) || budget < 1 || budget > 1000) {
      setFormError("Enter a budget between $1 and $1,000.");
      return;
    }
    if (withUniversal) setIncluding(true);
    else setLoading(true);
    setResultError("");
    try {
      const data = await fetchUpgrades(effCmdr.slug, budget, effMode, withUniversal);
      setResult(data);
      if (overrides.mode) setMode(overrides.mode);
      if (overrides.budgetInput) setBudgetInput(overrides.budgetInput);
      setIncludeUniversal(withUniversal);
      setDeselected(new Set());
      setSwaps({});
      setAddedBreakers([]);
      setShowSkipped(false);
      setView("results");
      window.scrollTo(0, 0);
      // Deep-link support: keep the address bar pointing at this exact list
      // (?commander=&budget=&mode=) so any results page can be shared as-is.
      try {
        const u = new URLSearchParams({ commander: effCmdr.slug, budget: String(budget), mode: effMode });
        window.history.replaceState(null, "", `?${u.toString()}`);
      } catch { /* URL update is best-effort */ }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setLoading(false);
      setIncluding(false);
    }
  };

  // Rebuild the current results with a different mode/budget (hero controls).
  const rebuild = (patch) => {
    if (loading || including) return;
    submit(false, patch);
  };

  // Deep link: once the registry loads, select the linked commander and
  // build its list automatically. Unknown slugs fall back to the homepage.
  useEffect(() => {
    if (!deepLink || deepLinkDone.current || !allCommanders) return;
    deepLinkDone.current = true;
    const found = allCommanders.find((c) => c.slug === deepLink.slug);
    if (!found) return;
    setSelectedCmdr(found);
    setCmdrInput(found.name);
    const patch = { cmdr: found };
    const b = parseFloat(deepLink.budget);
    if (Number.isFinite(b) && b >= 1 && b <= 1000) patch.budgetInput = String(b);
    if (deepLink.mode) patch.mode = deepLink.mode;
    submit(false, patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, allCommanders]);

  const visibleUpgrades = useMemo(() => {
    if (!result) return [];
    const applySwaps = (list) =>
      list.map((c) => {
        const s = swaps[c.scryfall_id];
        return s ? { ...s, _origId: c.scryfall_id, swappedIn: true } : c;
      });
    return [...applySwaps(result.upgrades), ...applySwaps(addedBreakers)];
  }, [result, swaps, addedBreakers]);

  const selectedCards = useMemo(
    () => visibleUpgrades.filter((c) => !deselected.has(c.scryfall_id)),
    [visibleUpgrades, deselected]
  );

  const total = useMemo(
    () => Math.round(selectedCards.reduce((s, c) => s + c.usd, 0) * 100) / 100,
    [selectedCards]
  );
  const remaining = result ? Math.round((result.budget - total) * 100) / 100 : 0;

  const toggleCard = (id) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const swapCard = (card) => {
    if (!result) return;
    const origId = card._origId ?? card.scryfall_id;
    const headroom = result.budget - (total - card.usd);
    const swappedInIds = new Set(Object.values(swaps).map((s) => s.scryfall_id));
    const pool = result.alternates.filter(
      (a) => a.usd <= headroom + 1e-9 && !swappedInIds.has(a.scryfall_id) && a.scryfall_id !== origId
    );
    const pick = pool.find((a) => a.role === card.role) ?? pool[0];
    if (!pick) {
      setToast("No affordable swap available right now.");
      return;
    }
    setSwaps((prev) => ({ ...prev, [origId]: pick }));
    setToast(`Swapped in ${pick.name}.`);
  };

  const selectAll = () => setDeselected(new Set());
  const clearAll = () => setDeselected(new Set(visibleUpgrades.map((c) => c.scryfall_id)));

  // Heavy-hitter add/remove, strictly per card: each breaker callout gets its
  // own button, and the added card joins the grid as a normal tile (tappable
  // to remove, counted in the total even when it blows past the budget).
  const toggleBreaker = (b) => {
    const exists = addedBreakers.some((c) => c.scryfall_id === b.scryfall_id);
    if (exists) {
      setSwaps((sp) => {
        const n = { ...sp };
        delete n[b.scryfall_id];
        return n;
      });
      setDeselected((prev) => {
        const n = new Set(prev);
        n.delete(b.scryfall_id);
        return n;
      });
      setAddedBreakers((prev) => prev.filter((c) => c.scryfall_id !== b.scryfall_id));
      return;
    }
    setAddedBreakers((prev) => [
      ...prev,
      {
        scryfall_id: b.scryfall_id,
        name: b.expensiveName,
        usd: b.expensiveUsd,
        image_url: b.expensiveImage,
        role: b.role,
        roleLabel: b.roleLabel,
        score: null, // tile hides the Value badge; inclusion % is in the callout
        tier: "gold",
        cmdr_rate: b.expensiveRate / 100,
        breakerAdded: true,
      },
    ]);
  };

  const checkedLabel = result?.checkedAt
    ? new Date(result.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <>
      <div className="wrap">
        <header className="site-header">
          <button type="button" className="brand-home" onClick={goHome} aria-label="Go to ManaCents home page">
            <img src="/logo-mark.png" alt="" />
            <span className="brand">Mana<span className="brand-cents">Cents</span></span>
          </button>
        </header>

        {view === "about" && (
          <About onBack={() => setView("landing")} />
        )}

        {view === "landing" && (
          <main className="landing">
            {/* Animated brand mark: continuous slow rotation. */}
            {reducedMotion ? (
              <img
                className="hero-logo-anim"
                src="/logo-animated-poster.jpg"
                alt="ManaCents logo"
              />
            ) : (
              <video
                className="hero-logo-anim"
                src="/logo-animated.mp4"
                poster="/logo-animated-poster.jpg"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-label="Animated ManaCents logo"
              />
            )}
            <h1>Commander upgrades that respect your wallet.</h1>
            <div className="fill-blank">
              <span>Upgrade my</span>
              <span className="cmdr-suggest" ref={suggestRef}>
                <input
                  type="text"
                  placeholder="Type Commander Name..."
                  value={cmdrInput}
                  onChange={(e) => { setCmdrInput(e.target.value); setSelectedCmdr(null); }}
                  onFocus={() => { if (suggestions.length) setShowSuggest(true); }}
                  aria-label="Commander name"
                />
                <div className="color-chips" role="group" aria-label="Filter by color identity">
                  {COLOR_PIPS.map((pip) => (
                    <button
                      key={pip.id}
                      type="button"
                      className={colorFilter.has(pip.id) ? "pip on" : "pip"}
                      style={{ "--pip-bg": pip.bg, "--pip-fg": pip.fg }}
                      onClick={() => toggleColorPip(pip.id)}
                      aria-pressed={colorFilter.has(pip.id)}
                      aria-label={`${pip.label} ${colorFilter.has(pip.id) ? "filter on" : "filter off"}`}
                      title={pip.label}
                    >
                      {pip.id}
                    </button>
                  ))}
                  {colorFilter.size > 0 && (
                    <button type="button" className="pip-clear" onClick={() => setColorFilter(new Set())}>
                      Clear
                    </button>
                  )}
                </div>
                {showSuggest && (
                  <ul role="listbox">
                    {suggestions.length === 0 && !requestPreview && !requestDone && (
                      <li className="request-empty">
                        {cmdrInput.trim().length >= 3 ? (
                          <>
                            <span className="request-prompt">Don't see your commander?</span>
                            <button type="button" className="ghost" onClick={startRequestPreview} disabled={requestLoading}>
                              {requestLoading ? "Looking it up…" : `Look up "${cmdrInput.trim().slice(0, 30)}"`}
                            </button>
                            {requestError && <span className="form-error">{requestError}</span>}
                          </>
                        ) : (
                          <button type="button" disabled>No commanders found.</button>
                        )}
                      </li>
                    )}
                    {requestPreview && !requestDone && (requestPreview.candidates?.length ?? 0) > 0 && (
                      <li className="request-candidates">
                        <span className="request-prompt">
                          {requestPreview.candidates.length > 1 ? "Which one did you mean?" : "Found it — request it?"}
                        </span>
                        {requestPreview.candidates.map((cand) => (
                          <div key={cand.oracle_id} className="request-candidate">
                            {cand.image_url && (
                              <img src={cand.image_url} alt={cand.name} loading="lazy" />
                            )}
                            <div>
                              <strong>{cand.name}</strong>
                              <span className="request-type">{cand.type_line}</span>
                              {cand.unreleased && (
                                <span className="request-note">Unreleased spoiler — it'll sync once data is available.</span>
                              )}
                              {cand.existing ? (
                                cand.existing.status === "pending_sync" ? (
                                  <span className="request-note">
                                    {`Already requested (${cand.existing.vote_count ?? 1} votes) — indexing now.`}
                                  </span>
                                ) : (
                                  <div className="request-actions">
                                    <button type="button" className="ghost" onClick={() => pickCommander(cand.existing)}>
                                      Select {cand.existing.name}
                                    </button>
                                  </div>
                                )
                              ) : (
                                <div className="request-actions">
                                  <button type="button" className="primary" onClick={() => sendCommanderRequest(cand)} disabled={requestLoading}>
                                    {requestLoading ? "Requesting…" : `Request ${cand.front_name}`}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        {requestError && <span className="form-error">{requestError}</span>}
                        <button type="button" className="ghost" onClick={cancelRequestFlow}>Cancel</button>
                      </li>
                    )}
                    {requestDone && (
                      <li className="request-done">
                        {requestDone.alreadyLive ? (
                          <span><strong>{requestDone.name}</strong> is already live — pick it from the suggestions!</span>
                        ) : requestDone.alreadyRequested ? (
                          <span>Good news — <strong>{requestDone.name}</strong> was already requested ({requestDone.vote_count} votes). It'll be live within 48 hours.</span>
                        ) : (
                          <span>Request received — <strong>{requestDone.name}</strong> will be live within 48 hours. 🎉</span>
                        )}
                        <button type="button" className="ghost" onClick={cancelRequestFlow}>Close</button>
                      </li>
                    )}
                    {suggestions.map((c) => (
                      <li key={c.slug}>
                        <button type="button" onClick={() => pickCommander(c)}>
                          {c.image_url && (
                            <img className="suggest-thumb" src={c.image_url} alt="" loading="lazy" />
                          )}
                          <span>{c.name}</span>
                          {c.status === "pending_sync" ? (
                            <span className="decks stub-badge">indexing…</span>
                          ) : (
                            <span className="decks">{c.deck_count?.toLocaleString?.() ?? ""} decks</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
              <span>deck with a budget of $</span>
              <input
                className="budget"
                inputMode="decimal"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                aria-label="Budget in dollars"
              />
            </div>
            <div className="mode-toggle" role="group" aria-label="Upgrade style">
              <button className={mode === "tuneup" ? "on" : ""} onClick={() => setMode("tuneup")}>
                Full Tune-Up<small>12–15 smart upgrades</small>
              </button>
              <button className={mode === "splash" ? "on" : ""} onClick={() => setMode("splash")}>
                Big Splash<small>4–6 powerhouse cards</small>
              </button>
            </div>
            <div>
              <button className="primary" onClick={() => submit(false)} disabled={loading} style={{ fontSize: "1.1rem", padding: "0.8rem 2rem" }}>
                {loading ? "Building your list…" : "Find my upgrades"}
              </button>
            </div>
            <p className="form-error" role="alert">{formError}</p>
          </main>
        )}

        {view === "results" && result && (
          <main>
            <div className="hero">
              <div className="hero-glow" aria-hidden="true">
                <img
                  src={`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(result.commander.name)}&format=image&version=large`}
                  alt=""
                />
              </div>
              <img
                className="hero-art"
                src={`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(result.commander.name)}&format=image&version=art_crop`}
                alt={`${result.commander.name} card art`}
                loading="lazy"
              />
              <div className="hero-body">
                <div className="kicker">Your upgrade plan</div>
                <h2>{result.commander.name}</h2>
                <div className="hero-controls">
                  <div className="mode-toggle small" role="group" aria-label="Upgrade style">
                    <button className={mode === "tuneup" ? "on" : ""} onClick={() => rebuild({ mode: "tuneup" })}>
                      Full Tune-Up
                    </button>
                    <button className={mode === "splash" ? "on" : ""} onClick={() => rebuild({ mode: "splash" })}>
                      Big Splash
                    </button>
                  </div>
                  <label className="hero-budget">
                    <span>$</span>
                    <input
                      inputMode="decimal"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      aria-label="Budget in dollars"
                    />
                    <button className="ghost" onClick={() => rebuild({})}>Update</button>
                  </label>
                  <button className="ghost" onClick={() => setView("landing")}>Change Commander</button>
                </div>
                <div
                  className="budget-bar"
                  role="progressbar"
                  aria-label="Budget used"
                  aria-valuenow={Math.round(Math.min(100, (total / result.budget) * 100))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`budget-fill${remaining < 0 ? " over" : ""}`}
                    style={{ width: `${Math.min(100, (total / result.budget) * 100)}%` }}
                  />
                </div>
                <div className="results-metrics">
                  <span>Total <strong>{money(total)}</strong> of {money(result.budget)}</span>
                  {remaining >= 0 ? (
                    <span>Budget left <strong>{money(remaining)}</strong></span>
                  ) : (
                    <span><strong>{money(-remaining)}</strong> over budget</span>
                  )}
                  <span>checked {checkedLabel}</span>
                </div>
              </div>
            </div>

            {result.stub ? (
              <div className="indexing-banner">
                {result.commander.image_url && (
                  <img src={result.commander.image_url} alt={result.commander.name} loading="lazy" />
                )}
                <div>
                  <h2>🔨 Indexing synergies</h2>
                  <p>
                    <strong>{result.commander.name}</strong> was just requested and we're
                    building its upgrade list. Full results arrive within 48 hours.
                  </p>
                  <p className="vote-count">
                    {result.vote_count} {result.vote_count === 1 ? "person wants" : "people want"} this commander
                  </p>
                  <button type="button" className="primary" onClick={voteForStub} disabled={requestLoading}>
                    {requestLoading ? "Voting…" : "+1 Notify me when ready"}
                  </button>
                </div>
              </div>
            ) : (
              <>
            {result.skipped.length > 0 && !includeUniversal && (
              <div className="smart-banner merged">
                <p>
                  ✨ Tailored for your Commander. We skipped {result.skipped.length} basics you
                  probably already have (like {result.skipped.slice(0, 2).map((s) => s.name).join(" & ")}).
                </p>
                <div className="banner-actions">
                  <button onClick={() => setShowSkipped((v) => !v)}>{showSkipped ? "Hide them" : "Show them"}</button>
                  <button onClick={() => submit(true)} disabled={including}>
                    {including ? "Including…" : "Include them anyway"}
                  </button>
                </div>
                {showSkipped && (
                  <div className="skipped-list">
                    {result.skipped.map((s) => (
                      <span className="skipped-chip" key={s.scryfall_id}>
                        {s.image_url && <img src={s.image_url} alt="" loading="lazy" />}
                        {s.name} · {money(s.usd)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {visibleUpgrades.length === 0 ? (
              <p className="note">No list this round — no upgrades fit inside {money(result.budget)} right now. Try a higher budget or check back after prices refresh.</p>
            ) : (
              <>
                <div className="grid-tools">
                  <h2>Choose your upgrades</h2>
                  <div>
                    <button className="ghost" onClick={selectAll} style={{ marginRight: "0.5rem" }}>Select all</button>
                    <button className="ghost" onClick={clearAll}>Clear</button>
                  </div>
                  <span className="hint">Tap a card image to add or remove it.</span>
                </div>
                <div className="card-grid">
                  {visibleUpgrades.map((c, i) => (
                    <CardTile
                      key={c.scryfall_id}
                      card={c}
                      selected={!deselected.has(c.scryfall_id)}
                      onToggle={() => toggleCard(c.scryfall_id)}
                      onSwap={() => swapCard(c)}
                      canHover={canHover}
                      onHoverCard={setHoverCard}
                      onHoverMove={(x, y) => setHoverPos({ x, y })}
                      onZoomCard={() => setZoomIdx(i)}
                    />
                  ))}
                </div>
                {(result.budgetBreakers ?? []).map((b) => {
                  const added = addedBreakers.some((c) => c.scryfall_id === b.scryfall_id);
                  return (
                    <div className="breaker-callout" key={b.scryfall_id}>
                      <p>
                        💡 <strong>Popular Heavy Hitter: {b.expensiveName} ({money(b.expensiveUsd)})</strong> — Played
                        in {b.expensiveRate}% of decks, {b.expensiveName} alone
                        takes up a big chunk of a {money(result.budget)} budget. Your list includes{" "}
                        <strong>{b.partnerName} ({money(b.partnerUsd)})</strong>{" "}
                        to cover {b.roleLabel} while leaving room for the rest of your upgrades.
                      </p>
                      <button className={added ? "ghost" : "primary"} onClick={() => toggleBreaker(b)}>
                        {added ? "Added ✓ — tap to remove" : "Add anyway"}
                      </button>
                    </div>
                  );
                })}
                <FeedbackWidget
                  commander={result.commander}
                  budget={result.budget}
                  mode={mode}
                  cards={visibleUpgrades}
                />
              </>
            )}
              </>
            )}

            {!result.stub && (
              <CheckoutBar
                commander={result.commander}
                budget={result.budget}
                cards={selectedCards}
                total={total}
                remaining={remaining}
                onToast={setToast}
              />
            )}
          </main>
        )}

        <Footer onAbout={() => setView("about")} />
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      {canHover && hoverCard?.image_url && (() => {
        const w = 300;
        const left = Math.min(hoverPos.x + 20, window.innerWidth - w - 12);
        const top = Math.max(12, Math.min(hoverPos.y - 140, window.innerHeight - 440));
        return (
          <div className="card-zoom" style={{ left, top }} aria-hidden="true">
            <ZoomImg url={hoverCard.image_url} alt="" />
          </div>
        );
      })()}
      {zoomIdx != null && visibleUpgrades[zoomIdx] && (
        <CardLightbox
          cards={visibleUpgrades}
          index={zoomIdx}
          onClose={() => setZoomIdx(null)}
          onNav={(d) => setZoomIdx((i) => (i + d + visibleUpgrades.length) % visibleUpgrades.length)}
          selected={!deselected.has(visibleUpgrades[zoomIdx].scryfall_id)}
          onToggle={() => toggleCard(visibleUpgrades[zoomIdx].scryfall_id)}
        />
      )}
    </>
  );
}
