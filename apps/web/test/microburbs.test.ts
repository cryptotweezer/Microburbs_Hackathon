// Unit tests for the Microburbs client: allowlist, retries, no-data envelope, User-Agent.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Avm } from "@mb/contracts";
import { createClient, isAllowedPath, MicroburbsError } from "../lib/microburbs";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const mk = (fetchImpl: typeof fetch) =>
  createClient({ apiKey: "k", baseUrl: "https://x.test", fetchImpl, sleep: async () => {} });

describe("microburbs client", () => {
  it("parses data and reports cost", async () => {
    const f = vi.fn(async () => json(200, { data: { predicted_price: 1 } }, { "x-cost-cents": "10" }));
    const r = await mk(f as unknown as typeof fetch).get("/v1/properties/G1/valuation/avm", Avm);
    expect(r).toMatchObject({ available: true, costCents: 10 });
    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/microburbs-listing-lens/);
  });

  it("maps data:null envelope to unavailable", async () => {
    const f = vi.fn(async () => json(200, { data: null, available: false, reason: "no_data" }));
    const r = await mk(f as unknown as typeof fetch).get("/v1/properties/G1/valuation/avm", Avm);
    expect(r).toMatchObject({ available: false, reason: "no_data" });
  });

  it("retries 429 then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(200, { data: [] }));
    const r = await mk(f as unknown as typeof fetch).get("/v1/properties/G1/sale-history", z.array(z.unknown()));
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.available).toBe(true);
  });

  it("does not retry 403", async () => {
    const f = vi.fn(async () => json(403, {}));
    await expect(mk(f as unknown as typeof fetch).get("/v1/me", z.unknown())).rejects.toBeInstanceOf(MicroburbsError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rejects paths outside the allowlist", async () => {
    expect(isAllowedPath("/v1/properties/G1/title")).toBe(false);
    expect(isAllowedPath("/v1/properties/G1/../me")).toBe(false);
    await expect(mk(vi.fn() as unknown as typeof fetch).get("/v1/admin", z.unknown())).rejects.toThrow(/not allowed/);
  });
});
