// Compares the asking price with an independent value estimate and says below / in line / above.
import type { PropertyFacts } from "./facts";
import type { Mode } from "@mb/contracts";

export interface Verdict {
  label: "below" | "in-line" | "above" | "unknown";
  asking: number | null;
  askingSource: string | null;
  estimate: number | null;
  low: number | null;
  high: number | null;
  method: "avm" | "cma" | "comparables" | "agent-quoting" | "rent-model" | "market-rent" | null;
  diffPct: number | null;
  /** "low" when the estimate comes from a handful of nearby sales rather than a model. */
  confidence: "model" | "low" | null;
  sources: string[];
  note: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : null;
};

const BAND = 0.05;
const threeYearsAgo = () => new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);

export interface MarketRent {
  value: number;
  sample: number;
  low: number;
  high: number;
  label: string;
}

export function priceVerdict(mode: Mode, f: PropertyFacts, fairRent: number | null = null, market: MarketRent | null = null): Verdict {
  const asking = f.listing.value?.price ?? null;
  const base = { asking, askingSource: asking ? f.listing.source : null, low: null, high: null, sources: [] as string[] };

  let estimate: number | null = null;
  let method: Verdict["method"] = null;
  let low: number | null = null;
  let high: number | null = null;
  const sources: string[] = [];

  if (mode === "rent") {
    if (fairRent) {
      estimate = fairRent;
      method = "rent-model";
      sources.push("Our rent model (Task 4), trained on leases up to 2026-07-31");
    } else if (market) {
      estimate = market.value;
      low = market.low;
      high = market.high;
      method = "market-rent";
      sources.push(`/v1/suburbs/{suburb}/listings/for-rent: median of ${market.sample} active ${market.label}`);
    }
  } else if (f.avm.available && f.avm.value) {
    estimate = f.avm.value.predicted_price;
    low = f.avm.value.predicted_price_low ?? null;
    high = f.avm.value.predicted_price_high ?? null;
    method = "avm";
    sources.push(`${f.avm.source} (${f.avm.asOf})`);
  } else if (f.cma.available && f.cma.value?.price && f.cma.value.date_sold && f.cma.value.date_sold >= threeYearsAgo()) {
    // Microburbs' best comparable sale (often a unit in the same building).
    estimate = f.cma.value.price;
    method = "cma";
    const c = f.cma.value;
    sources.push(`${f.cma.source}: ${c.street ?? "comparable"}${c.same_building ? " (same building)" : ""}, sold ${c.date_sold}`);
  } else if (f.comparables.value && f.comparables.value.length >= 2) {
    estimate = median(f.comparables.value.map((c) => c.price!).filter(Boolean));
    method = "comparables";
    sources.push(`${f.comparables.source}: median of ${f.comparables.value.length} similar recent sales`);
  }

  if (!asking && mode === "sale" && f.agentQuoting.value?.likely_sale_price) {
    return {
      ...base,
      label: "unknown",
      estimate: estimate ?? f.agentQuoting.value.likely_sale_price,
      low,
      high,
      method: method ?? "agent-quoting",
      diffPct: null,
      confidence: "model",
      sources: [...sources, f.agentQuoting.source],
      note: "Microburbs has no asking price for this listing. The estimate is the likely sale price from this agency's track record.",
    };
  }
  if (!asking || !estimate) {
    return { ...base, label: "unknown", estimate, low, high, method, diffPct: null, confidence: null, sources, note: !asking
        ? f.listing.value && f.listing.value.listedFor !== mode
          ? `This property is listed ${f.listing.value.listedFor === "sale" ? "for sale" : "for rent"}, so there is no asking ${mode === "rent" ? "rent" : "price"} to check.`
          : f.listing.reason === "not_in_active_listings"
          ? "This listing is not in Microburbs' current listings yet, so there is no asking price in the data to check."
          : "Microburbs has no asking price for this listing (the agency may hide it, or the data lags the portal)."
        : "Not enough data for an independent estimate." };
  }
  // A single comparable sold a while ago, or a median of a few nearby sales, is a rough guide only.
  const confidence = method === "comparables" || method === "cma" || method === "market-rent" ? "low" : method ? "model" : null;
  const diffPct = Math.round(((asking - estimate) / estimate) * 1000) / 10;
  const label = diffPct > BAND * 100 ? "above" : diffPct < -BAND * 100 ? "below" : "in-line";
  const what = mode === "rent" ? "fair rent" : "estimated value";
  const note =
    label === "in-line"
      ? `Asking is within 5% of the ${what}.`
      : `Asking is ${Math.abs(diffPct)}% ${label === "above" ? "above" : "below"} the ${what}.`;
  return { ...base, label, estimate, low, high, method, diffPct, confidence, sources, note:
      confidence === "low"
        ? `${note} Rough guide: ${
            method === "cma"
              ? `based on one comparable sale (${f.cma.value?.date_sold}), not adjusted for time.`
              : method === "market-rent"
                ? `asking rents of ${market?.sample} similar listings, not signed leases.`
                : "based on a few nearby sales."
          }`
        : note };
}
