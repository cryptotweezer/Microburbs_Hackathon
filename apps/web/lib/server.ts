// Shared request plumbing for route handlers: dependencies, CORS, rate limits and errors.
import { getCache } from "./cache";
import { createClient } from "./microburbs";

const PER_IP_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 20);
const DAILY_MB_CALLS = Number(process.env.DAILY_MICROBURBS_CALLS ?? 3000);

let deps: ReturnType<typeof buildDeps> | null = null;
function buildDeps() {
  const cache = getCache();
  const day = () => new Date().toISOString().slice(0, 10);
  const mb = createClient({
    onCost: () => {
      // Count every upstream call against a global daily quota (fire and forget).
      void cache.incr(`quota:mb:${day()}`, 26 * 60 * 60).catch(() => {});
    },
  });
  return { cache, mb, day };
}
export function getDeps() {
  return (deps ??= buildDeps());
}

/** Allows the Chrome extension and local development; nothing else. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = process.env.EXTENSION_ORIGIN
    ? origin === process.env.EXTENSION_ORIGIN
    : origin.startsWith("chrome-extension://");
  const ok = allowed || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return ok
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" }
    : {};
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Returns a 429/503 response when the caller or the global quota is over the limit. */
export async function guard(req: Request): Promise<Response | null> {
  const { cache, day } = getDeps();
  const minute = Math.floor(Date.now() / 60_000);
  const n = await cache.incr(`rl:${clientIp(req)}:${minute}`, 70);
  if (n > PER_IP_PER_MIN) return json(req, { error: "rate_limited", message: "Too many requests. Try again in a minute." }, 429);
  const used = (await cache.get<number>(`quota:mb:${day()}`)) ?? 0;
  if (used > DAILY_MB_CALLS) return json(req, { error: "quota_exhausted", message: "Daily data quota reached. Try again tomorrow." }, 503);
  return null;
}

export function readMode(v: string | null) {
  return v === "rent" ? "rent" : "sale";
}
