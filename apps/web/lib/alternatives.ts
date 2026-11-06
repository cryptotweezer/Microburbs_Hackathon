// Finds similar active listings that cost less than the one being viewed.
// Deterministic: the chat agent can change the filters, but never the ranking or the numbers.
import { type ListingRow, type Mode, parseAddress, type Sal, toSal } from "@mb/contracts";
import type { Cache } from "./cache";
import { typeClass } from "./facts";
import { getSuburbListings } from "./listings";
import type { MicroburbsClient } from "./microburbs";

export const POSTCODES: Record<Sal, string> = {
  Alexandria: "2015", Barangaroo: "2000", "Beaconsfield (NSW)": "2015", "Camperdown (NSW)": "2050",
  "Centennial Park (NSW)": "2021", Chippendale: "2008", Darlinghurst: "2010", "Darlington (Sydney - NSW)": "2008",
  "Dawes Point": "2000", "Elizabeth Bay": "2011", Erskineville: "2043", Eveleigh: "2015", "Forest Lodge": "2037",
  "Glebe (NSW)": "2037", Haymarket: "2000", "Millers Point": "2000", "Moore Park": "2021", "Potts Point": "2011",
  Pyrmont: "2009", Redfern: "2016", "Rosebery (NSW)": "2018", "Rushcutters Bay": "2011", "Surry Hills": "2010",
  Sydney: "2000", "The Rocks (Sydney - NSW)": "2000", Ultimo: "2007", "Waterloo (NSW)": "2017",
  Woolloomooloo: "2011", Zetland: "2017",
};

export interface Target {
  gnafId: string | null;
  suburb: Sal;
  mode: Mode;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  buildingSize: number | null;
  propertyType: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Filters the user (or the chat agent) can change. Unset fields default to the target's attributes. */
export interface Filters {
  maxPrice?: number;
  bedrooms?: number;
  minBathrooms?: number;
  minParking?: number;
  suburbs?: Sal[];
  sizeTolerance?: number;
  limit?: number;
}

export interface Alternative {
  gnafId: string;
  address: string;
  suburb: Sal;
  price: number;
  saving: number;
  savingPct: number;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  buildingSize: number | null;
  listingDate: string | null;
  distanceM: number | null;
  /** Asking price per square metre, and how it compares with the suburb median for the same bedrooms. */
  pricePerSqm: number | null;
  vsMedianPct: number | null;
  reasons: string[];
  links: { domainProfile: string; reaSearch: string };
  source: string;
  asOf: string | null;
}

const slug = (s: string) => s.toLowerCase().replace(/\s*\(.*\)$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plainSuburb = (s: Sal) => s.replace(/\s*\(.*\)$/, "");

export function domainProfileUrl(street: string, suburb: Sal): string {
  const p = parseAddress(street, suburb);
  const parts = [p.unit, p.number, p.street].filter(Boolean).join(" ");
  return `https://www.domain.com.au/property-profile/${slug(`${parts} ${plainSuburb(suburb)} nsw ${POSTCODES[suburb]}`)}`;
}

/** Domain search page: /sale/<suburb>-nsw-<postcode>/?ptype=...&bedrooms=...&price=... */
export function domainSearchUrl(t: Pick<Target, "suburb" | "mode" | "bedrooms" | "propertyType">, maxPrice: number | null): string {
  const q = new URLSearchParams();
  q.set("ptype", typeClass(t.propertyType) === "house" ? "house" : "apartment-unit-flat");
  if (t.bedrooms !== null && t.bedrooms !== undefined) q.set("bedrooms", `${t.bedrooms}-${t.bedrooms}`);
  if (maxPrice) q.set("price", `0-${Math.round(maxPrice)}`);
  q.set(t.mode === "rent" ? "excludedeposittaken" : "excludeunderoffer", "1");
  return `https://www.domain.com.au/${t.mode === "rent" ? "rent" : "sale"}/${slug(plainSuburb(t.suburb))}-nsw-${POSTCODES[t.suburb]}/?${q}`;
}

function reaSearchUrl(street: string, suburb: Sal, mode: Mode) {
  const q = encodeURIComponent(`${street}, ${plainSuburb(suburb)} NSW ${POSTCODES[suburb]}`);
  return `https://www.realestate.com.au/${mode === "rent" ? "rent" : "buy"}/in-${q}/list-1`;
}

function metres(aLat?: number | null, aLng?: number | null, bLat?: number | null, bLng?: number | null) {
  if ([aLat, aLng, bLat, bLng].some((v) => v === null || v === undefined)) return null;
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat! - aLat!), dLng = toRad(bLng! - aLng!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat!)) * Math.cos(toRad(bLat!)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Median asking rent of active like-for-like rentals (same type and bedrooms), as a rent check fallback. */
export function marketRent(target: Pick<Target, "propertyType" | "bedrooms" | "bathrooms" | "suburb" | "gnafId">, rows: ListingRow[]) {
  const kind = typeClass(target.propertyType);
  const like = rows.filter(
    (r) => r.gnaf_pid !== target.gnafId && r.price && !r.off_market && (kind === null || typeClass(r.property_type ?? null) === kind) && r.attributes.bedrooms === target.bedrooms,
  );
  const sameBaths = like.filter((r) => target.bathrooms === null || r.attributes.bathrooms === target.bathrooms);
  const pool = sameBaths.length >= 5 ? sameBaths : like;
  if (target.bedrooms === null || pool.length < 5) return null;
  const xs = pool.map((r) => r.price!).sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  const value = Math.round(xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2);
  const baths = pool === sameBaths && target.bathrooms !== null ? `, ${target.bathrooms}-bath` : "";
  return { value, sample: xs.length, low: xs[Math.floor(xs.length * 0.25)]!, high: xs[Math.floor(xs.length * 0.75)]!, label: `${target.bedrooms}-bed${baths} ${kind ?? "home"}s for rent in ${target.suburb.replace(/\s*\(.*\)$/, "")}` };
}

export interface ValueBenchmark {
  medianPerSqm: number | null;
  sample: number;
  label: string;
}

/** Median asking $/m2 for like-for-like listings in the index (same type and bedrooms). */
export function valueBenchmark(target: Pick<Target, "propertyType" | "bedrooms" | "suburb">, rows: ListingRow[], bedsOverride?: number): ValueBenchmark {
  const kind = typeClass(target.propertyType);
  const beds = bedsOverride ?? target.bedrooms;
  const xs = rows
    .filter((r) => r.price && r.attributes.building_size && r.attributes.building_size >= 20 && !r.off_market)
    .filter((r) => (kind === null || typeClass(r.property_type ?? null) === kind) && (beds === null || r.attributes.bedrooms === beds))
    .map((r) => r.price! / r.attributes.building_size!)
    .sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  const medianPerSqm = xs.length >= 5 ? Math.round(xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2) : null;
  const plain = target.suburb.replace(/\s*\(.*\)$/, "");
  return { medianPerSqm, sample: xs.length, label: `${beds ?? "any"}-bed ${kind ?? "home"}s in ${plain}` };
}

/** Pure ranking over listing rows; exported for tests. */
export function rankAlternatives(target: Target, rows: (ListingRow & { fetchedAt?: string })[], filters: Filters = {}): Alternative[] {
  const beds = filters.bedrooms ?? target.bedrooms;
  const minBaths = filters.minBathrooms ?? target.bathrooms ?? 0;
  const minParking = filters.minParking ?? target.parking ?? 0;
  const tol = filters.sizeTolerance ?? 0.2;
  const ceiling = filters.maxPrice ?? target.price;
  const kind = typeClass(target.propertyType);
  const unit = target.mode === "rent" ? "/wk" : "";
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}${unit}`;

  const bench = valueBenchmark(target, rows, beds ?? undefined);
  const out: Alternative[] = [];
  for (const r of rows) {
    const a = r.attributes;
    if (r.gnaf_pid === target.gnafId || !r.price || r.off_market) continue;
    if (ceiling && r.price >= ceiling) continue;
    if (kind && typeClass(r.property_type ?? null) !== kind) continue;
    if (beds !== null && beds !== undefined && a.bedrooms !== beds) continue;
    if ((a.bathrooms ?? 0) < minBaths) continue;
    if ((a.garage_spaces ?? 0) < minParking) continue;
    if (!filters.bedrooms && target.buildingSize && a.building_size && Math.abs(a.building_size - target.buildingSize) / target.buildingSize > tol) continue;
    // Prices far below the target are usually a different product (studio, share, typo): skip them.
    if (target.price && r.price < target.price * 0.5) continue;

    const sal = toSal(r.address.sal) ?? target.suburb;
    const saving = target.price ? target.price - r.price : 0;
    const distanceM = metres(target.lat, target.lng, r.coordinates?.latitude, r.coordinates?.longitude);
    const reasons = [
      `${a.bedrooms ?? "?"} bed, ${a.bathrooms ?? "?"} bath, ${a.garage_spaces ?? 0} car`,
      target.price ? `${fmt(saving)} below this listing (${fmt(r.price)} vs ${fmt(target.price)})` : `asking ${fmt(r.price)}`,
    ];
    if (a.building_size && target.buildingSize) reasons.push(`${a.building_size} m2 vs ${target.buildingSize} m2`);
    const pricePerSqm = a.building_size && a.building_size >= 20 ? Math.round(r.price / a.building_size) : null;
    const vsMedianPct = pricePerSqm && bench.medianPerSqm ? Math.round(((pricePerSqm - bench.medianPerSqm) / bench.medianPerSqm) * 1000) / 10 : null;
    if (pricePerSqm && vsMedianPct !== null)
      reasons.push(`${fmt(pricePerSqm)}/m2, ${Math.abs(vsMedianPct)}% ${vsMedianPct <= 0 ? "below" : "above"} the median for ${bench.label}`);
    if (distanceM !== null) reasons.push(distanceM < 1000 ? `${distanceM} m away` : `${(distanceM / 1000).toFixed(1)} km away`);

    out.push({
      gnafId: r.gnaf_pid,
      address: r.address.street,
      suburb: sal,
      price: r.price,
      saving,
      savingPct: target.price ? Math.round((saving / target.price) * 1000) / 10 : 0,
      bedrooms: a.bedrooms ?? null,
      bathrooms: a.bathrooms ?? null,
      parking: a.garage_spaces ?? null,
      buildingSize: a.building_size ?? null,
      listingDate: r.listing_date ?? null,
      distanceM,
      pricePerSqm,
      vsMedianPct,
      reasons,
      links: { domainProfile: domainProfileUrl(r.address.street, sal), reaSearch: reaSearchUrl(r.address.street, sal, target.mode) },
      source: `/v1/suburbs/{suburb}/listings/${target.mode === "rent" ? "for-rent" : "for-sale"}`,
      asOf: r.listing_date ?? r.fetchedAt?.slice(0, 10) ?? null,
    });
  }
  // With a target price: value first (cheaper AND cheap for its size AND close). 1 km costs 4 points.
  // Without one there is no saving to rank by: closest similar listings first.
  const score = (x: Alternative) =>
    ceiling ? x.savingPct * 0.4 - (x.vsMedianPct ?? 0) * 0.4 - ((x.distanceM ?? 1500) / 1000) * 4 : -((x.distanceM ?? 1500) / 1000) * 4 - (x.vsMedianPct ?? 0) * 0.1;
  out.sort((x, y) => score(y) - score(x) || (x.distanceM ?? 9e9) - (y.distanceM ?? 9e9));
  return out.slice(0, filters.limit ?? 3);
}

export async function findAlternatives(
  deps: { mb: MicroburbsClient; cache: Cache },
  target: Target,
  filters: Filters = {},
) {
  const suburbs = filters.suburbs?.length ? filters.suburbs : [target.suburb];
  const rows: (ListingRow & { fetchedAt?: string })[] = [];
  let fetchedAt: string | null = null;
  for (const s of suburbs.slice(0, 4)) {
    const idx = await getSuburbListings(deps.mb, deps.cache, s, target.mode);
    fetchedAt = idx.fetchedAt;
    rows.push(...idx.rows.map((r) => ({ ...r, fetchedAt: idx.fetchedAt })));
  }
  const items = rankAlternatives(target, rows, filters);
  const bench = valueBenchmark(target, rows, filters.bedrooms);
  const targetPerSqm = target.price && target.buildingSize && target.buildingSize >= 20 ? Math.round(target.price / target.buildingSize) : null;
  const targetValue = {
    ...bench,
    pricePerSqm: targetPerSqm,
    vsMedianPct: targetPerSqm && bench.medianPerSqm ? Math.round(((targetPerSqm - bench.medianPerSqm) / bench.medianPerSqm) * 1000) / 10 : null,
  };
  return {
    items,
    /** "cheaper" when we know the target price; otherwise the items are only similar. */
    compare: (filters.maxPrice ?? target.price) ? ("cheaper" as const) : ("similar" as const),
    searched: { suburbs, listings: rows.length, fetchedAt },
    targetValue,
    seeAllUrl: domainSearchUrl(target, filters.maxPrice ?? target.price),
  };
}
