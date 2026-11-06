// Extra tools for the Microburbs Agent. All numbers come from Microburbs (cached) or from plain arithmetic
// on figures the user gives; nothing here estimates market values on its own.
import { z } from "zod";
import { type Mode, type Sal } from "@mb/contracts";
import { type Cache, cached } from "./cache";
import { getPropertyFacts, type PropertyFacts } from "./facts";
import type { MicroburbsClient } from "./microburbs";
import { resolveAddress } from "./resolve";
import { getSuburbPulse } from "./suburb";
import { priceVerdict } from "./verdict";

type Deps = { mb: MicroburbsClient; cache: Cache };
const DAY_S = 24 * 60 * 60;
const NS = process.env.CACHE_NAMESPACE ?? "dev";

/** Cached suburb endpoint returning raw data, or null when Microburbs has none. */
async function suburbData(deps: Deps, suburb: Sal, endpoint: string): Promise<{ data: unknown; fetchedAt: string } | null> {
  return cached(deps.cache, `suburb:${NS}:${endpoint}:${suburb}`, DAY_S, async () => {
    const r = await deps.mb.get(`/v1/suburbs/${encodeURIComponent(suburb)}/${endpoint}`, z.unknown());
    return r.available ? { data: r.data, fetchedAt: new Date().toISOString() } : null;
  });
}

/** Compact, model-friendly view of one property's core facts. */
export function propertySummary(address: string, mode: Mode, f: PropertyFacts) {
  const l = f.listing.value;
  const v = priceVerdict(mode, f);
  return {
    address,
    listing: l
      ? { price: l.price, listedFor: l.listedFor, bedrooms: l.bedrooms, bathrooms: l.bathrooms, parking: l.parking, sizeM2: l.buildingSize, listed: l.listingDate, source: f.listing.source }
      : { noData: f.listing.reason ?? "not_in_active_listings" },
    verdict: { label: v.label, asking: v.asking, estimate: v.estimate, method: v.method, diffPct: v.diffPct, confidence: v.confidence, note: v.note, sources: v.sources },
    microburbsValuation: f.avm.value ? { value: f.avm.value.predicted_price, low: f.avm.value.predicted_price_low, high: f.avm.value.predicted_price_high, asOf: f.avm.asOf } : null,
    bestComparableSale: f.cma.value ? { street: f.cma.value.street, price: f.cma.value.price, sold: f.cma.value.date_sold, sameBuilding: f.cma.value.same_building } : null,
  };
}

/** Any City of Sydney address: match it exactly, then read its core facts (agency quoting skipped to save credit). */
export async function lookupAddress(deps: Deps, address: string, mode: Mode) {
  const { match, listing } = await resolveAddress(address, deps, { mode });
  if (match.status !== "exact-unit" || !match.gnafId) {
    return { address, matched: false, status: match.status, note: match.note ?? "No exact match.", candidates: match.candidates.slice(0, 3).map((c) => c.name) };
  }
  const m = listing?.mode ?? mode;
  const f = await getPropertyFacts(deps, match.gnafId, m, listing, null, { agency: false });
  return { matched: true, mode: m, ...propertySummary(match.matchedAddress ?? address, m, f), matchNote: match.note };
}

export async function compareSuburbs(deps: Deps, suburbs: Sal[], mode: Mode) {
  const out = await Promise.all(suburbs.slice(0, 3).map((s) => getSuburbPulse(deps, s, mode)));
  return out.map((p) => ({
    suburb: p.suburb,
    indicators: Object.fromEntries(Object.entries(p.indicators).map(([k, f]) => [k, f.available ? { value: f.value, asOf: f.asOf } : { noData: f.reason }])),
    note: "Yield and vacancy are fractions (0.0457 = 4.57%). Crime: verdict and vs_national_pct.",
  }));
}

export async function nearbyDevelopments(deps: Deps, suburb: Sal) {
  const r = await suburbData(deps, suburb, "development/da-list");
  const rows = Array.isArray(r?.data) ? (r!.data as { description?: string; date?: string; category?: string }[]) : [];
  if (!rows.length) return { suburb, noData: "No development applications in Microburbs for this suburb." };
  const sorted = [...rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  return {
    suburb,
    source: "/v1/suburbs/{suburb}/development/da-list",
    total: rows.length,
    lastTwelveMonths: rows.filter((x) => (x.date ?? "") >= yearAgo).length,
    note: "These are applications for the whole suburb; Microburbs does not give their exact location.",
    recent: sorted.slice(0, 6).map((x) => ({ date: x.date, category: x.category, description: (x.description ?? "").slice(0, 240) })),
  };
}

export async function priceTrend(deps: Deps, suburb: Sal, kind: "unit" | "house") {
  const r = await suburbData(deps, suburb, "market/median-sale-price-series");
  const series = ((r?.data as Record<string, unknown> | undefined)?.[kind] ?? []) as { date: string; value: number }[];
  if (!series.length) return { suburb, kind, noData: "No median price series in Microburbs." };
  const byYear = new Map<string, { date: string; value: number }>();
  for (const p of series) byYear.set(p.date.slice(0, 4), p); // last point of each year
  const yearly = [...byYear.values()].slice(-10);
  const last = series.at(-1)!;
  const ago = (years: number) => {
    const target = `${Number(last.date.slice(0, 4)) - years}${last.date.slice(4)}`;
    const p = [...series].reverse().find((x) => x.date <= target);
    return p ? Math.round(((last.value - p.value) / p.value) * 1000) / 10 : null;
  };
  return {
    suburb,
    kind,
    source: "/v1/suburbs/{suburb}/market/median-sale-price-series",
    latest: last,
    changePct: { oneYear: ago(1), fiveYears: ago(5), tenYears: ago(10) },
    yearly,
  };
}

/** Plain loan arithmetic. Approximate by design: no fees, stamp duty, LMI or rate changes. */
export function ownershipCosts(input: { price: number; depositPct: number; ratePct: number; years: number; strataAnnual?: number | null }) {
  const loan = input.price * (1 - input.depositPct / 100);
  const n = input.years * 12;
  const r = input.ratePct / 100 / 12;
  const monthly = r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
  const strataMonthly = input.strataAnnual ? input.strataAnnual / 12 : null;
  return {
    assumptions: { price: input.price, depositPct: input.depositPct, deposit: Math.round(input.price - loan), loan: Math.round(loan), ratePct: input.ratePct, years: input.years },
    monthlyRepayment: Math.round(monthly),
    totalInterest: Math.round(monthly * n - loan),
    strataMonthly: strataMonthly ? Math.round(strataMonthly) : null,
    monthlyTotal: Math.round(monthly + (strataMonthly ?? 0)),
    disclaimer:
      "Approximate principal-and-interest figure only. It excludes stamp duty, lender fees, mortgage insurance, council rates and future rate changes. Check the real numbers with your bank or a mortgage broker.",
  };
}
