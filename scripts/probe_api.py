"""Probe the Microburbs public API to learn real behaviour before building.

Usage:  python -I scripts/probe_api.py [budget_cents]
Reads MICROBURBS_API_KEY and MICROBURBS_BASE_URL from .env.
Writes every response to data/probe/ (ignored by git) and a log to data/probe/_log.jsonl.
Stops spending when the budget (default 950 cents) is reached.
"""
import json, os, re, sys, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "probe"
OUT.mkdir(parents=True, exist_ok=True)

env = {}
for line in (ROOT / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
KEY = env["MICROBURBS_API_KEY"]
BASE = env.get("MICROBURBS_BASE_URL", "https://api.microburbs.com.au")
BUDGET = int(sys.argv[1]) if len(sys.argv) > 1 else 950
spent = 0
LOG = open(OUT / "_log.jsonl", "a", encoding="utf-8")


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:120]


def call(path, params=None, name=None, est=0):
    """GET a path. est = expected cost in cents (skip if it would exceed budget)."""
    global spent
    if spent + est > BUDGET:
        print(f"  SKIP (budget) {path}")
        return None, None
    url = BASE + urllib.parse.quote(path, safe="/{}") + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}", "User-Agent": "mb-hackathon-probe/1.0", "Accept": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, headers, raw = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, headers, raw = e.code, dict(e.headers), e.read()
    ms = int((time.time() - t0) * 1000)
    cost = int(headers.get("X-Cost-Cents") or headers.get("x-cost-cents") or 0)
    spent += cost
    try:
        body = json.loads(raw)
    except Exception:
        body = raw.decode("utf-8", "replace")[:2000]
    fname = slug(name or path + "_" + json.dumps(params or {}))
    (OUT / f"{fname}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    rec = {"path": path, "params": params, "status": status, "ms": ms, "cost": cost, "spent": spent,
           "remaining": headers.get("X-Remaining-Cents") or headers.get("x-remaining-cents"),
           "data_null": isinstance(body, dict) and body.get("data") is None,
           "reason": body.get("reason") if isinstance(body, dict) else None, "file": fname}
    LOG.write(json.dumps(rec) + "\n"); LOG.flush()
    print(f"  {status} {ms:>5}ms {cost:>3}c total={spent:>4}c {path} {params or ''} {'NULL:'+str(rec['reason']) if rec['data_null'] else ''}")
    return status, body


def section(t):
    print(f"\n=== {t} ===")


# 1. Coverage: suburbs in the City of Sydney LGA (free)
section("1. Suburbs in City of Sydney")
_, lgas = call("/v1/lga/list", {"state": "NSW"}, "lga_list_nsw", 3)
sydney_lga = None
if isinstance(lgas, dict):
    for row in lgas.get("data") or []:
        if "sydney" in str(row.get("lga", "")).lower():
            print("   LGA candidate:", row)
            if str(row.get("lga")).lower().startswith("sydney"):
                sydney_lga = row["lga"]
_, subs = call("/v1/suburbs/list", {"lga": sydney_lga or "Sydney", "state": "NSW"}, "suburbs_city_of_sydney", 0)
suburbs = [r["suburb"] for r in (subs or {}).get("data", [])] if isinstance(subs, dict) else []
print("   suburbs:", len(suburbs), suburbs)

# 2. Listings for sale and rent in 3 suburbs
section("2. Listings")
targets = [s for s in suburbs if any(k in s for k in ("Surry Hills", "Pyrmont", "Waterloo"))] or ["Surry Hills", "Pyrmont", "Waterloo"]
sale, rent = [], []
for s in targets[:3]:
    _, b = call(f"/v1/suburbs/{s}/listings/for-sale", {"limit": 15}, f"listings_sale_{s}", 20)
    if isinstance(b, dict) and isinstance(b.get("data"), list):
        sale += [dict(r, _suburb=s) for r in b["data"]]
    elif isinstance(b, dict) and isinstance(b.get("data"), dict):
        rows = b["data"].get("listings") or b["data"].get("results") or []
        sale += [dict(r, _suburb=s) for r in rows]
    if s == targets[0]:
        _, b = call(f"/v1/suburbs/{s}/listings/for-rent", {"limit": 15}, f"listings_rent_{s}", 20)
        if isinstance(b, dict):
            d = b.get("data")
            rows = d if isinstance(d, list) else (d or {}).get("listings") or (d or {}).get("results") or []
            rent += [dict(r, _suburb=s) for r in rows]
print(f"   sale rows: {len(sale)}  rent rows: {len(rent)}")
for r in sale[:3]:
    print("   sample sale:", json.dumps({k: r.get(k) for k in ("address", "price", "property_type", "gnaf_pid", "listing_date")}, ensure_ascii=False)[:300])


def addr_str(r):
    a = r.get("address")
    if isinstance(a, dict):
        return a.get("street") or a.get("full") or json.dumps(a)
    return str(a)


# Prefer flats/units for the panel tests
def is_unit(r):
    return "/" in addr_str(r) or "unit" in str(r.get("property_type", "")).lower() or "apartment" in str(r.get("property_type", "")).lower()

sale_units = [r for r in sale if is_unit(r) and r.get("gnaf_pid")] + [r for r in sale if not is_unit(r) and r.get("gnaf_pid")]

# 3. Geocode formats: does the free-text address resolve to the same gnaf_pid?
section("3. Geocode variants")
geo_results = []
for r in sale_units[:6]:
    street = addr_str(r)
    sub = r["_suburb"].replace(" (NSW)", "")
    m = re.match(r"^\s*(\d+[A-Za-z]?)\s*/\s*(.+)$", street)
    variants = [f"{street}, {sub} NSW"]
    if m:
        variants += [f"Unit {m.group(1)}, {m.group(2)}, {sub} NSW", f"{street} {sub}"]
    else:
        variants += [f"{street} {sub}"]
    for v in variants:
        _, g = call("/v1/geocode/address", {"address": v}, f"geocode_{v}", 1)
        cands = (g or {}).get("data") or [] if isinstance(g, dict) else []
        ids = [c.get("id") for c in cands]
        rank = ids.index(r["gnaf_pid"]) + 1 if r["gnaf_pid"] in ids else None
        geo_results.append({"listing": street, "suburb": sub, "variant": v, "expected": r["gnaf_pid"],
                            "rank_of_expected": rank, "top": cands[0].get("name") if cands else None, "n": len(cands)})
        print(f"   rank={rank} top={cands[0].get('name') if cands else None!r}  <- {v!r}")
(OUT / "_geocode_summary.json").write_text(json.dumps(geo_results, indent=2), encoding="utf-8")

# 4. Agent-quoting coverage (decides the pitch headline)
section("4. agent-quoting coverage")
aq = []
for r in sale_units[:8]:
    st, b = call(f"/v1/properties/{r['gnaf_pid']}/valuation/agent-quoting", None, f"agent_quoting_{r['gnaf_pid']}", 50)
    if st is None:
        break
    ok = isinstance(b, dict) and b.get("data") is not None
    aq.append({"gnaf": r["gnaf_pid"], "address": addr_str(r), "price_text": r.get("price"), "has_data": ok,
               "reason": b.get("reason") if isinstance(b, dict) else None})
print(f"   coverage: {sum(a['has_data'] for a in aq)}/{len(aq)}")
(OUT / "_agent_quoting_summary.json").write_text(json.dumps(aq, indent=2, ensure_ascii=False), encoding="utf-8")

# 5. Full property panel on 3 properties (2 sale units + 1 rent)
section("5. Property panel endpoints")
panel = ["profile", "valuation/avm", "sale-history", "rent-history", "street/profile",
         "comparables/recent-sales-nearby", "transport/nearby"]
props = [r["gnaf_pid"] for r in sale_units[:2]] + [r.get("gnaf_pid") for r in rent[:1] if r.get("gnaf_pid")]
for i, g in enumerate(props):
    for ep in panel:
        call(f"/v1/properties/{g}/{ep}", None, f"prop_{g}_{ep}", 30)
    if i == 0:
        call(f"/v1/properties/{g}/basics/all", None, f"prop_{g}_basics_all", 23)
        call(f"/v1/properties/{g}/risks/all", {"geojson": "false"}, f"prop_{g}_risks_all", 48)

# 6. AVM null-rate on extra units (cheap)
section("6. AVM on more units")
for r in sale_units[2:8]:
    call(f"/v1/properties/{r['gnaf_pid']}/valuation/avm", None, f"avm_{r['gnaf_pid']}", 10)

# 7. Suburb context
section("7. Suburb context")
s0 = targets[0]
call(f"/v1/suburbs/{s0}/development/da-list", None, f"sub_{s0}_da_list", 18)
call(f"/v1/suburbs/{s0}/market/median-rent", None, f"sub_{s0}_median_rent", 12)

print(f"\nDONE. Spent {spent} cents. Files in {OUT}")
