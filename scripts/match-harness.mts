// Measures address matching on real listings: rewrites each G-NAF address the way REA/Domain
// display it, resolves it through the geocoder path only, and counts correct matches and false positives.
// Usage: pnpm tsx --env-file=.env scripts/match-harness.mts [perSuburb]
import { type Sal, CITY_OF_SYDNEY_SALS } from "@mb/contracts";
import { createClient } from "../apps/web/lib/microburbs";
import { fileCache } from "../apps/web/lib/file-cache";
import { getSuburbListings } from "../apps/web/lib/listings";
import { resolveAddress } from "../apps/web/lib/resolve";

const perSuburb = Number(process.argv[2] ?? 12);
const suburbs: Sal[] = ["Pyrmont", "Surry Hills", "Waterloo (NSW)", "Glebe (NSW)", "Sydney", "Potts Point"];
let spent = 0;
const mb = createClient({ onCost: (_p, c) => (spent += c) });
const cache = fileCache("data/cache/dev-cache.json");

const ABBR: Record<string, string> = { Street: "St", Road: "Rd", Avenue: "Ave", Crescent: "Cres", Drive: "Dr", Place: "Pl", Lane: "Ln", Parade: "Pde", Terrace: "Tce", Circuit: "Cct", Highway: "Hwy" };
const plain = (s: string) => s.replace(/\s*\(.*\)$/, "");
function portalStyle(street: string, suburb: Sal, i: number): string {
  const short = street.replace(/\b(Street|Road|Avenue|Crescent|Drive|Place|Lane|Parade|Terrace|Circuit|Highway)\b/, (m) => ABBR[m]!);
  const m = /^(?:Unit|Suite|Apartment)\s+([A-Z0-9]+),\s*(.+)$/i.exec(short);
  const body = m ? `${m[1]}/${m[2]}` : short;
  return i % 2 ? `${body}, ${plain(suburb)} NSW 2000` : `${body.replace(/^(\S+)\//, "Unit $1, ")}, ${plain(suburb)}`;
}

let total = 0, exact = 0, wrong = 0, building = 0, ambiguous = 0;
const misses: string[] = [];
for (const s of suburbs) {
  if (!CITY_OF_SYDNEY_SALS.includes(s)) continue;
  const idx = await getSuburbListings(mb, cache, s, "sale");
  for (const [i, row] of idx.rows.slice(0, perSuburb).entries()) {
    const input = portalStyle(row.address.street, s, i);
    const r = await resolveAddress(input, { mb, cache }, { useIndex: false });
    total++;
    if (r.match.status === "exact-unit") {
      if (r.match.gnafId === row.gnaf_pid) exact++;
      else { wrong++; misses.push(`FALSE POSITIVE ${input} -> ${r.match.gnafId} (expected ${row.gnaf_pid})`); }
    } else if (r.match.status === "exact-building") building++;
    else { ambiguous++; misses.push(`${r.match.status}: ${input} | top: ${r.match.candidates[0]?.name ?? "-"}`); }
  }
}
console.log({ total, exact, falsePositives: wrong, exactBuilding: building, ambiguous, pctExact: ((100 * exact) / total).toFixed(1), spentCents: spent });
console.log(misses.join("\n"));
