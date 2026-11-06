// Unit tests for exact address matching: index first, validated geocode, suburb-border rule.
import { describe, expect, it } from "vitest";
import { memoryCache } from "../lib/cache";
import { createClient } from "../lib/microburbs";
import { resolveAddress } from "../lib/resolve";

const row = (gnaf: string, street: string, sal = "Pyrmont") => ({
  gnaf_pid: gnaf,
  area_name: street,
  address: { street, sal, sa1: "1", state: "NSW" },
  attributes: { bedrooms: 2, bathrooms: 1, garage_spaces: 1, building_size: 80, land_size: 80, description: null },
  coordinates: { latitude: -33.87, longitude: 151.19 },
  listing_date: "2026-10-01",
  price: 900000,
  property_type: "Unit",
  property_type_raw: "unit",
  off_market: false,
});

function fakeApi(geocode: { id: string; name: string; display_name: string }[] = []) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    let data: unknown;
    if (u.pathname.endsWith("/for-sale")) data = { total: 2, results: [row("G15", "Unit 15, 2-26 Wattle Crescent"), row("G16", "Unit 16, 2-26 Wattle Crescent")] };
    else if (u.pathname.endsWith("/for-rent")) data = { total: 0, results: [] };
    else data = geocode.map((g) => ({ ...g, typ: "addr", abbr: "", property_type: "unit" }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  const mb = createClient({ apiKey: "k", baseUrl: "https://x.test", fetchImpl, sleep: async () => {} });
  return { deps: { mb, cache: memoryCache() }, calls };
}

describe("resolveAddress", () => {
  it("matches a REA-style address against the listings index without geocoding", async () => {
    const { deps, calls } = fakeApi();
    const r = await resolveAddress("15/2-26 Wattle Cres, Pyrmont NSW 2009", deps);
    expect(r.match).toMatchObject({ status: "exact-unit", gnafId: "G15" });
    expect(r.listing?.price).toBe(900000);
    expect(calls.some((c) => c.includes("geocode"))).toBe(false);
  });

  it("rejects a geocode candidate from another state (Burleigh Heads case)", async () => {
    const { deps } = fakeApi([{ id: "QLD1", name: "Unit A10, 50-60 The Esplanade", display_name: "Unit A10, 50-60 The Esplanade, Burleigh Heads QLD" }]);
    const r = await resolveAddress("Unit A10, 14 Quarry Master Drive, Pyrmont", deps);
    expect(r.match.status).toBe("ambiguous");
    expect(r.match.gnafId).toBeNull();
  });

  it("accepts a geocode candidate only when every field matches", async () => {
    const { deps } = fakeApi([
      { id: "WRONG", name: "Unit 4, 14 Quarry Master Drive", display_name: "Unit 4, 14 Quarry Master Drive, Pyrmont" },
      { id: "RIGHT", name: "Unit A10, 14 Quarry Master Drive", display_name: "Unit A10, 14 Quarry Master Drive, Pyrmont" },
    ]);
    const r = await resolveAddress("A10/14 Quarry Master Dr, Pyrmont NSW 2009", deps);
    expect(r.match).toMatchObject({ status: "exact-unit", gnafId: "RIGHT" });
  });

  it("matches a street range only when the loose candidate is unique", async () => {
    const { deps } = fakeApi([
      { id: "R1", name: "Unit 3, 60-62 Foveaux Street", display_name: "Unit 3, 60-62 Foveaux Street, Surry Hills" },
    ]);
    const r = await resolveAddress("3/60 Foveaux St, Surry Hills NSW 2010", deps, { useIndex: false });
    expect(r.match).toMatchObject({ status: "exact-unit", gnafId: "R1" });

    const two = fakeApi([
      { id: "R1", name: "Unit 3, 60-62 Foveaux Street", display_name: "Unit 3, 60-62 Foveaux Street, Surry Hills" },
      { id: "R2", name: "Unit 3, 60-64 Foveaux Street", display_name: "Unit 3, 60-64 Foveaux Street, Surry Hills" },
    ]);
    expect((await resolveAddress("3/60 Foveaux St, Surry Hills", two.deps, { useIndex: false })).match.status).toBe("ambiguous");
  });

  it("returns exact-building when the unit is not shown", async () => {
    const { deps } = fakeApi();
    const r = await resolveAddress("2-26 Wattle Cres, Pyrmont NSW 2009", deps);
    expect(r.match.status).toBe("exact-building");
  });

  it("flags withheld and unsupported addresses without calling the API", async () => {
    const { deps, calls } = fakeApi();
    expect((await resolveAddress("Address available on request, Pyrmont", deps)).match.status).toBe("withheld");
    expect((await resolveAddress("1/2 Alfred St, Milsons Point NSW 2061", deps)).match.status).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });

  it("accepts a unique exact match across a City of Sydney suburb border, with a note", async () => {
    const { deps } = fakeApi([
      { id: "SYD1506", name: "Unit 1506, 50 Murray Street, Sydney", display_name: "Unit 1506, 50 Murray Street, Sydney" },
      { id: "QLD1506", name: "Unit 1506, 50 Longland Street, Newstead (Qld)", display_name: "Unit 1506, 50 Longland Street, Newstead (Qld)" },
    ]);
    const r = await resolveAddress("1506/50 Murray Street, Pyrmont, NSW 2009", deps);
    expect(r.match).toMatchObject({ status: "exact-unit", gnafId: "SYD1506", suburb: "Sydney" });
    expect(r.match.note).toMatch(/places it in Sydney/);
  });

  it("does not cross a suburb border for a different unit or outside the City of Sydney", async () => {
    const { deps } = fakeApi([
      { id: "SYD1507", name: "Unit 1507, 50 Murray Street, Sydney", display_name: "Unit 1507, 50 Murray Street, Sydney" },
      { id: "BON1506", name: "Unit 1506, 50 Murray Street, Bondi", display_name: "Unit 1506, 50 Murray Street, Bondi" },
    ]);
    const r = await resolveAddress("1506/50 Murray Street, Pyrmont, NSW 2009", deps);
    expect(r.match.status).toBe("ambiguous");
  });
});
