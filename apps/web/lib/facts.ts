// Fact blocks for one property. The core (what decides: price, value, agency) loads with the panel;
// secondary sections load only when the user opens them, to keep the per-property cost low.
// Each block carries its source and date, and a failing endpoint only marks its own block unavailable.
import { z } from "zod";
import {
  AgentQuoting,
  Avm,
  Basics,
  CmaComp,
  type Fact,
  HistoryEntry,
  type ListingRow,
  type Mode,
  RecentSale,
  RisksAll,
  SchoolNearby,
  TransportNearby,
} from "@mb/contracts";
import { type Cache } from "./cache";
import { MicroburbsError, type MicroburbsClient } from "./microburbs";

const DATA_TTL_S = 12 * 60 * 60;
const NO_DATA_TTL_S = 2 * 60;
const NS = process.env.CACHE_NAMESPACE ?? "dev";

type Stored<T> = { available: true; data: T; fetchedAt: string } | { available: false; reason: string; fetchedAt: string };

export interface ListingFact {
  mode: Mode;
  /** The portal mode this listing is actually published in; price is null when it differs from the panel mode. */
  listedFor: Mode;
  price: number | null;
  listingDate: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  buildingSize: number | null;
  propertyType: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface PropertyFacts {
  listing: Fact<ListingFact>;
  agentQuoting: Fact<z.infer<typeof AgentQuoting>>;
  avm: Fact<z.infer<typeof Avm>>;
  cma: Fact<z.infer<typeof CmaComp>>;
  comparables: Fact<z.infer<typeof RecentSale>[]>;
  /** Loaded with the core only when renting (the unit's last rent matters for the rent check). */
  rentHistory: Fact<z.infer<typeof HistoryEntry>[]>;
  basics: Fact<z.infer<typeof Basics>>;
}

/** Cached call to one property endpoint, returned as a Fact block. */
export async function propertyFact<S extends z.ZodTypeAny>(
  deps: { mb: MicroburbsClient; cache: Cache },
  gnafId: string,
  endpoint: string,
  schema: S,
  asOf: (data: z.infer<S>, fetchedAt: string) => string | null = (_d, f) => f.slice(0, 10),
  params?: Record<string, string | boolean>,
): Promise<Fact<z.infer<S>>> {
  const source = `/v1/properties/{gnaf}/${endpoint}`;
  const key = `mb:${NS}:${endpoint}:${gnafId}`;
  let stored = await deps.cache.get<Stored<z.infer<S>>>(key);
  if (!stored) {
    try {
      const r = await deps.mb.get(`/v1/properties/${encodeURIComponent(gnafId)}/${endpoint}`, schema, params);
      const fetchedAt = new Date().toISOString();
      stored = r.available ? { available: true, data: r.data, fetchedAt } : { available: false, reason: r.reason, fetchedAt };
      await deps.cache.set(key, stored, stored.available ? DATA_TTL_S : NO_DATA_TTL_S);
    } catch (e) {
      const reason = e instanceof MicroburbsError ? (e.status === 403 ? "forbidden" : e.status === 402 ? "no_credit" : "error") : "error";
      return { available: false, value: null, source, asOf: null, reason };
    }
  }
  if (!stored.available) return { available: false, value: null, source, asOf: null, reason: stored.reason };
  return { available: true, value: stored.data, source, asOf: asOf(stored.data, stored.fetchedAt) };
}

/** Groups property types into "unit" or "house" so comparables stay like for like. */
export function typeClass(t: string | null): "unit" | "house" | null {
  if (!t) return null;
  return /unit|apartment|flat|studio/i.test(t) ? "unit" : /house|townhouse|terrace|villa|semi/i.test(t) ? "house" : null;
}

const latest = (rows: { date: string }[], f: string) => rows[0]?.date ?? f.slice(0, 10);

export async function getPropertyFacts(
  deps: { mb: MicroburbsClient; cache: Cache },
  gnafId: string,
  mode: Mode,
  listing: (ListingRow & { mode: Mode }) | null,
  listingsFetchedAt: string | null,
  opts: { agency?: boolean } = {},
): Promise<PropertyFacts> {
  const skipped = (source: string, reason: string) => ({ available: false, value: null, source, asOf: null, reason });

  const sale = mode === "sale";
  const notForMode = (endpoint: string) => Promise.resolve(skipped(`/v1/properties/{gnaf}/${endpoint}`, sale ? "not_for_sale" : "not_for_rent"));
  const [agentQuoting, avm, cma, comparablesRaw, rentHistory, basics] = await Promise.all([
    sale && opts.agency !== false
      ? propertyFact(deps, gnafId, "valuation/agent-quoting", AgentQuoting)
      : sale
        ? Promise.resolve(skipped("/v1/properties/{gnaf}/valuation/agent-quoting", "skipped"))
        : notForMode("valuation/agent-quoting"),
    sale ? propertyFact(deps, gnafId, "valuation/avm", Avm, (d) => d.prediction_date ?? null) : notForMode("valuation/avm"),
    sale ? propertyFact(deps, gnafId, "comparables/cma-single-comp", CmaComp, (d) => d.date_sold ?? null) : notForMode("comparables/cma-single-comp"),
    sale
      ? propertyFact(deps, gnafId, "comparables/recent-sales-nearby", z.array(RecentSale), (d, f) => d[0]?.date_sold ?? f.slice(0, 10))
      : notForMode("comparables/recent-sales-nearby"),
    sale ? notForMode("rent-history") : propertyFact(deps, gnafId, "rent-history", z.array(HistoryEntry), latest),
    // Bedrooms and parking come from the listing when we have it; basics is only a fallback.
    listing ? Promise.resolve(skipped("/v1/properties/{gnaf}/basics/all", "listing_has_attributes")) : propertyFact(deps, gnafId, "basics/all", Basics),
  ]);

  // Agency quoting prices are parsed from listing text and are sometimes junk ("$50,000" for a $3.3M flat).
  // Drop them when implausible on their own or far from Microburbs' own valuation or best comparable.
  const aq = agentQuoting.value;
  if (aq) {
    const ref = avm.value?.predicted_price ?? cma.value?.price ?? null;
    const bad = (x: number | null | undefined) => !!x && (x < 150_000 || (!!ref && (x < ref * 0.5 || x > ref * 2)));
    if (bad(aq.likely_sale_price) || bad(aq.asking_price)) {
      agentQuoting.value = { ...aq, likely_sale_price: null, asking_price: null };
    }
  }

  const beds = listing?.attributes.bedrooms ?? basics.value?.bed_count ?? null;
  const askingPrice = listing?.mode === "sale" && mode === "sale" ? (listing.price ?? null) : null;
  const kind = typeClass(listing?.property_type ?? basics.value?.dwelling_type ?? null);
  const comparables: PropertyFacts["comparables"] = comparablesRaw.available
    ? {
        ...comparablesRaw,
        value: (comparablesRaw.value ?? [])
          .filter(
            (c) =>
              c.gnaf_pid !== gnafId &&
              c.price &&
              (beds === null || c.bedrooms === beds) &&
              (kind === null || typeClass(c.property_type ?? null) === kind) &&
              (c.dist_km ?? 0) <= 1.5 &&
              // Drop outliers far from the asking price (penthouses, part sales, data errors).
              (!askingPrice || (c.price! >= askingPrice * 0.6 && c.price! <= askingPrice * 1.6)),
          )
          .sort((a, b) => (b.date_sold ?? "").localeCompare(a.date_sold ?? ""))
          .slice(0, 3),
      }
    : comparablesRaw;
  if (comparables.available) comparables.asOf = comparables.value?.[0]?.date_sold ?? comparables.asOf;

  const listingFact: PropertyFacts["listing"] = listing
    ? {
        available: true,
        source: `/v1/suburbs/{suburb}/listings/${listing.mode === "sale" ? "for-sale" : "for-rent"}`,
        asOf: listing.listing_date ?? listingsFetchedAt?.slice(0, 10) ?? null,
        value: {
          mode,
          listedFor: listing.mode,
          // Never show a sale price as a rent (or the reverse).
          price: listing.mode === mode ? (listing.price ?? null) : null,
          listingDate: listing.listing_date ?? null,
          bedrooms: listing.attributes.bedrooms ?? null,
          bathrooms: listing.attributes.bathrooms ?? null,
          parking: listing.attributes.garage_spaces ?? null,
          buildingSize: listing.attributes.building_size ?? null,
          propertyType: listing.property_type ?? null,
          address: listing.address.street,
          lat: listing.coordinates?.latitude ?? null,
          lng: listing.coordinates?.longitude ?? null,
        },
      }
    : skipped("/v1/suburbs/{suburb}/listings", "not_in_active_listings");

  return { listing: listingFact, agentQuoting, avm, cma, comparables, rentHistory, basics };
}

/** Plausible ranges for a price typed by the user: sale price, or weekly rent. */
export function parseUserPrice(raw: string | null | undefined, mode: Mode): number | null {
  const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return mode === "sale" ? (n >= 100_000 && n <= 60_000_000 ? Math.round(n) : null) : n >= 100 && n <= 30_000 ? Math.round(n) : null;
}

/**
 * When Microburbs has no asking price, the user can type the one shown on the portal.
 * The extension never reads prices from the page; this value is labelled as entered by the user.
 */
export function applyUserPrice(f: PropertyFacts, mode: Mode, price: number | null): PropertyFacts {
  const v = f.listing.value;
  if (!price || v?.price || (v && v.listedFor !== mode)) return f;
  const b = f.basics.value;
  const value: ListingFact = v
    ? { ...v, price }
    : {
        mode,
        listedFor: mode,
        price,
        listingDate: null,
        bedrooms: b?.bed_count ?? null,
        bathrooms: b?.bath_count ?? null,
        parking: b?.parking_count ?? null,
        buildingSize: null,
        propertyType: b?.dwelling_type ?? null,
        address: "",
        lat: null,
        lng: null,
      };
  return { ...f, listing: { available: true, value, source: "Asking price entered by you", asOf: new Date().toISOString().slice(0, 10), userPrice: true } as Fact<ListingFact> };
}

export type SectionName = "history" | "transport" | "schools" | "risks" | "block";

/** Secondary sections, fetched only when the user opens them (or the chat agent asks). */
export async function getSection(deps: { mb: MicroburbsClient; cache: Cache }, gnafId: string, name: SectionName) {
  switch (name) {
    case "history": {
      const [sale, rent] = await Promise.all([
        propertyFact(deps, gnafId, "sale-history", z.array(HistoryEntry), latest),
        propertyFact(deps, gnafId, "rent-history", z.array(HistoryEntry), latest),
      ]);
      return { saleHistory: sale, rentHistory: rent };
    }
    case "transport":
      return { transport: await propertyFact(deps, gnafId, "transport/nearby", TransportNearby) };
    case "schools": {
      const f = await propertyFact(deps, gnafId, "schools/nearby", z.array(SchoolNearby));
      if (f.value) f.value = [...f.value].sort((a, b) => (a.distance_m ?? 9e9) - (b.distance_m ?? 9e9)).slice(0, 6);
      return { schools: f };
    }
    case "risks":
      return { risks: await getRisks(deps, gnafId) };
    case "block": {
      const { blockProfile } = await import("./insights");
      return { block: await blockProfile(deps, gnafId) };
    }
  }
}

export function getRisks(deps: { mb: MicroburbsClient; cache: Cache }, gnafId: string) {
  return propertyFact(deps, gnafId, "risks/all", RisksAll, undefined, { geojson: "false" });
}
