// The only module allowed to call the Microburbs API.
// Sends our own User-Agent (Cloudflare blocks default clients), retries 429 with backoff,
// never retries 403, records cost, and only allows a closed list of paths.
import { NoDataEnvelope } from "@mb/contracts";
import type { z } from "zod";

const USER_AGENT = "microburbs-listing-lens/0.1 (+hackathon)";
const TIMEOUT_MS = 8_000;
const MAX_RETRIES = 3;
const MAX_REQ_PER_SEC = 8;

/** Path templates we are allowed to call. `{x}` matches one URL segment. */
const ALLOWLIST: RegExp[] = [
  "/v1/me",
  "/v1/geocode/address",
  "/v1/suburbs/{x}/listings/for-sale",
  "/v1/suburbs/{x}/listings/for-rent",
  "/v1/suburbs/{x}/similar",
  "/v1/suburbs/{x}/market/median-rent",
  "/v1/properties/{x}/valuation/agent-quoting",
  "/v1/properties/{x}/valuation/avm",
  "/v1/properties/{x}/sale-history",
  "/v1/properties/{x}/rent-history",
  "/v1/properties/{x}/comparables/recent-sales-nearby",
  "/v1/properties/{x}/transport/nearby",
  "/v1/properties/{x}/risks/all",
  "/v1/properties/{x}/profile",
  "/v1/properties/{x}/basics/all",
  "/v1/properties/{x}/comparables/cma-single-comp",
  "/v1/properties/{x}/schools/nearby",
  "/v1/suburbs/{x}/market/strata-levies",
  "/v1/suburbs/{x}/market/days-on-market",
  "/v1/suburbs/{x}/market/stock-on-market",
  "/v1/suburbs/{x}/market/months-of-supply",
  "/v1/suburbs/{x}/market/vacancy-rate",
  "/v1/suburbs/{x}/market/yield-pct",
  "/v1/suburbs/{x}/crime/summary",
  "/v1/suburbs/{x}/development/da-list",
  "/v1/suburbs/{x}/sales/recent",
  "/v1/properties/{x}/context/mesh-blocks",
  "/v1/suburbs/{x}/market/median-sale-price-series",
].map((p) => new RegExp("^" + p.replace(/\{x\}/g, "[^/]+") + "$"));

export class MicroburbsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
  }
}

export type MbResult<T> =
  | { available: true; data: T; costCents: number }
  | { available: false; data: null; reason: string; message?: string; costCents: number };

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onCost?: (path: string, cents: number, remaining: string | null) => void;
}

export function isAllowedPath(path: string): boolean {
  return ALLOWLIST.some((re) => re.test(path));
}

// Simple sliding-window limiter shared by every client in this process.
const sentAt: number[] = [];
async function throttle(sleep: (ms: number) => Promise<void>) {
  for (;;) {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0]! > 1000) sentAt.shift();
    if (sentAt.length < MAX_REQ_PER_SEC) {
      sentAt.push(now);
      return;
    }
    await sleep(1000 - (now - sentAt[0]!));
  }
}

export function createClient(opts: ClientOptions = {}) {
  const apiKey = opts.apiKey ?? process.env.MICROBURBS_API_KEY;
  const baseUrl = (opts.baseUrl ?? process.env.MICROBURBS_BASE_URL ?? "https://api.microburbs.com.au").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function get<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<MbResult<z.infer<S>>> {
    if (!isAllowedPath(path)) throw new MicroburbsError(`Path not allowed: ${path}`, 0, path);
    if (!apiKey) throw new MicroburbsError("MICROBURBS_API_KEY is not set", 0, path);

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) qs.set(k, String(v));
    const url = `${baseUrl}${path}${qs.size ? `?${qs}` : ""}`;

    for (let attempt = 0; ; attempt++) {
      await throttle(sleep);
      const res = await doFetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const cost = Number(res.headers.get("x-cost-cents") ?? 0) || 0;
      opts.onCost?.(path, cost, res.headers.get("x-remaining-cents"));

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        await sleep(retryAfter > 0 ? retryAfter : 500 * 2 ** attempt);
        continue;
      }
      if (res.status === 403) throw new MicroburbsError("Forbidden (key scope or Cloudflare)", 403, path);

      const body: unknown = await res.json().catch(() => null);
      const noData = NoDataEnvelope.safeParse(body);
      if (res.status === 404 || noData.success) {
        return {
          available: false,
          data: null,
          reason: noData.success ? (noData.data.reason ?? "no_data") : "not_found",
          message: noData.success ? noData.data.message : undefined,
          costCents: cost,
        };
      }
      if (!res.ok) throw new MicroburbsError(`HTTP ${res.status}`, res.status, path);

      // Most endpoints wrap the payload in `data`; a few (e.g. /v1/me) return it bare.
      const payload = body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new MicroburbsError(`Unexpected response shape: ${parsed.error.message}`, res.status, path);
      return { available: true, data: parsed.data, costCents: cost };
    }
  }

  return { get };
}

export type MicroburbsClient = ReturnType<typeof createClient>;
