// Thin client for the Pages Functions API.
export async function searchCommanders(q) {
  const res = await fetch(`/api/commanders?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Commander search failed.");
  const data = await res.json();
  return data.commanders ?? [];
}

export async function fetchUpgrades(slug, budget, mode) {
  const params = new URLSearchParams({ commander: slug, budget: String(budget), mode });
  const res = await fetch(`/api/upgrades?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "ManaCents could not build the list. Please try again.");
  if (data.error && (!data.upgrades || data.upgrades.length === 0)) throw new Error(data.error);
  return data;
}

export const money = (n) =>
  `$${Number(n).toFixed(2).replace(/\.00$/, "")}`;
