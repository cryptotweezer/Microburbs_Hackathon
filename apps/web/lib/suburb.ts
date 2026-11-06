// "Suburb pulse": market context shared by every property in a suburb, cached for a day.
import { type Fact, type Mode, type Sal, SuburbIndicator } from "@mb/contracts";
import type { Cache } from "./cache";
import { MicroburbsError, type MicroburbsClient } from "./microburbs";

const TTL_S = 24 * 60 * 60;
const NS = process.env.CACHE_NAMESPACE ?? "dev";
type Indicator = Record<string, unknown>;

const SALE = ["market/days-on-market", "market/stock-on-market", "market/months-of-supply", "market/strata-levies", "crime/summary"];
const RENT = ["market/vacancy-rate", "market/yield-pct", "market/days-on-market", "market/strata-levies", "crime/summary"];

export async function indicator(deps: { mb: MicroburbsClient; cache: Cache }, suburb: Sal, endpoint: string): Promise<Fact<Indicator>> {
  const source = `/v1/suburbs/{suburb}/${endpoint}`;
  const key = `suburb:${NS}:${endpoint}:${suburb}`;
  const hit = await deps.cache.get<{ data: Indicator | null; reason?: string; fetchedAt: string }>(key);
  const stored =
    hit ??
    (await (async () => {
      try {
        const r = await deps.mb.get(`/v1/suburbs/${encodeURIComponent(suburb)}/${endpoint}`, SuburbIndicator);
        const v = { data: r.available ? r.data : null, reason: r.available ? undefined : r.reason, fetchedAt: new Date().toISOString() };
        await deps.cache.set(key, v, r.available ? TTL_S : 120);
        return v;
      } catch (e) {
        return { data: null, reason: e instanceof MicroburbsError && e.status === 402 ? "no_credit" : "error", fetchedAt: "" };
      }
    })());
  if (!stored.data) return { available: false, value: null, source, asOf: null, reason: stored.reason ?? "no_data" };
  const asOf = typeof stored.data.as_of === "string" ? stored.data.as_of : stored.fetchedAt.slice(0, 10);
  return { available: true, value: stored.data, source, asOf };
}

export async function getSuburbPulse(deps: { mb: MicroburbsClient; cache: Cache }, suburb: Sal, mode: Mode) {
  const list = mode === "rent" ? RENT : SALE;
  const facts = await Promise.all(list.map((e) => indicator(deps, suburb, e)));
  return { suburb, mode, indicators: Object.fromEntries(list.map((e, i) => [e.split("/")[1]!, facts[i]!])) };
}
