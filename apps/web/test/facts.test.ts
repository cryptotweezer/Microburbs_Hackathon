// Unit tests for fact blocks: failure isolation, mode guards, sanitising agency prices, user-entered prices.
import { describe, expect, it } from "vitest";
import { memoryCache } from "../lib/cache";
import { getPropertyFacts } from "../lib/facts";
import { createClient } from "../lib/microburbs";

function deps(handler: (path: string) => Response | Promise<Response>) {
  const fetchImpl = (async (url: string) => handler(new URL(url).pathname)) as unknown as typeof fetch;
  return { mb: createClient({ apiKey: "k", baseUrl: "https://x.test", fetchImpl, sleep: async () => {} }), cache: memoryCache() };
}
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

describe("getPropertyFacts", () => {
  it("marks data:null blocks unavailable and keeps the rest", async () => {
    const d = deps((p) => {
      if (p.endsWith("/valuation/avm")) return new Response(JSON.stringify({ data: null, available: false, reason: "no_data" }));
      if (p.endsWith("/cma-single-comp")) throw new Error("timeout");
      if (p.endsWith("/agent-quoting")) return new Response("{}", { status: 403 });
      if (p.endsWith("/comparables/recent-sales-nearby"))
        return ok([
          { gnaf_pid: "C1", price: 1, bedrooms: 2, date_sold: "2026-01-01" },
          { gnaf_pid: "C2", price: 1, bedrooms: 3, date_sold: "2026-02-01" },
        ]);
      if (p.endsWith("/basics/all")) return ok({ bed_count: 2 });
      return ok([{ date: "2026-10-01", price: 5, type: "Sold" }]);
    });
    const f = await getPropertyFacts(d, "G1", "sale", null, null);
    expect(f.avm).toMatchObject({ available: false, reason: "no_data" });
    expect(f.cma).toMatchObject({ available: false, reason: "error" });
    expect(f.agentQuoting).toMatchObject({ available: false, reason: "forbidden" });
    expect(f.rentHistory.reason).toBe("not_for_sale");
    expect(f.comparables.value?.map((c) => c.gnaf_pid)).toEqual(["C1"]);
  });

  it("skips agent-quoting for rentals", async () => {
    const d = deps(() => ok([]));
    const f = await getPropertyFacts(d, "G1", "rent", null, null);
    expect(f.agentQuoting.reason).toBe("not_for_rent");
  });

  it("never shows a sale price as a rent", async () => {
    const d = deps(() => ok([]));
    const listing = {
      gnaf_pid: "G1", area_name: "Unit 1, 1 X Street", address: { street: "Unit 1, 1 X Street", sal: "Pyrmont" },
      attributes: { bedrooms: 2, bathrooms: 1, garage_spaces: 1, building_size: 80 }, price: 1_950_000, property_type: "Unit", mode: "sale" as const,
    };
    const f = await getPropertyFacts(d, "G1", "rent", listing as never, null);
    expect(f.listing.value).toMatchObject({ price: null, listedFor: "sale", bedrooms: 2 });
  });

  it("drops implausible agency prices", async () => {
    const d = deps((p) => {
      if (p.endsWith("/agent-quoting")) return ok({ agency_name: "A", asking_price: 50000, likely_sale_price: 49520, total_sales: 4, recent_sales: [] });
      if (p.endsWith("/cma-single-comp")) return ok({ price: 2675000, date_sold: "2026-08-19" });
      return ok(null);
    });
    const f = await getPropertyFacts(d, "G1", "sale", null, null);
    expect(f.agentQuoting.value).toMatchObject({ agency_name: "A", likely_sale_price: null, asking_price: null });
  });

  it("uses a price typed by the user only when Microburbs has none, and labels it", async () => {
    const { applyUserPrice, parseUserPrice } = await import("../lib/facts");
    expect(parseUserPrice("$1,800,000", "sale")).toBe(1800000);
    expect(parseUserPrice("50000", "sale")).toBeNull();
    expect(parseUserPrice("950", "rent")).toBe(950);
    const d = deps(() => ok(null));
    const f = await getPropertyFacts(d, "G1", "sale", null, null);
    const withPrice = applyUserPrice(f, "sale", 1800000);
    expect(withPrice.listing).toMatchObject({ available: true, userPrice: true, value: { price: 1800000 } });
    expect(applyUserPrice(withPrice, "sale", 999999).listing.value?.price).toBe(1800000);
  });
});
