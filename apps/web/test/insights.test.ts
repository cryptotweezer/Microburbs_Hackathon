// Unit tests for the street check (this street vs suburb vs nearby streets).
import { describe, expect, it } from "vitest";
import { streetCheckFrom } from "../lib/insights";

const sale = (address: string, price: number, lat = -33.87, lng = 151.19, bedrooms = 2) => ({
  gnaf_pid: address, address, property_type: "Unit", bedrooms, sold_price: price, sold_date: "2026-01-01", lat, lng,
});

describe("streetCheckFrom", () => {
  const sales = [
    ...[800, 820, 840, 860].map((k, i) => sale(`Unit ${i}, 10 Cheap Street`, k * 1000)),
    ...[1700, 1800, 1900].map((k, i) => sale(`Unit ${i}, 5 Dear Street`, k * 1000, -33.8718, 151.19)),
    ...Array.from({ length: 10 }, (_, i) => sale(`Unit ${i}, 1 Other Road`, 1_200_000 + i * 10_000, -33.9, 151.3)),
  ];
  const target = { suburb: "Pyrmont" as const, bedrooms: 2, propertyType: "Unit", lat: -33.87, lng: 151.19 };

  it("compares this street with the suburb and lists close streets only", () => {
    const r = streetCheckFrom(target, "Cheap Street", sales, "2026-11-06T00:00:00Z")!;
    expect(r.thisStreet).toEqual({ median: 830000, sales: 4 });
    expect(r.diffPct).toBeLessThan(-20);
    expect(r.nearby.map((n) => n.street)).toEqual(["Dear Street"]); // Other Road is km away
    expect(r.nearby[0]!.diffPct).toBeGreaterThan(30);
  });

  it("returns no street figure with fewer than 3 sales on it", () => {
    const r = streetCheckFrom(target, "Missing Lane", sales, "2026-11-06T00:00:00Z")!;
    expect(r.thisStreet).toBeNull();
    expect(r.diffPct).toBeNull();
  });
});
