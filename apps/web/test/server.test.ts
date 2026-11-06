// Abuse-control tests for the shared guard: per-IP and chat limits, spend cap, kill switch and origins.
import { beforeEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  return import("../lib/server");
}
const req = (ip: string, headers: Record<string, string> = {}) =>
  new Request("http://x/api/property", { headers: { "x-forwarded-for": ip, "x-listing-lens": "1", ...headers } });

describe("guard", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("rate limits one IP per minute without affecting another", async () => {
    const s = await load({ RATE_LIMIT_PER_MIN: "5" });
    for (let i = 0; i < 5; i++) expect(await s.guard(req("1.1.1.1"))).toBeNull();
    expect((await s.guard(req("1.1.1.1")))!.status).toBe(429);
    expect(await s.guard(req("2.2.2.2"))).toBeNull();
  });

  it("gives the chat its own, stricter limit", async () => {
    const s = await load({ CHAT_LIMIT_PER_MIN: "2" });
    expect(await s.guard(req("3.3.3.3"), "chat")).toBeNull();
    expect(await s.guard(req("3.3.3.3"), "chat")).toBeNull();
    const r = (await s.guard(req("3.3.3.3"), "chat"))!;
    expect(r.status).toBe(429);
    expect(await s.guard(req("3.3.3.3"))).toBeNull(); // data routes still work
  });

  it("stops everything once the daily spend cap in cents is reached", async () => {
    const s = await load({ DAILY_SPEND_CENTS: "100" });
    const { cache, day } = s.getDeps();
    await cache.incrBy(`spend:mb:${day()}`, 100, 60);
    const r = (await s.guard(req("4.4.4.4")))!;
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("quota_exhausted");
    await expect(s.getDeps().mb.get("/v1/me" as never, {} as never)).rejects.toMatchObject({ status: 503 });
  });

  it("caps paid upstream calls per request", async () => {
    const s = await load({ PAID_CALLS_PER_REQUEST: "0" });
    expect(await s.guard(req("5.5.5.5"))).toBeNull();
    await expect(s.getDeps().mb.get("/v1/me" as never, {} as never)).rejects.toMatchObject({ status: 429 });
  });

  it("MAINTENANCE=1 turns paid routes off", async () => {
    const s = await load({ MAINTENANCE: "1" });
    expect((await s.guard(req("6.6.6.6")))!.status).toBe(503);
  });

  it("in production allows only the pinned extension and requires the client header", async () => {
    const ext = "chrome-extension://edgmigmfohaclnlempjiailbeokgnhlm";
    const s = await load({ NODE_ENV: "production", EXTENSION_ORIGIN: ext });
    expect(await s.guard(req("7.7.7.1", { origin: ext }))).toBeNull();
    expect((await s.guard(req("7.7.7.2", { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })))!.status).toBe(403);
    expect((await s.guard(req("7.7.7.3", { origin: "https://evil.example" })))!.status).toBe(403);
    expect((await s.guard(new Request("http://x/", { headers: { "x-forwarded-for": "7.7.7.4" } })))!.status).toBe(403);
    expect(s.corsHeaders(req("7.7.7.5", { origin: "https://evil.example" }))["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
