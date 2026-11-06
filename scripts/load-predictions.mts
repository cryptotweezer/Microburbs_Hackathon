// Uploads a validated rent CSV to Redis as hash rent:<version>, then flips rent:current atomically.
// Usage: pnpm tsx --env-file=.env scripts/load-predictions.mts data/submissions/rents_<team>.csv <version>
import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";

const [file, version] = process.argv.slice(2);
if (!file || !version) throw new Error("usage: load-predictions.mts <csv> <version>");
const EXPECTED = Number(process.env.EXPECTED_ROWS ?? 65777);

const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
if (lines[0] !== "gnaf_id,rent_with_car_space,rent_without_car_space") throw new Error(`bad header: ${lines[0]}`);
const rows = lines.slice(1).map((l) => l.split(","));
const ids = new Set(rows.map((r) => r[0]));
if (rows.length !== EXPECTED || ids.size !== EXPECTED) throw new Error(`expected ${EXPECTED} unique rows, got ${rows.length}/${ids.size}`);
for (const [id, w, wo] of rows) {
  if (!Number.isFinite(Number(w)) || !Number.isFinite(Number(wo)) || Number(w) < Number(wo)) throw new Error(`bad row ${id}`);
}

const redis = Redis.fromEnv();
const key = `rent:${version}`;
await redis.del(key);
for (let i = 0; i < rows.length; i += 2000) {
  const chunk: Record<string, string> = {};
  for (const [id, w, wo] of rows.slice(i, i + 2000)) chunk[id!] = `${w},${wo}`;
  await redis.hset(key, chunk);
}
const stored = await redis.hlen(key);
if (stored !== EXPECTED) throw new Error(`stored ${stored}, expected ${EXPECTED}; pointer not changed`);
await redis.set("rent:current", version);
console.log(`Loaded ${stored} predictions into ${key}; rent:current -> ${version}`);
