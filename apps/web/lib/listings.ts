// City-wide index of active listings, one Microburbs call per suburb and mode, cached for the day.
import { ListingsPage, type ListingRow, type Mode, type Sal } from "@mb/contracts";
import { type Cache, cached } from "./cache";
import type { MicroburbsClient } from "./microburbs";

export const LISTINGS_TTL_S = 12 * 60 * 60;
const LIMIT = 500;

export interface SuburbListings {
  suburb: Sal;
  mode: Mode;
  fetchedAt: string;
  total: number;
  rows: ListingRow[];
}

export function getSuburbListings(mb: MicroburbsClient, cache: Cache, suburb: Sal, mode: Mode): Promise<SuburbListings> {
  return cached(cache, `listings:v1:${mode}:${suburb}`, LISTINGS_TTL_S, async () => {
    const path = `/v1/suburbs/${encodeURIComponent(suburb)}/listings/${mode === "sale" ? "for-sale" : "for-rent"}`;
    const r = await mb.get(path, ListingsPage, { limit: LIMIT });
    return {
      suburb,
      mode,
      fetchedAt: new Date().toISOString(),
      total: r.available ? r.data.total : 0,
      rows: r.available ? r.data.results : [],
    };
  });
}
