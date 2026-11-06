// Resolves a raw portal address to an exact G-NAF property, or says it cannot.
// Rule: never accept a candidate unless suburb, street number, street and unit all match.
import { z } from "zod";
import {
  type AddressMatch,
  addressKey,
  buildingKey,
  GeocodeCandidate,
  looseKey,
  type ListingRow,
  type Mode,
  parseAddress,
  swappedUnit,
  toGnafQuery,
} from "@mb/contracts";
import { type Cache, cached } from "./cache";
import { getSuburbListings } from "./listings";
import type { MicroburbsClient } from "./microburbs";

export interface Resolution {
  match: AddressMatch;
  /** The active listing row for this property, when it is in the listings index. */
  listing: (ListingRow & { mode: Mode }) | null;
}

const GEOCODE_TTL_S = 7 * 24 * 60 * 60;

export async function resolveAddress(
  raw: string,
  deps: { mb: MicroburbsClient; cache: Cache },
  opts: { mode?: Mode; suburbHint?: string | null; useIndex?: boolean } = {},
): Promise<Resolution> {
  const p = parseAddress(raw, opts.suburbHint);
  const base = {
    input: raw,
    normalized: toGnafQuery(p) ?? raw,
    gnafId: null,
    suburb: p.suburb,
    matchedAddress: null,
    candidates: [],
  };

  if (p.withheld) return { match: { ...base, status: "withheld", note: "The listing hides its street address." }, listing: null };
  if (!p.suburb) return { match: { ...base, status: "unsupported", note: "Outside the 29 City of Sydney suburbs." }, listing: null };
  const key = addressKey(p);
  const bKey = buildingKey(p);
  if (!key || !bKey) return { match: { ...base, status: "ambiguous", note: "Could not read a street number and name." }, listing: null };

  // 1) Active listings index: exact G-NAF rows, no geocoder involved.
  const modes: Mode[] = opts.mode === "rent" ? ["rent", "sale"] : ["sale", "rent"];
  const lKey = looseKey(p);
  const buildingRows: ListingRow[] = [];
  const looseRows: (ListingRow & { mode: Mode })[] = [];
  for (const mode of opts.useIndex === false ? [] : modes) {
    const idx = await getSuburbListings(deps.mb, deps.cache, p.suburb, mode);
    for (const row of idx.rows) {
      const rp = parseAddress(row.address.street, row.address.sal);
      if (addressKey(rp) === key) {
        return {
          match: { ...base, status: "exact-unit", gnafId: row.gnaf_pid, matchedAddress: `${row.address.street}, ${p.suburb}` },
          listing: { ...row, mode },
        };
      }
      if (buildingKey(rp) === bKey) buildingRows.push(row);
      if (lKey && looseKey(rp) === lKey && !looseRows.some((r) => r.gnaf_pid === row.gnaf_pid)) looseRows.push({ ...row, mode });
    }
  }
  if (looseRows.length === 1) {
    const row = looseRows[0]!;
    return {
      match: { ...base, status: "exact-unit", gnafId: row.gnaf_pid, matchedAddress: `${row.address.street}, ${p.suburb}`, note: "Matched with a street number range." },
      listing: row,
    };
  }

  // 2) Geocoder fallback, validated field by field.
  const geocode = (q: string) =>
    cached(deps.cache, `geocode:v1:${q.toLowerCase()}`, GEOCODE_TTL_S, async () => {
      const r = await deps.mb.get("/v1/geocode/address", z.array(GeocodeCandidate), { address: q });
      return r.available ? r.data : [];
    });
  const isExact = (c: GeocodeCandidate) => addressKey(parseAddress(c.display_name ?? c.name)) === key;
  let candidates = await geocode(toGnafQuery(p)!);
  // Lettered units have two spellings ("B401" / "401B"); try the other one before giving up.
  const alt = swappedUnit(p.unit);
  if (!candidates.some(isExact) && alt) candidates = [...candidates, ...(await geocode(toGnafQuery({ ...p, unit: alt })!))];
  let exact = candidates.find(isExact);
  if (!exact && lKey) {
    const loose = candidates.filter((c) => looseKey(parseAddress(c.display_name ?? c.name)) === lKey);
    if (loose.length === 1) exact = loose[0];
  }
  if (exact) {
    return {
      match: { ...base, status: "exact-unit", gnafId: exact.id, matchedAddress: exact.display_name ?? exact.name },
      listing: null,
    };
  }

  // 3) Suburb boundary: portals sometimes use the neighbouring suburb (REA "Pyrmont", G-NAF "Sydney").
  // Accept only when unit, number and street match exactly, the G-NAF suburb is also in the City of Sydney,
  // and exactly one candidate qualifies. The match note tells the user.
  if (p.unit) {
    const noSuburb = (k: string | null) => k?.split("|").slice(0, 3).join("|") ?? null;
    const border = candidates.filter((c) => {
      const cp = parseAddress(c.display_name ?? c.name);
      return cp.suburb && cp.suburb !== p.suburb && noSuburb(addressKey(cp)) === noSuburb(key);
    });
    if (border.length === 1) {
      const c = border[0]!;
      const sal = parseAddress(c.display_name ?? c.name).suburb!;
      let listing: Resolution["listing"] = null;
      for (const mode of opts.useIndex === false ? [] : modes) {
        const row = (await getSuburbListings(deps.mb, deps.cache, sal, mode)).rows.find((r) => r.gnaf_pid === c.id);
        if (row) {
          listing = { ...row, mode };
          break;
        }
      }
      return {
        match: {
          ...base,
          status: "exact-unit",
          gnafId: c.id,
          suburb: sal,
          matchedAddress: c.display_name ?? c.name,
          note: `The listing says ${p.suburb.replace(/\s*\(.*\)$/, "")}; the official address register (G-NAF) places it in ${sal.replace(/\s*\(.*\)$/, "")}.`,
        },
        listing,
      };
    }
  }

  const sameBuilding = candidates.filter((c) => buildingKey(parseAddress(c.display_name ?? c.name)) === bKey);
  const listed = candidates.slice(0, 5).map((c) => ({ id: c.id, name: c.display_name ?? c.name }));
  if (!p.unit && (sameBuilding.length > 0 || buildingRows.length > 0)) {
    return {
      match: { ...base, status: "exact-building", candidates: listed, note: "Building found, but the listing does not show a unit number." },
      listing: null,
    };
  }
  return {
    match: { ...base, status: "ambiguous", candidates: listed, note: "No candidate matched the exact unit, street and suburb." },
    listing: null,
  };
}
