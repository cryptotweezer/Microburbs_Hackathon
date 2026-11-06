// Validates schemas against real API responses saved locally in data/probe (never committed).
// Skipped when that folder is absent.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as C from "../src";

const dir = join(__dirname, "../../../data/probe");
const rules: [RegExp, z.ZodTypeAny][] = [
  [/^geocode_/, z.array(C.GeocodeCandidate)],
  [/^listings_/, C.ListingsPage],
  [/^agent_quoting_/, C.AgentQuoting],
  [/^(avm_|prop_.*_valuation_avm)/, C.Avm],
  [/_(sale|rent)_history\.json$/, z.array(C.HistoryEntry)],
  [/_comparables_recent_sales_nearby/, z.array(C.RecentSale)],
  [/_transport_nearby/, C.TransportNearby],
  [/_risks_all/, C.RisksAll],
  [/_profile\.json$/, C.Profile],
  [/_basics_all/, C.Basics],
];

describe.skipIf(!existsSync(dir))("schemas accept real probe responses", () => {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes("street_profile")) : [];
  for (const f of files) {
    const rule = rules.find(([re]) => re.test(f));
    if (!rule) continue;
    it(f, () => {
      const body = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (body.data === null) return expect(C.NoDataEnvelope.safeParse(body).success).toBe(true);
      const r = rule[1].safeParse(body.data);
      expect(r.success, r.success ? "" : r.error.message).toBe(true);
    });
  }
});
