// Insights built from ideas suggested by Microburbs:
// - "Cheap block on an expensive street": sold prices on this street vs the suburb and nearby streets.
// - "Spot odd data": the asking price against rents of similar flats (implied gross yield).
// - "Ask about the block": the exact census mesh block this property sits in, cited by its id.
// Every figure is a median of Microburbs records, returned with its sample size and source.
import { z } from "zod";
import { type Fact, type Mode, parseAddress, type Sal } from "@mb/contracts";
import { marketRent, type Target } from "./alternatives";
import { type Cache, cached } from "./cache";
import { typeClass } from "./facts";
import { getSuburbListings } from "./listings";
import type { MicroburbsClient } from "./microburbs";
import { indicator } from "./suburb";

type Deps = { mb: MicroburbsClient; cache: Cache };
const NS = process.env.CACHE_NAMESPACE ?? "dev";
const WEEK_S = 7 * 24 * 60 * 60;

const Sale = z.object({
  gnaf_pid: z.string().nullish(),
  address: z.string(),
  property_type: z.string().nullish(),
  bedrooms: z.number().nullish(),
  sold_price: z.number().nullish(),
  sold_date: z.string().nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});
type Sale = z.infer<typeof Sale>;
const SalesPage = z.object({ total: z.number().nullish(), next_offset: z.number().nullish(), results: z.array(Sale) });

/** Every sale in the suburb over the last 3 years (200 per call, flat price per call), cached for a week. */
export async function getSuburbSales(deps: Deps, suburb: Sal): Promise<{ rows: Sale[]; fetchedAt: string }> {
  return cached(deps.cache, `sales:${NS}:v1:${suburb}`, WEEK_S, async () => {
    const rows: Sale[] = [];
    for (let offset = 0, page = 0; page < 6; page++) {
      const r = await deps.mb.get(`/v1/suburbs/${encodeURIComponent(suburb)}/sales/recent`, SalesPage, { limit: "200", offset: String(offset) });
      if (!r.available) break;
      rows.push(...r.data.results);
      if (!r.data.next_offset || r.data.results.length < 200 || rows.length >= (r.data.total ?? 0)) break;
      offset = r.data.next_offset;
    }
    return { rows, fetchedAt: new Date().toISOString() };
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : null;
};

function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(bLat - aLat) / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(toRad(bLng - aLng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const MIN_SALES = 3;

export interface StreetCheck {
  street: string;
  label: string;
  thisStreet: { median: number; sales: number } | null;
  suburb: { median: number; sales: number };
  diffPct: number | null;
  nearby: { street: string; median: number; sales: number; distanceM: number; diffPct: number }[];
  source: string;
  asOf: string;
}

/** Median sold price of like-for-like homes on this street vs the suburb, and on nearby streets. */
export function streetCheckFrom(target: Pick<Target, "suburb" | "bedrooms" | "propertyType" | "lat" | "lng">, street: string, sales: Sale[], fetchedAt: string): StreetCheck | null {
  const kind = typeClass(target.propertyType);
  const like = (s: Sale) => !!s.sold_price && (kind === null || typeClass(s.property_type ?? null) === kind);
  const sameBeds = sales.filter((s) => like(s) && target.bedrooms !== null && s.bedrooms === target.bedrooms);
  // Fall back to all bedrooms when the suburb has too few sales of this size.
  const pool = sameBeds.length >= 15 ? sameBeds : sales.filter(like);
  const suburbMedian = median(pool.map((s) => s.sold_price!));
  if (!suburbMedian || pool.length < 10) return null;

  const byStreet = new Map<string, Sale[]>();
  for (const s of pool) {
    const st = parseAddress(s.address, target.suburb).street;
    if (st) byStreet.set(st, [...(byStreet.get(st) ?? []), s]);
  }
  const pct = (x: number) => Math.round(((x - suburbMedian) / suburbMedian) * 1000) / 10;
  const mine = byStreet.get(street.toLowerCase()) ?? byStreet.get(street) ?? [];
  const mineMedian = mine.length >= MIN_SALES ? median(mine.map((s) => s.sold_price!)) : null;

  const nearby =
    target.lat && target.lng
      ? [...byStreet.entries()]
          .filter(([st, rows]) => st !== street.toLowerCase() && rows.length >= MIN_SALES)
          .map(([st, rows]) => {
            const d = Math.min(...rows.filter((r) => r.lat && r.lng).map((r) => metres(target.lat!, target.lng!, r.lat!, r.lng!)));
            const m = median(rows.map((r) => r.sold_price!))!;
            return { street: title(st), median: m, sales: rows.length, distanceM: d, diffPct: pct(m) };
          })
          .filter((x) => Number.isFinite(x.distanceM) && x.distanceM <= 600)
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, 4)
      : [];

  const beds = pool === sameBeds ? `${target.bedrooms}-bed ` : "";
  return {
    street: title(street),
    label: `${beds}${kind ?? "home"}s sold in the last 3 years`,
    thisStreet: mineMedian ? { median: mineMedian, sales: mine.length } : null,
    suburb: { median: suburbMedian, sales: pool.length },
    diffPct: mineMedian ? pct(mineMedian) : null,
    nearby,
    source: "/v1/suburbs/{suburb}/sales/recent",
    asOf: fetchedAt.slice(0, 10),
  };
}

export async function streetCheck(deps: Deps, target: Target, address: string): Promise<StreetCheck | null> {
  const street = parseAddress(address, target.suburb).street;
  if (!street) return null;
  const { rows, fetchedAt } = await getSuburbSales(deps, target.suburb);
  return streetCheckFrom(target, street, rows, fetchedAt);
}

export interface YieldCheck {
  askingPrice: number;
  marketRent: number;
  rentSample: number;
  rentLabel: string;
  grossYieldPct: number;
  suburbYieldPct: number | null;
  /** "low": expensive relative to rents; "high": unusually cheap relative to rents, worth double-checking. */
  flag: "low" | "typical" | "high";
  note: string;
  sources: string[];
}

/** Implied gross yield: weekly market rent of similar flats x 52 / asking price, against the suburb's yield. */
export async function yieldCheck(deps: Deps, target: Target, mode: Mode): Promise<YieldCheck | null> {
  if (mode !== "sale" || !target.price) return null;
  const rents = await getSuburbListings(deps.mb, deps.cache, target.suburb, "rent");
  const mr = marketRent({ ...target, gnafId: null }, rents.rows);
  if (!mr) return null;
  const gross = Math.round(((mr.value * 52) / target.price) * 1000) / 10;
  const y = await indicator(deps, target.suburb, "market/yield-pct");
  const kind = typeClass(target.propertyType) === "house" ? "house" : "unit";
  const raw = y.value?.[kind];
  const suburbYield = typeof raw === "number" ? Math.round(raw * 1000) / 10 : null;
  const ratio = suburbYield ? gross / suburbYield : 1;
  const flag = ratio < 0.7 ? "low" : ratio > 1.5 ? "high" : "typical";
  const note =
    flag === "low"
      ? "Expensive relative to what similar flats rent for."
      : flag === "high"
        ? "Unusually cheap relative to rents. Check the details: size, condition, strata or a data error."
        : "In line with what similar flats rent for.";
  return {
    askingPrice: target.price,
    marketRent: mr.value,
    rentSample: mr.sample,
    rentLabel: mr.label,
    grossYieldPct: gross,
    suburbYieldPct: suburbYield,
    flag,
    note,
    sources: [`/v1/suburbs/{suburb}/listings/for-rent: median of ${mr.sample} ${mr.label}`, `/v1/suburbs/{suburb}/market/yield-pct (${y.asOf ?? "latest"})`],
  };
}

// ---------------- Mesh block
const MeshBlocks = z.object({
  center_lat: z.number().nullish(),
  center_lng: z.number().nullish(),
  mesh_blocks: z.object({
    features: z.array(
      z.object({
        geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
        properties: z.object({
          mb: z.string(),
          modal_street: z.string().nullish(),
          avg_annual_growth: z.number().nullish(),
          total_properties: z.number().nullish(),
          rental_properties: z.number().nullish(),
          investor_pct: z.number().nullish(),
          median_sold_price: z.number().nullish(),
        }),
      }),
    ),
  }),
});

function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}
function inGeometry(lng: number, lat: number, g: { type: string; coordinates: unknown }) {
  const polys = (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]) as number[][][][];
  return polys.some((p) => p[0] && inRing(lng, lat, p[0]));
}

export interface BlockProfile {
  meshBlock: string;
  street: string | null;
  homes: number | null;
  rentedPct: number | null;
  investorPct: number | null;
  growthPctPerYear: number | null;
  medianSoldPrice: number | null;
  area: { blocks: number; rentedPct: number | null; investorPct: number | null; growthPctPerYear: number | null };
  source: string;
  asOf: string;
}

export async function blockProfile(deps: Deps, gnafId: string): Promise<Fact<BlockProfile>> {
  const source = "/v1/properties/{gnaf}/context/mesh-blocks";
  const data = await cached(deps.cache, `block:${NS}:v1:${gnafId}`, WEEK_S, async () => {
    const r = await deps.mb.get(`/v1/properties/${encodeURIComponent(gnafId)}/context/mesh-blocks`, MeshBlocks);
    if (!r.available || !r.data.center_lat || !r.data.center_lng) return null;
    const feats = r.data.mesh_blocks.features;
    const own = feats.find((f) => inGeometry(r.data.center_lng!, r.data.center_lat!, f.geometry));
    if (!own) return null;
    const p = own.properties;
    const share = (a?: number | null, b?: number | null) => (a !== null && a !== undefined && b ? Math.round((a / b) * 1000) / 10 : null);
    const med = (xs: (number | null | undefined)[]) => median(xs.filter((x): x is number => typeof x === "number"));
    const withHomes = feats.map((f) => f.properties).filter((x) => (x.total_properties ?? 0) >= 5);
    return {
      meshBlock: p.mb,
      // Microburbs gives the main street name without its type ("WATTLE"), so never add "Street" to it.
      street: p.modal_street ? title(p.modal_street) : null,
      homes: p.total_properties ?? null,
      rentedPct: share(p.rental_properties, p.total_properties),
      investorPct: p.investor_pct ?? null,
      growthPctPerYear: p.avg_annual_growth !== null && p.avg_annual_growth !== undefined ? Math.round(p.avg_annual_growth * 1000) / 10 : null,
      medianSoldPrice: p.median_sold_price ?? null,
      area: {
        blocks: withHomes.length,
        rentedPct: med(withHomes.map((x) => share(x.rental_properties, x.total_properties))),
        investorPct: med(withHomes.map((x) => x.investor_pct)),
        growthPctPerYear: (() => {
          const g = med(withHomes.map((x) => (typeof x.avg_annual_growth === "number" ? Math.round(x.avg_annual_growth * 1000) : null)));
          return g === null ? null : g / 10;
        })(),
      },
      source,
      asOf: new Date().toISOString().slice(0, 10),
    } satisfies BlockProfile;
  });
  return data ? { available: true, value: data, source, asOf: data.asOf } : { available: false, value: null, source, asOf: null, reason: "no_data" };
}
