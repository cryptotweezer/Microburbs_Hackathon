// Calls to our backend. The extension holds no secrets: every Microburbs call happens server side.

export const BACKEND_URL: string = import.meta.env.WXT_BACKEND_URL || "http://localhost:3000";
/** Custom header: forces a CORS preflight so other websites cannot fire simple requests at the backend. */
const CLIENT = { "x-listing-lens": "1" };

export type Mode = "sale" | "rent";

export interface Fact<T> {
  /** Set on the listing block when the asking price was typed by the user. */
  userPrice?: boolean;
  available: boolean;
  value: T | null;
  source: string;
  asOf: string | null;
  reason?: string;
}

export interface Match {
  input: string;
  normalized: string;
  status: "exact-unit" | "exact-building" | "ambiguous" | "withheld" | "unsupported";
  gnafId: string | null;
  suburb: string | null;
  matchedAddress: string | null;
  candidates: { id: string; name: string }[];
  note?: string;
}

export interface History {
  date: string;
  price?: number | null;
  type: string;
}

export interface Comparable {
  street?: string | null;
  sal?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  garage_spaces?: number | null;
  price?: number | null;
  date_sold?: string | null;
  same_building?: boolean | null;
  distance_m?: number | null;
}

export interface Alternative {
  gnafId: string;
  address: string;
  suburb: string;
  price: number;
  saving: number;
  savingPct: number;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  buildingSize?: number | null;
  distanceM?: number | null;
  pricePerSqm?: number | null;
  vsMedianPct?: number | null;
  reasons: string[];
  links: { domainProfile: string; reaSearch: string };
  source: string;
  asOf: string | null;
}

export interface Target {
  gnafId: string | null;
  suburb: string;
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

export interface AlternativesResult {
  target: Target;
  items: Alternative[];
  compare?: "cheaper" | "similar";
  searched: { suburbs: string[]; listings: number; fetchedAt: string | null };
  targetValue?: { medianPerSqm: number | null; sample: number; label: string; pricePerSqm: number | null; vsMedianPct: number | null };
  seeAllUrl: string;
}

export interface Verdict {
  label: "below" | "in-line" | "above" | "unknown";
  asking: number | null;
  estimate: number | null;
  low: number | null;
  high: number | null;
  method: string | null;
  diffPct: number | null;
  confidence: "model" | "low" | null;
  sources: string[];
  note: string;
}

export interface RentEstimate {
  gnafId: string;
  rentWithCarSpace: number;
  rentWithoutCarSpace: number;
  support: string;
  modelVersion: string;
}

export interface PropertyResponse {
  match: Match;
  mode?: Mode;
  /** "listing": the property is in Microburbs' for-sale or for-rent listings, which decided the mode. */
  modeSource?: "listing" | "page" | "user";
  facts: {
    listing: Fact<{ listedFor?: Mode; price: number | null; listingDate: string | null; bedrooms: number | null; bathrooms: number | null; parking: number | null; buildingSize: number | null; propertyType: string | null; address: string }>;
    agentQuoting: Fact<{
      agency_name?: string | null;
      cohort?: string | null;
      median_deviation_pct?: number | null;
      underquote_rate_pct?: number | null;
      total_sales?: number | null;
      asking_price?: number | null;
      likely_sale_price?: number | null;
      recent_sales?: { address?: string | null; guide_price?: number | null; sold_price?: number | null; diff_pct?: number | null; sold_date?: string | null }[];
    }>;
    avm: Fact<{ predicted_price: number; predicted_price_low?: number | null; predicted_price_high?: number | null; confidence_score?: number | null }>;
    cma: Fact<Comparable & { latitude?: number | null; longitude?: number | null }>;
    comparables: Fact<{ address?: string | null; price?: number | null; date_sold?: string | null; dist_km?: number | null; bedrooms?: number | null; bathrooms?: number | null }[]>;
    rentHistory: Fact<History[]>;
  } | null;
  verdict?: Verdict;
  rent?: Fact<RentEstimate> | null;
  alternatives?: AlternativesResult | null;
  insights?: {
    street: {
      street: string;
      label: string;
      thisStreet: { median: number; sales: number } | null;
      suburb: { median: number; sales: number };
      diffPct: number | null;
      nearby: { street: string; median: number; sales: number; distanceM: number; diffPct: number }[];
      source: string;
      asOf: string;
    } | null;
    yield: { marketRent: number; rentSample: number; grossYieldPct: number; suburbYieldPct: number | null; flag: "low" | "typical" | "high"; note: string; sources: string[] } | null;
  };
  generatedAt?: string;
  error?: string;
  message?: string;
}

export async function fetchProperty(address: string, mode: Mode, gnaf?: string, auto = false, price?: number): Promise<PropertyResponse> {
  const q = new URLSearchParams({ address, mode });
  if (auto) q.set("auto", "1");
  if (price) q.set("price", String(price));
  if (gnaf) q.set("gnaf", gnaf);
  const res = await fetch(`${BACKEND_URL}/api/property?${q}`, { headers: CLIENT });
  const body = (await res.json().catch(() => ({}))) as PropertyResponse;
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
  return body;
}

export type Risks = Fact<Record<string, { name?: string | null; value?: string | null; on_property?: boolean | null; nearest_distance_m?: number | null }[] | null>>;
export interface Sections {
  history: { saleHistory: Fact<History[]>; rentHistory: Fact<History[]> };
  transport: { transport: Fact<{ nearest: Record<string, { name?: string | null; label?: string | null; lat?: number | null; lng?: number | null; distance_m?: number | null } | null | undefined> }> };
  schools: { schools: Fact<{ name: string; sector?: string | null; school_level_type?: string | null; distance_m?: number | null }[]> };
  risks: { risks: Risks };
  block: {
    block: Fact<{
      meshBlock: string;
      street: string | null;
      homes: number | null;
      rentedPct: number | null;
      investorPct: number | null;
      growthPctPerYear: number | null;
      area: { blocks: number; rentedPct: number | null; investorPct: number | null; growthPctPerYear: number | null };
    }>;
  };
}

export const fetchDevelopments = (suburb: string) =>
  getJson<{ total?: number; lastTwelveMonths?: number; note?: string; source?: string; recent?: { date?: string; category?: string; description?: string }[] }>(
    `/api/developments?${new URLSearchParams({ suburb })}`,
  );

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, { headers: CLIENT });
  if (!res.ok) {
    // Show the backend's own message (rate limit, quota, maintenance) instead of a bare status code.
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Secondary sections load only when the user opens them. */
export const fetchSection = <K extends keyof Sections>(gnaf: string, name: K) =>
  getJson<Sections[K]>(`/api/section?${new URLSearchParams({ gnaf, name })}`);

export interface SuburbPulse {
  suburb: string;
  mode: Mode;
  indicators: Record<string, Fact<Record<string, unknown>>>;
}
export const fetchSuburbPulse = (suburb: string, mode: Mode) => getJson<SuburbPulse>(`/api/suburb?${new URLSearchParams({ suburb, mode })}`);

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askAgent(address: string, mode: Mode, messages: ChatTurn[], gnaf?: string, price?: number) {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { ...CLIENT, "content-type": "application/json" },
    body: JSON.stringify({ address, mode, messages, gnaf, price }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    answer?: string;
    alternatives?: { items: Alternative[]; seeAllUrl: string } | null;
    message?: string;
  };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
  return body;
}
