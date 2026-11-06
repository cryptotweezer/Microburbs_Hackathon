// @vitest-environment happy-dom
// Local-only smoke test: renders every section with a real backend response saved in data/ (not committed).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgencyCard, AlternativesCard, HistoryCard, MatchReceipt, PriceCard, RentCard, RisksCard, TransportCard } from "../entrypoints/sidepanel/sections";
import { Chat } from "../entrypoints/sidepanel/Chat";

const file = join(__dirname, "../../../data/prop-live.json");
describe.skipIf(!existsSync(file))("render real response", () => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const cases: [string, () => unknown][] = [
    ["match", () => <MatchReceipt match={data.match} onPick={() => {}} />],
    ["price", () => <PriceCard data={data} mode="sale" />],
    ["rent", () => <RentCard data={data} />],
    ["alt", () => <AlternativesCard alt={data.alternatives} mode="sale" onOpen={() => {}} />],
    ["chat", () => <Chat data={data} mode="sale" />],
    ["agency", () => <AgencyCard f={data.facts} />],
    ["history", () => <HistoryCard gnaf={data.match.gnafId} />],
    ["transport", () => <TransportCard gnaf={data.match.gnafId} />],
    ["risks", () => <RisksCard gnaf={data.match.gnafId} />],
  ];
  for (const [name, el] of cases) it(name, () => expect(() => renderToString(el() as never)).not.toThrow());
});
