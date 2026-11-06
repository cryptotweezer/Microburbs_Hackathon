// Main panel endpoint: GET ?address=&mode=&auto=1[&gnaf=][&price=].
// Resolves the exact unit, loads core facts, verdict, alternatives and insights. Mode is decided by the listing when auto=1.
import { getDeps, guard, json, preflight, readMode, upstreamError } from "@/lib/server";
import { resolveAddress } from "@/lib/resolve";
import { applyUserPrice, getPropertyFacts, parseUserPrice } from "@/lib/facts";
import { MicroburbsError } from "@/lib/microburbs";
import { findAlternatives, marketRent } from "@/lib/alternatives";
import { getSuburbListings } from "@/lib/listings";
import { streetCheck, yieldCheck } from "@/lib/insights";
import { targetFromFacts } from "@/lib/target";
import { priceVerdict } from "@/lib/verdict";
import { fairRentFor, getRentEstimate } from "@/lib/rent";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const address = url.searchParams.get("address")?.slice(0, 200);
  const requested = readMode(url.searchParams.get("mode"));
  // auto=1: the listing's own index (for sale or for rent) decides; the page hint is only a fallback.
  const auto = url.searchParams.get("auto") === "1";
  const gnafOverride = url.searchParams.get("gnaf");
  if (!address) return json(req, { error: "bad_request", message: "address is required" }, 400);

  const deps = getDeps();
  try {
    const { match, listing } = await resolveAddress(address, deps, { mode: requested });
    const mode = auto && listing ? listing.mode : requested;
    const modeSource = auto && listing ? "listing" : auto ? "page" : "user";
    // The user can pick a candidate from an ambiguous match; it must be one we offered.
    if (gnafOverride && match.status === "ambiguous" && match.candidates.some((c) => c.id === gnafOverride)) {
      match.status = "exact-unit";
      match.gnafId = gnafOverride;
      match.matchedAddress = match.candidates.find((c) => c.id === gnafOverride)!.name;
      match.note = "Selected by the user.";
    }
    if (match.status !== "exact-unit" || !match.gnafId) return json(req, { match, mode, modeSource, facts: null });
    const facts = applyUserPrice(await getPropertyFacts(deps, match.gnafId, mode, listing, null), mode, parseUserPrice(url.searchParams.get("price"), mode));
    const rent = mode === "rent" ? await getRentEstimate(match.gnafId) : null;
    const fairRent = rent ? fairRentFor(rent, facts.listing.value?.parking ?? null) : null;
    const target = targetFromFacts(match, mode, facts);
    const alternatives = target ? { target, ...(await findAlternatives(deps, target)) } : null;
    const market = mode === "rent" && target && !fairRent ? marketRent(target, (await getSuburbListings(deps.mb, deps.cache, target.suburb, "rent")).rows) : null;
    // Insights never block the panel: a failure just leaves them out.
    const [street, yieldInfo] = target
      ? await Promise.all([
          streetCheck(deps, target, match.matchedAddress ?? address).catch(() => null),
          yieldCheck(deps, target, mode).catch(() => null),
        ])
      : [null, null];
    return json(req, {
      match,
      mode,
      modeSource,
      facts,
      verdict: priceVerdict(mode, facts, fairRent, market),
      rent,
      alternatives,
      insights: { street, yield: yieldInfo },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof MicroburbsError && e.status === 403) {
      return json(req, { match: { input: address, status: "unsupported", note: "Not covered by the data key." }, facts: null });
    }
    return upstreamError(req, e);
  }
}
