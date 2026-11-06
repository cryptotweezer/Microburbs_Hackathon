// Lazy panel sections: GET ?gnaf=...&name=history|transport|schools|risks
import { getSection, type SectionName } from "@/lib/facts";
import { getDeps, guard, json, preflight } from "@/lib/server";

export const OPTIONS = preflight;
const NAMES: SectionName[] = ["history", "transport", "schools", "risks", "block"];

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const gnaf = url.searchParams.get("gnaf");
  const name = url.searchParams.get("name") as SectionName | null;
  if (!gnaf || !/^GA[A-Z]{2,3}\d{6,12}$/.test(gnaf) || !name || !NAMES.includes(name)) return json(req, { error: "bad_request", message: "valid gnaf and name are required" }, 400);
  return json(req, await getSection(getDeps(), gnaf, name));
}
