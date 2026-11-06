// Fair rent from our own model (Task 4). Predictions are loaded into Redis as a hash
// `rent:<version>` with a `rent:current` pointer; locally we fall back to the submission CSV.
import { existsSync, readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import type { Fact, RentEstimate } from "@mb/contracts";

const SOURCE = "Listing Lens rent model (trained on leases up to 2026-07-31)";
let local: Map<string, [number, number]> | null = null;

function localTable(): Map<string, [number, number]> {
  if (local) return local;
  local = new Map();
  const path = process.env.RENT_PREDICTIONS_CSV;
  if (path && existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/).slice(1)) {
      const [id, withCar, without] = line.split(",");
      if (id && withCar && without) local.set(id, [Number(withCar), Number(without)]);
    }
  }
  return local;
}

export async function getRentEstimate(gnafId: string): Promise<Fact<RentEstimate>> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  let row: [number, number] | null = null;
  let version = "local";
  if (url && token) {
    const redis = new Redis({ url, token });
    version = (await redis.get<string>("rent:current")) ?? "";
    const v = version ? await redis.hget<string>(`rent:${version}`, gnafId) : null;
    if (v) row = String(v).split(",").map(Number) as [number, number];
  } else {
    row = localTable().get(gnafId) ?? null;
  }
  if (!row) return { available: false, value: null, source: SOURCE, asOf: null, reason: "not_in_model_universe" };
  return {
    available: true,
    source: SOURCE,
    asOf: "2026-08-31",
    value: { gnafId, rentWithCarSpace: row[0], rentWithoutCarSpace: row[1], support: "unit", modelVersion: version },
  };
}

/** Picks the comparable fair rent for this listing: with car space only when the listing has parking. */
export function fairRentFor(rent: Fact<RentEstimate>, parking: number | null): number | null {
  if (!rent.available || !rent.value) return null;
  return parking && parking > 0 ? rent.value.rentWithCarSpace : rent.value.rentWithoutCarSpace;
}
