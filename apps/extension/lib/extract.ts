// Address extraction for realestate.com.au and domain.com.au pages.
// Order: JSON-LD, then meta/title, then the URL slug. Only the address and a sale/rent hint are returned.

export type Portal = "rea" | "domain";
export interface Extracted {
  portal: Portal;
  address: string | null;
  modeHint: "sale" | "rent" | null;
  isListing: boolean;
  method: "json-ld" | "meta" | "h1" | "url" | null;
}

const ADDRESS_LIKE = /\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+[a-z].*,?\s*[a-z ]+(?:,?\s*nsw)?/i;

function portalOf(url: string): Portal | null {
  const host = new URL(url).hostname;
  if (host.endsWith("domain.com.au")) return "domain";
  if (host.endsWith("realestate.com.au")) return "rea";
  return null;
}

function modeFrom(url: string, title: string, referrer = ""): "sale" | "rent" | null {
  // Domain listing URLs carry no sale/rent marker; the search page the user came from does.
  const u = `${url} ${referrer}`.toLowerCase();
  if (/\/rent(\/|$)|\/property-.*-rent|\/rent-/.test(u) || /for rent|for lease|to rent/i.test(title)) return "rent";
  if (/\/buy(\/|$)|\/sale(\/|$)|\/sold/.test(u) || /for sale|auction/i.test(title)) return "sale";
  return null;
}

function isListingUrl(portal: Portal, url: string): boolean {
  const path = new URL(url).pathname;
  if (portal === "rea") return /^\/property-[a-z]+-[a-z]+-/.test(path) || path.startsWith("/property/");
  // Domain listings end with a numeric id: /15-2-26-wattle-crescent-pyrmont-nsw-2009-2020123456
  return /-nsw-\d{4}-\d{6,}$/.test(path) || path.startsWith("/property-profile/");
}

type LdNode = Record<string, unknown>;
function* walk(node: unknown): Generator<LdNode> {
  if (Array.isArray(node)) for (const n of node) yield* walk(n);
  else if (node && typeof node === "object") {
    yield node as LdNode;
    for (const v of Object.values(node)) if (v && typeof v === "object") yield* walk(v);
  }
}

/** Every address in the page's JSON-LD. Domain pages also describe "similar" listings, so order is not trusted. */
export function jsonLdAddresses(doc: Document): string[] {
  const out: string[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(s.textContent ?? "");
    } catch {
      continue;
    }
    for (const n of walk(data)) {
      const a = n.address as LdNode | string | undefined;
      if (a && typeof a === "object" && typeof a.streetAddress === "string") {
        const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter((x) => typeof x === "string" && x);
        out.push(parts.join(", ").replace(/,\s*(NSW)\s*,\s*(\d{4})/i, " $1 $2"));
      }
    }
  }
  return out;
}

export const fromJsonLd = (doc: Document): string | null => jsonLdAddresses(doc)[0] ?? null;

/** Strips portal branding from a title such as "15/2-26 Wattle Cres, Pyrmont NSW 2009 | Domain". */
export function cleanTitle(t: string): string | null {
  const first = t.split(/\s[|–-]\s|\s-\s/)[0]?.trim() ?? "";
  const m = /^(?:.*?\bat\s+)?(.+?\b(?:NSW)\b\s*\d{4})/i.exec(first) ?? /^(.+?\b\d{4})\b/.exec(first);
  const candidate = (m?.[1] ?? first).trim();
  return ADDRESS_LIKE.test(candidate) ? candidate : null;
}

export function fromUrl(portal: Portal, url: string): string | null {
  const path = decodeURIComponent(new URL(url).pathname);
  const m =
    portal === "domain"
      ? /\/(?:property-profile\/)?([a-z0-9-]+)-nsw-(\d{4})(?:-\d+)?$/i.exec(path)
      : /\/property\/(?:unit-|apartment-)?([a-z0-9-]+)-nsw-(\d{4})/i.exec(path);
  if (!m) return null;
  const tokens = m[1]!.toLowerCase().split("-");
  // "b401-24-point-street-pyrmont": two leading number-like tokens are unit and street number.
  const numberLike = (t?: string) => !!t && /\d/.test(t) && t.length <= 6;
  if (numberLike(tokens[0]) && numberLike(tokens[1])) {
    const range = numberLike(tokens[2]) && /^\d+[a-z]?$/.test(tokens[2]!) && /^\d+$/.test(tokens[1]!) ? `-${tokens[2]}` : "";
    const rest = tokens.slice(range ? 3 : 2);
    return `${tokens[0]!.toUpperCase()}/${tokens[1]}${range} ${rest.join(" ")} NSW ${m[2]}`;
  }
  // The backend validates every field, so an ambiguous slug can only fail to match, not mismatch.
  return `${tokens.join(" ")} NSW ${m[2]}`;
}

export function extractAddress(doc: Document, url: string): Extracted | null {
  const portal = portalOf(url);
  if (!portal) return null;
  const title = doc.title ?? "";
  const isListing = isListingUrl(portal, url);
  const modeHint = modeFrom(url, title, doc.referrer ?? "");
  if (!isListing) return { portal, address: null, modeHint, isListing, method: null };

  // Candidates in order of trust. When the URL carries the address (Domain), a candidate must agree with it:
  // listing pages also embed addresses of similar listings and, after SPA navigation, the previous one.
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
  const h1 = doc.querySelector("h1")?.textContent?.trim() ?? "";
  const candidates: [string | null, Extracted["method"]][] = [
    ...jsonLdAddresses(doc).map((a) => [a, "json-ld"] as [string, Extracted["method"]]),
    [cleanTitle(og) ?? cleanTitle(title), "meta"],
    [h1 && ADDRESS_LIKE.test(h1) && h1.length < 120 ? h1 : null, "h1"],
  ];
  for (const [address, method] of candidates) {
    if (address && addressMatchesUrl(address, url)) return { portal, address, modeHint, isListing, method };
  }
  const u = fromUrl(portal, url);
  return { portal, address: u, modeHint, isListing, method: u ? "url" : null };
}

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Domain listing URLs embed the address ("/15-2-26-wattle-crescent-pyrmont-nsw-2009-2021300750"), so we can
 * tell when page data still belongs to the previous listing. Other URLs carry no address and always pass.
 */
export function addressMatchesUrl(address: string, url: string): boolean {
  const path = new URL(url).pathname;
  if (!/-nsw-\d{4}(-\d+)?$/.test(path)) return true;
  // Compare the unit and street number: "B401/24 Point St" -> "b401-24"; "Level 13, 125/152 Bulwara" -> "125-152".
  const slug = toSlug(address.replace(/^\s*(level|floor|lvl)\s*\w+\s*,?\s*/i, "").replace(/^\s*(unit|apartment|apt|suite)\s+/i, ""));
  const head = slug.split("-").slice(0, 2).join("-");
  const last = path.toLowerCase().split("/").pop() ?? "";
  return last.startsWith(head + "-") || last.includes(`-${head}-`);
}
