// Smoke test: account info + one real geocode. Costs about 1 cent.
import { z } from "zod";
import { GeocodeCandidate } from "@mb/contracts";
import { createClient } from "../apps/web/lib/microburbs";

let spent = 0;
let remaining: string | null = null;
const mb = createClient({
  onCost: (_p, c, r) => {
    spent += c;
    remaining = r ?? remaining;
  },
});

const me = await mb.get("/v1/me", z.unknown());
console.log("account:", JSON.stringify(me.data).slice(0, 300));
const g = await mb.get("/v1/geocode/address", z.array(GeocodeCandidate), {
  address: "Unit 15, 2-26 Wattle Crescent, Pyrmont NSW",
});
console.log("geocode:", g.available ? g.data[0] : g);
console.log(`spent: ${spent}c, remaining: ${remaining ?? "?"}c`);
