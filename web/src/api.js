// Thin client for the Pages Functions API.
export async function searchCommanders(q) {
  const res = await fetch(`/api/commanders?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Commander search failed.");
  const data = await res.json();
  return data.commanders ?? [];
}

// Full commander registry, fetched once for client-side fuzzy search and
// color-identity filtering. Small (~300 rows).
export async function fetchAllCommanders() {
  const res = await fetch(`/api/commanders?all=1`);
  if (!res.ok) throw new Error("Commander list failed.");
  const data = await res.json();
  return data.commanders ?? [];
}

export async function fetchUpgrades(slug, budget, mode, includeUniversal = false) {
  const params = new URLSearchParams({ commander: slug, budget: String(budget), mode });
  if (includeUniversal) params.set("includeUniversal", "1");
  const res = await fetch(`/api/upgrades?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "ManaCents could not build the list. Please try again.");
  if (data.error && (!data.upgrades || data.upgrades.length === 0)) throw new Error(data.error);
  return data;
}

export const money = (n) =>
  `$${Number(n).toFixed(2).replace(/\.00$/, "")}`;

// Commander requests: preview resolves the query via Scryfall without
// writing; the confirm call creates the pending_sync stub (or votes).
export async function previewCommanderRequest(query) {
  const res = await fetch("/api/request-commander", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, preview: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  if (!data.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export async function confirmCommanderRequest(query) {
  const res = await fetch("/api/request-commander", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  if (!data.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export async function voteCommander(slug) {
  const res = await fetch("/api/request-commander/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Vote failed.");
  return data;
}

export async function checkRequestStatus(oracle_id) {
  const res = await fetch(`/api/request-commander?oracle_id=${encodeURIComponent(oracle_id)}`);
  if (!res.ok) return { status: "unknown" };
  return res.json();
}
