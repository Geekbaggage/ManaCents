import json, time, urllib.request, urllib.parse
UA = {"User-Agent": "ManaCents/1.0 (contact: geekbaggage@gmail.com)", "Accept": "application/json"}
def get(url, tries=4):
    for i in range(tries):
        req = urllib.request.Request(url, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
        except Exception:
            if i == tries - 1: raise
            time.sleep(min(2 ** i, 8))
def cheapest(name):
    q = urllib.parse.quote(name)
    url = f"https://api.scryfall.com/cards/search?q={q}&unique=prints&order=released"
    prints = []
    while url:
        d = get(url)
        prints += [c for c in d.get("data", []) if c["name"] == name]
        url = d.get("next_page"); time.sleep(0.12)
    best = None
    for c in prints:
        for key in ("usd", "usd_foil"):
            v = c["prices"].get(key)
            if v is None: continue
            v = float(v)
            if best is None or v < best[0]:
                best = (v, f"{c['set'].upper()} #{c['collector_number']}", key, c["mana_cost"])
    return best
total = 0
for name in ["Loyal Apprentice", "Reconnaissance", "Firemane Commando", "Grenzo, Havoc Raiser", "Adriana, Captain of the Guard"]:
    b = cheapest(name)
    total += b[0]
    print(f"{name}: ${b[0]:.2f} {b[1]} ({b[2]}) mana={b[3]}")
print(f"TOTAL: ${total:.2f}")
