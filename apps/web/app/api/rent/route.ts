// Fair rent lookup for one G-NAF id from the Task 4 model predictions (Redis hash, local CSV fallback).
import { getRentEstimate } from "@/lib/rent";
import { guard, json, preflight } from "@/lib/server";

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const blocked = await guard(req);
  if (blocked) return blocked;
  const gnaf = new URL(req.url).searchParams.get("gnaf");
  if (!gnaf || !/^GA[A-Z]{2,3}\d{6,12}$/.test(gnaf)) return json(req, { error: "bad_request", message: "valid gnaf is required" }, 400);
  return json(req, { rent: await getRentEstimate(gnaf) });
}
