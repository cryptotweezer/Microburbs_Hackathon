// POST { address, mode, messages } -> { answer, alternatives }. Facts are re-read on the server (cached),
// never trusted from the client.
import { z } from "zod";
import { runAgent } from "@/lib/agent";
import { applyUserPrice, getPropertyFacts, parseUserPrice } from "@/lib/facts";
import { marketRent } from "@/lib/alternatives";
import { getSuburbListings } from "@/lib/listings";
import { resolveAddress } from "@/lib/resolve";
import { getDeps, guard, json, preflight } from "@/lib/server";
import { targetFromFacts } from "@/lib/target";
import { priceVerdict } from "@/lib/verdict";
import { fairRentFor, getRentEstimate } from "@/lib/rent";

export const OPTIONS = preflight;
export const maxDuration = 60;

const Body = z.object({
  address: z.string().min(3).max(200),
  mode: z.enum(["sale", "rent"]),
  gnaf: z.string().max(20).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(1500) }))
    .min(1)
    .max(12),
});

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  if (!process.env.ANTHROPIC_API_KEY) return json(req, { error: "unavailable", message: "The assistant is not configured." }, 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: "bad_request", message: "Invalid chat request." }, 400);
  const { address, mode, gnaf, messages, price } = parsed.data;
  if (messages.at(-1)!.role !== "user") return json(req, { error: "bad_request", message: "Last message must be from the user." }, 400);

  const deps = getDeps();
  const { match, listing } = await resolveAddress(address, deps, { mode });
  const gnafId = match.status === "exact-unit" ? match.gnafId : gnaf && match.candidates.some((c) => c.id === gnaf) ? gnaf : null;
  if (!gnafId) return json(req, { answer: "I can only answer once the exact property is matched. Please confirm the address above." });

  try {
    const facts = applyUserPrice(await getPropertyFacts(deps, gnafId, mode, listing, null), mode, parseUserPrice(price === undefined ? null : String(price), mode));
    const rent = mode === "rent" ? await getRentEstimate(gnafId) : null;
    const fairRent = rent ? fairRentFor(rent, facts.listing.value?.parking ?? null) : null;
    const target = targetFromFacts({ ...match, gnafId }, mode, facts);
    const market = mode === "rent" && target && !fairRent ? marketRent(target, (await getSuburbListings(deps.mb, deps.cache, target.suburb, "rent")).rows) : null;
    const out = await runAgent(
      deps,
      { address: match.matchedAddress ?? address, suburb: match.suburb as never, mode, gnafId, facts, verdict: priceVerdict(mode, facts, fairRent, market), target },
      messages,
    );
    return json(req, out);
  } catch (e) {
    console.error(e);
    return json(req, { error: "agent_error", message: "The assistant could not answer right now. Please retry." }, 502);
  }
}
