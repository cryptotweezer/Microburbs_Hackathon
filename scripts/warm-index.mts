// Rebuilds the City of Sydney listings index (all suburbs, sale and rent) and overwrites the cached copy.
// Run after switching API keys so every listing a judge opens matches without a cold fetch.
// Note: the listings endpoint returns at most 200 rows and has no offset, so the biggest suburbs are partial;
// listings outside the index still resolve through the validated geocode path.
// Usage: pnpm exec tsx --env-file=.env scripts/warm-index.mts
import { CITY_OF_SYDNEY_SALS } from "@mb/contracts";
import { getCache, type Cache } from "../apps/web/lib/cache";
import { getSuburbListings } from "../apps/web/lib/listings";
import { createClient } from "../apps/web/lib/microburbs";

const real = getCache();
// Always miss on read so each suburb is fetched fresh, but write the result to the shared cache.
const refresh: Cache = { ...real, get: async () => null };
const mb = createClient();

let sale = 0;
let rent = 0;
for (const suburb of CITY_OF_SYDNEY_SALS) {
  for (const mode of ["sale", "rent"] as const) {
    const r = await getSuburbListings(mb, refresh, suburb, mode);
    if (mode === "sale") sale += r.rows.length;
    else rent += r.rows.length;
    const capped = r.total > r.rows.length ? ` (total ${r.total}, capped)` : "";
    console.log(`${suburb.padEnd(22)} ${mode.padEnd(4)} ${String(r.rows.length).padStart(4)}${capped}`);
  }
}
console.log(`\nIndexed ${sale} for sale and ${rent} for rent across ${CITY_OF_SYDNEY_SALS.length} suburbs.`);
