// Shared request plumbing for route handlers: dependencies, CORS, abuse limits and responses.
//
// Threat model: the backend URL ships inside a public extension, so anyone can call it. A static secret in
// the bundle would be extractable, so the real protection is spending limits, not authentication:
//   - Microburbs spend is capped in cents per day (from X-Cost-Cents), globally and per request.
//   - Requests are limited per IP per minute and per day; the chat (LLM) has its own, stricter limits.
//   - CORS and a custom header block other websites from using a visitor's browser against us.
//   - MAINTENANCE=1 turns every paid route off without a redeploy.
import { AsyncLocalStorage } from "node:async_hooks";
import { getCache } from "./cache";
import { createClient, MicroburbsError, type MicroburbsClient } from "./microburbs";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export const LIMITS = {
  // Generous defaults: a whole venue (judges, team, audience) can share one public IP.
  perIpPerMin: num(process.env.RATE_LIMIT_PER_MIN, 300),
  perIpPerDay: num(process.env.RATE_LIMIT_PER_DAY, 20000),
  chatPerIpPerMin: num(process.env.CHAT_LIMIT_PER_MIN, 40),
  chatPerIpPerDay: num(process.env.CHAT_LIMIT_PER_DAY, 1500),
  chatGlobalPerDay: num(process.env.CHAT_GLOBAL_PER_DAY, 5000),
  /** Hard stop on Microburbs spend for the whole backend, in cents per UTC day. */
  dailySpendCents: num(process.env.DAILY_SPEND_CENTS, 800),
  /** Paid Microburbs calls one request may trigger (cache hits are free and not counted). */
  paidCallsPerRequest: num(process.env.PAID_CALLS_PER_REQUEST, 40),
};

const DAY_S = 26 * 60 * 60;
const day = () => new Date().toISOString().slice(0, 10);

/** Per-request budget, carried through async calls without threading it into every function. */
const budget = new AsyncLocalStorage<{ paidCalls: number }>();

let deps: ReturnType<typeof buildDeps> | null = null;
function buildDeps() {
  const cache = getCache();
  const inner = createClient({
    onCost: (_path, cents) => {
      // Fire and forget: spend accounting must never slow down or fail a request.
      void cache.incrBy(`spend:mb:${day()}`, Math.max(0, Math.round(cents)), DAY_S).catch(() => {});
    },
  });
  const mb: MicroburbsClient = {
    async get(...args: Parameters<MicroburbsClient["get"]>) {
      const b = budget.getStore();
      if (b && ++b.paidCalls > LIMITS.paidCallsPerRequest) throw new MicroburbsError("per-request paid call budget exceeded", 429, String(args[0]));
      if (((await cache.get<number>(`spend:mb:${day()}`)) ?? 0) >= LIMITS.dailySpendCents) throw new MicroburbsError("daily spend cap reached", 503, String(args[0]));
      return inner.get(...args);
    },
  } as MicroburbsClient;
  return { cache, mb, day };
}
export function getDeps() {
  return (deps ??= buildDeps());
}

/** The Chrome extension (one fixed ID in production) and local development; nothing else. */
function originAllowed(origin: string) {
  if (!origin) return true; // Non-browser callers send no Origin; they are handled by the limits below.
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCALHOST === "1";
  if (process.env.EXTENSION_ORIGIN) return process.env.EXTENSION_ORIGIN.split(",").includes(origin);
  return process.env.NODE_ENV !== "production" && origin.startsWith("chrome-extension://");
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return origin && originAllowed(origin)
    ? {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, x-listing-lens",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : { ...SECURITY_HEADERS };
}

export function preflight(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

function clientIp(req: Request) {
  // On Vercel the first x-forwarded-for entry is the client address set by the edge.
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

const deny = (req: Request, status: number, error: string, message: string) => json(req, { error, message }, status);

/**
 * Admission check for every paid route. Returns an error response, or null to proceed.
 * Also opens the per-request paid-call budget for the rest of the handler (AsyncLocalStorage).
 */
export async function guard(req: Request, kind: "data" | "chat" = "data"): Promise<Response | null> {
  // Must run before the first await: only then does the store reach the caller's continuation.
  budget.enterWith({ paidCalls: 0 });
  if (process.env.MAINTENANCE === "1") return deny(req, 503, "maintenance", "Listing Lens is paused for maintenance. Please try again later.");

  const origin = req.headers.get("origin") ?? "";
  if (!originAllowed(origin)) return deny(req, 403, "forbidden", "This origin is not allowed.");
  // A custom header forces a CORS preflight, so a random website cannot fire simple requests from a visitor's browser.
  if (req.headers.get("x-listing-lens") !== "1" && process.env.REQUIRE_CLIENT_HEADER !== "0" && process.env.NODE_ENV === "production") {
    return deny(req, 403, "forbidden", "Missing client header.");
  }

  const { cache } = getDeps();
  const ip = clientIp(req);
  const minute = Math.floor(Date.now() / 60_000);
  try {
    const [perMin, perDay] = await Promise.all([cache.incr(`rl:${ip}:${minute}`, 70), cache.incr(`rl:day:${ip}:${day()}`, DAY_S)]);
    if (perMin > LIMITS.perIpPerMin) return deny(req, 429, "rate_limited", "Too many requests. Try again in a minute.");
    if (perDay > LIMITS.perIpPerDay) return deny(req, 429, "rate_limited", "Daily limit reached for this connection. Try again tomorrow.");
    if (kind === "chat") {
      const [cMin, cDay, cAll] = await Promise.all([
        cache.incr(`rl:chat:${ip}:${minute}`, 70),
        cache.incr(`rl:chat:day:${ip}:${day()}`, DAY_S),
        cache.incr(`rl:chat:all:${day()}`, DAY_S),
      ]);
      if (cMin > LIMITS.chatPerIpPerMin) return deny(req, 429, "rate_limited", "Too many questions. Wait a minute and ask again.");
      if (cDay > LIMITS.chatPerIpPerDay || cAll > LIMITS.chatGlobalPerDay) return deny(req, 429, "rate_limited", "The assistant's daily limit is reached. Try again tomorrow.");
    }
    const spent = (await cache.get<number>(`spend:mb:${day()}`)) ?? 0;
    if (spent >= LIMITS.dailySpendCents) return deny(req, 503, "quota_exhausted", "Daily data quota reached. Try again tomorrow.");
  } catch {
    // Fail closed: if we cannot count, we do not spend.
    return deny(req, 503, "unavailable", "Service temporarily unavailable. Please retry.");
  }
  return null;
}

/** Maps upstream limits to clean responses without leaking internals. */
export function upstreamError(req: Request, e: unknown) {
  if (e instanceof MicroburbsError && (e.status === 503 || e.status === 429)) {
    return deny(req, 503, "quota_exhausted", "Data limit reached for now. Please try again later.");
  }
  console.error(e);
  return deny(req, 502, "upstream_error", "Data provider error. Please retry.");
}

export function readMode(v: string | null) {
  return v === "rent" ? "rent" : "sale";
}
