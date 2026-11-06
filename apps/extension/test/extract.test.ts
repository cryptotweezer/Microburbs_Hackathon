// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { cleanTitle, extractAddress } from "../lib/extract";

function doc(html: string, title = "") {
  const d = document.implementation.createHTMLDocument(title);
  d.head.innerHTML = html;
  d.title = title;
  return d;
}

describe("extractAddress", () => {
  it("reads Domain JSON-LD", () => {
    const d = doc(`<script type="application/ld+json">[{"@type":"Organization"},{"@type":"Residence","address":{"streetAddress":"15/2-26 Wattle Crescent","addressLocality":"Pyrmont","addressRegion":"NSW","postalCode":"2009"}}]</script>`);
    const r = extractAddress(d, "https://www.domain.com.au/15-2-26-wattle-crescent-pyrmont-nsw-2009-2021300750");
    expect(r).toMatchObject({ portal: "domain", address: "15/2-26 Wattle Crescent, Pyrmont NSW 2009", method: "json-ld", isListing: true });
  });

  it("falls back to og:title", () => {
    const d = doc(`<meta property="og:title" content="15/2-26 Wattle Crescent, Pyrmont NSW 2009 | Domain">`);
    expect(extractAddress(d, "https://www.domain.com.au/15-2-26-wattle-crescent-pyrmont-nsw-2009-2021300750")?.address).toBe(
      "15/2-26 Wattle Crescent, Pyrmont NSW 2009",
    );
  });

  it("cleans REA titles", () => {
    expect(cleanTitle("15/2-26 Wattle Crescent, Pyrmont, NSW 2009 - Apartment for Sale - realestate.com.au")).toBe("15/2-26 Wattle Crescent, Pyrmont, NSW 2009");
  });

  it("detects rent from the title and ignores search pages", () => {
    const d = doc("", "Unit 1/10 Harris St, Pyrmont, NSW 2009 - Apartment for Rent");
    const r = extractAddress(d, "https://www.realestate.com.au/property-apartment-nsw-pyrmont-123456");
    expect(r?.modeHint).toBe("rent");
    expect(extractAddress(doc(""), "https://www.domain.com.au/sale/pyrmont-nsw-2009/apartment/")?.isListing).toBe(false);
  });
});

describe("addressMatchesUrl", () => {
  it("detects stale page data after SPA navigation on Domain", async () => {
    const { addressMatchesUrl } = await import("../lib/extract");
    const url = "https://www.domain.com.au/808-233-pyrmont-street-pyrmont-nsw-2009-2021111111";
    expect(addressMatchesUrl("808/233 Pyrmont Street, Pyrmont NSW 2009", url)).toBe(true);
    expect(addressMatchesUrl("15/2-26 Wattle Crescent, Pyrmont NSW 2009", url)).toBe(false);
    expect(addressMatchesUrl("15/2-26 Wattle Crescent, Pyrmont NSW 2009", "https://www.realestate.com.au/property-apartment-nsw-pyrmont-1")).toBe(true);
  });
});


describe("Domain page with similar listings in JSON-LD", () => {
  it("picks the address that matches the URL, not the first one", async () => {
    const { extractAddress } = await import("../lib/extract");
    const d = document.implementation.createHTMLDocument("x");
    const ld = (street: string) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Residence", address: { streetAddress: street, addressLocality: "Pyrmont", addressRegion: "NSW", postalCode: "2009" } })}</script>`;
    d.head.innerHTML = ld("Level 13, 125/152-164 Bulwara Road") + ld("B401/24 Point Street");
    const url = "https://www.domain.com.au/b401-24-point-street-pyrmont-nsw-2009-18386116?topspot=1";
    expect(extractAddress(d, url)?.address).toBe("B401/24 Point Street, Pyrmont NSW 2009");
  });
  it("falls back to the URL when no page address matches", async () => {
    const { extractAddress } = await import("../lib/extract");
    const d = document.implementation.createHTMLDocument("x");
    const url = "https://www.domain.com.au/b401-24-point-street-pyrmont-nsw-2009-18386116";
    expect(extractAddress(d, url)).toMatchObject({ address: "B401/24 point street pyrmont NSW 2009", method: "url" });
    expect(extractAddress(d, "https://www.domain.com.au/15-2-26-wattle-crescent-pyrmont-nsw-2009-2021300750")?.address).toBe("15/2-26 wattle crescent pyrmont NSW 2009");
  });
});
