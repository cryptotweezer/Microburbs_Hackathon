// Address resolution only: returns the match receipt (status, G-NAF id, candidates) without loading facts.
import { getDeps, guard, json, preflight, readMode } from "@/lib/server";
import { resolveAddress } from "@/lib/resolve";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const address = url.searchParams.get("address")?.slice(0, 200);
  if (!address) return json(req, { error: "bad_request", message: "address is required" }, 400);
  const { match } = await resolveAddress(address, getDeps(), { mode: readMode(url.searchParams.get("mode")) });
  return json(req, { match });
}
