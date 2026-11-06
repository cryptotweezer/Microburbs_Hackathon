// Schema tests against synthetic fixtures shaped like real Microburbs responses.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as C from "../src";
import { fx } from "./fixtures";

describe("Microburbs schemas parse synthetic fixtures", () => {
  it.each([
    ["geocode", z.array(C.GeocodeCandidate), fx.geocode.data],
    ["listings", C.ListingsPage, fx.listings.data],
    ["agentQuoting", C.AgentQuoting, fx.agentQuoting.data],
    ["avm", C.Avm, fx.avm.data],
    ["history", z.array(C.HistoryEntry), fx.history.data],
    ["comparables", z.array(C.RecentSale), fx.comparables.data],
    ["transport", C.TransportNearby, fx.transport.data],
    ["risks", C.RisksAll, fx.risks.data],
    ["profile", C.Profile, fx.profile.data],
    ["basics", C.Basics, fx.basics.data],
  ] as const)("%s", (_name, schema, data) => {
    expect(() => (schema as z.ZodTypeAny).parse(data)).not.toThrow();
  });

  it("no-data envelope", () => {
    expect(C.NoDataEnvelope.parse(fx.noData).reason).toBe("no_data");
  });

  it("comparables drop duplicated null fields", () => {
    const row = C.RecentSale.parse(fx.comparables.data[0]);
    expect("sale_price" in row).toBe(false);
  });
});
