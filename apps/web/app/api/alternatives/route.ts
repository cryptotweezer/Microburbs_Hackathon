// Re-runs the alternatives search with user (or agent) filters. POST { target, filters }.
import { z } from "zod";
import { CITY_OF_SYDNEY_SALS } from "@mb/contracts";
import { findAlternatives } from "@/lib/alternatives";
import { getDeps, guard, json, preflight } from "@/lib/server";

export const OPTIONS = preflight;

const Sal = z.enum(CITY_OF_SYDNEY_SALS);
const n = z.number().nonnegative().nullable();

const Target = z.object({
  gnafId: z.string().max(20).nullable(),
  suburb: Sal,
  mode: z.enum(["sale", "rent"]),
  price: n,
  bedrooms: n,
  bathrooms: n,
  parking: n,
  buildingSize: n,
  propertyType: z.string().max(30).nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

const Filters = z.object({
  maxPrice: z.number().positive().optional(),
  bedrooms: z.number().int().min(0).max(6).optional(),
  minBathrooms: z.number().int().min(0).max(5).optional(),
  minParking: z.number().int().min(0).max(4).optional(),
  suburbs: z.array(Sal).max(4).optional(),
  sizeTolerance: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const Body = z.object({ target: Target, filters: Filters.default({}) });

export async function POST(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: "bad_request", message: parsed.error.message }, 400);
  const { target, filters } = parsed.data;
  return json(req, { target, filters, ...(await findAlternatives(getDeps(), target, filters)) });
}
