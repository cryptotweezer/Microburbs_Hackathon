// Unit tests for the alternatives ranking, value benchmark and portal links.
import { describe, expect, it } from "vitest";
import { domainProfileUrl, domainSearchUrl, rankAlternatives, type Target } from "../lib/alternatives";

const target: Target = {
  gnafId: "T",
  suburb: "Pyrmont",
  mode: "sale",
  price: 1_000_000,
  bedrooms: 2,
  bathrooms: 1,
  parking: 1,
  buildingSize: 100,
  propertyType: "Unit",
  lat: -33.87,
  lng: 151.19,
};

type Attrs = Partial<{ bedrooms: number; bathrooms: number; garage_spaces: number; building_size: number }>;
const row = (id: string, price: number | null, a: Attrs = {}, type = "Unit") => ({
  gnaf_pid: id,
  area_name: `Unit 1, 10 Harris Street`,
  address: { street: `Unit 1, 10 Harris Street`, sal: "Pyrmont", sa1: null, state: "NSW" },
  attributes: { bedrooms: 2, bathrooms: 1, garage_spaces: 1, building_size: 100, land_size: null, description: null, ...a },
  coordinates: { latitude: -33.871, longitude: 151.191 },
  listing_date: "2026-10-20",
  price,
  property_type: type,
  property_type_raw: type.toLowerCase(),
  off_market: false,
});

describe("rankAlternatives", () => {
  it("keeps only cheaper, like-for-like listings, biggest saving first", () => {
    const out = rankAlternatives(target, [
      row("A", 950_000),
      row("B", 850_000),
      row("C", 1_100_000),
      row("D", null),
      row("E", 800_000, { bedrooms: 3 }),
      row("F", 800_000, { garage_spaces: 0 }),
      row("G", 800_000, {}, "House"),
      row("H", 400_000),
      row("T", 500_000),
      row("I", 900_000, { building_size: 60 }),
    ]);
    expect(out.map((a) => a.gnafId)).toEqual(["B", "A"]);
    expect(out[0]).toMatchObject({ saving: 150_000, savingPct: 15 });
    expect(out[0]!.reasons.join(" ")).toMatch(/below this listing/);
  });

  it("lets the agent relax filters (no parking, lower ceiling)", () => {
    const out = rankAlternatives(target, [row("F", 800_000, { garage_spaces: 0 }), row("A", 950_000)], {
      minParking: 0,
      maxPrice: 900_000,
    });
    expect(out.map((a) => a.gnafId)).toEqual(["F"]);
  });

  it("builds Domain links", () => {
    expect(domainProfileUrl("Unit 15, 2-26 Wattle Crescent", "Pyrmont")).toBe(
      "https://www.domain.com.au/property-profile/15-2-26-wattle-crescent-pyrmont-nsw-2009",
    );
    expect(domainSearchUrl({ suburb: "Glebe (NSW)", mode: "rent", bedrooms: 2, propertyType: "Unit" }, 900)).toBe(
      "https://www.domain.com.au/rent/glebe-nsw-2037/?ptype=apartment-unit-flat&bedrooms=2-2&price=0-900&excludedeposittaken=1",
    );
  });
});
