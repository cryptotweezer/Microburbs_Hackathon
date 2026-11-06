// Development applications in a suburb: GET ?suburb=<SAL>
import { toSal } from "@mb/contracts";
import { nearbyDevelopments } from "@/lib/agent-tools";
import { getDeps, guard, json, preflight, upstreamError } from "@/lib/server";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const sal = toSal(new URL(req.url).searchParams.get("suburb") ?? "");
  if (!sal) return json(req, { error: "bad_request", message: "City of Sydney suburb required" }, 400);
  try {
    return json(req, await nearbyDevelopments(getDeps(), sal));
  } catch (e) {
    return upstreamError(req, e);
  }
}
