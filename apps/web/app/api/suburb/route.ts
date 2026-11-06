// Suburb pulse: GET ?suburb=<SAL>&mode=sale|rent
import { toSal } from "@mb/contracts";
import { getDeps, guard, json, preflight, readMode } from "@/lib/server";
import { getSuburbPulse } from "@/lib/suburb";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const sal = toSal(url.searchParams.get("suburb") ?? "");
  if (!sal) return json(req, { error: "bad_request", message: "City of Sydney suburb required" }, 400);
  return json(req, await getSuburbPulse(getDeps(), sal, readMode(url.searchParams.get("mode"))));
}
