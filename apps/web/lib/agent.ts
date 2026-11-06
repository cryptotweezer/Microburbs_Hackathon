// Chat agent for the side panel. The model only explains: every number comes from a tool that
// reads Microburbs data (already cached), and the alternatives ranking is deterministic code.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { CITY_OF_SYDNEY_SALS, type Mode } from "@mb/contracts";
import { findAlternatives, type Alternative, type Filters, type Target } from "./alternatives";
import type { Cache } from "./cache";
import { getSection, type PropertyFacts } from "./facts";
import { getSuburbPulse } from "./suburb";
import { blockProfile, streetCheck, yieldCheck } from "./insights";
import { compareSuburbs, lookupAddress, nearbyDevelopments, ownershipCosts, priceTrend, propertySummary } from "./agent-tools";
import type { Sal } from "@mb/contracts";
import type { MicroburbsClient } from "./microburbs";
import type { Verdict } from "./verdict";

export const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-haiku-5-5";

const SYSTEM = `You are Microburbs Agent, the property analyst built into Listing Lens, a Chrome extension that sits beside real estate listings on domain.com.au and realestate.com.au.

Who you help: people buying or renting a flat or house in the City of Sydney (its 29 suburbs). They are looking at one specific listing right now and want to know three things: is the price fair, what is the catch, and is there something better for the money.

What you have: tools that read Microburbs data for the exact property on screen, matched by its official G-NAF address. Microburbs covers valuations, comparable sales, agency quoting track records, sale and rent history, active listings, schools, transport, risk overlays and suburb market indicators. The panel next to you already shows the headline numbers; your job is to explain them, connect them and answer follow-up questions.

How you work:
1. For a question about this property, call get_property_facts first. Use get_section and get_suburb_pulse when the question needs history, transport, schools, risks or market context.
   Price checks: street_check (median sold price on this street vs the suburb and nearby streets, the "cheap block on an expensive street" test), yield_check (asking price against rents of similar flats; an odd yield can flag a pricing or data problem) and block_profile (the census mesh block this property is in, vs blocks within 1 km; cite it as "mesh block <id>").
   Other tools: lookup_address (any other City of Sydney address), compare_listings (this property side by side with another address, for example one of the alternatives), compare_suburbs, nearby_developments (recent development applications in the suburb), price_trend (suburb median sale price over time) and costs_calculator (approximate monthly loan repayment plus strata).
   For costs_calculator, ask for the deposit and interest rate if the user did not give them, or say which defaults you used (20% deposit, 6% rate, 30 years). Always repeat its disclaimer in one short sentence: the figure is approximate, check with a bank or broker. Cite the repayment as [Listing Lens calculator], never as Microburbs data.
2. To suggest other properties, call find_alternatives. Change its filters to follow the user (budget, bedrooms, bathrooms, parking, nearby suburbs) but never re-rank, edit or add to its results.
3. Answer from tool results only. Never invent or estimate prices, rents, dates or statistics, and never use outside knowledge about the market.

Rules:
- Always answer in English, whatever language the user writes in.
- Cite every number with its source and date in brackets, e.g. [Microburbs AVM, 2026-07-27].
- If a fact is unavailable, say there is no data for it.
- Be honest about weak evidence: agency quoting with fewer than 10 sales, a single comparable sale, or a price entered by the user are rough guides. Say so.
- If the asking price was entered by the user, treat it as their figure, not Microburbs data.
- When the user asks about buying while the listing is a rental (or the reverse), say so in one sentence and answer for the listing's own mode.
- The conversation history keeps only the text of your earlier answers, not the tool results behind them. Those answers were grounded in tool data: never retract them unless a tool now returns different data. Call the tools again when you need the numbers.
- You give information, not financial, legal or investment advice. Do not tell the user to buy, rent or bid; give them the facts to decide.
- Only the 29 City of Sydney suburbs are covered. For anything else, say it is outside coverage.

Answer every part of a multi-part question. The block's street name comes without a type ("Wattle"): never add Street or Road to it.

Format: one plain sentence that answers the question, then at most 4 bullets (up to 6 when the user asks several things) starting with "- ", one fact per bullet, each ending with its citation. No headings or tables; bold only the single key number. Under 120 words, and always finish your last sentence.`;

export interface ChatContext {
  address: string;
  suburb: Sal | null;
  mode: Mode;
  gnafId: string;
  facts: PropertyFacts;
  verdict: Verdict;
  target: Target | null;
}

/** Compact view of the facts for the model: values plus source and date, nothing else. */
function summarize(ctx: ChatContext) {
  const f = ctx.facts;
  const pick = <T,>(x: { available: boolean; value: T | null; source: string; asOf: string | null; reason?: string }) =>
    x.available ? { value: x.value, source: x.source, asOf: x.asOf } : { value: null, noData: x.reason ?? "no_data", source: x.source };
  return {
    address: ctx.address,
    mode: ctx.mode === "sale" ? "buying" : "renting",
    listing: pick(f.listing),
    priceVerdict: ctx.verdict,
    agencyQuoting: pick(f.agentQuoting),
    microburbsValuation: pick(f.avm),
    bestComparableSale: pick(f.cma),
    recentComparableSales: pick(f.comparables),
    rentHistory: pick(f.rentHistory),
  };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function runAgent(deps: { mb: MicroburbsClient; cache: Cache }, ctx: ChatContext, messages: ChatTurn[]) {
  let alternatives: { items: Alternative[]; filters: Filters; seeAllUrl: string } | null = null;
  const Sal = z.enum(CITY_OF_SYDNEY_SALS);

  const result = await generateText({
    model: anthropic(AGENT_MODEL),
    system: SYSTEM,
    messages,
    maxOutputTokens: 1200,
    stopWhen: isStepCount(6),
    tools: {
      get_property_facts: tool({
        description: "Core facts about the property the user is viewing: listing, price verdict, agency quoting and likely sale price, valuation, best comparable sale, recent comparable sales. Each with source and date.",
        inputSchema: z.object({}),
        execute: async () => summarize(ctx),
      }),
      get_section: tool({
        description:
          "Secondary facts for this property: 'history' (sale and rent history), 'transport' (nearest train, bus, ferry), 'schools' (nearest schools), 'risks' (flood, heritage and other overlays).",
        inputSchema: z.object({ name: z.enum(["history", "transport", "schools", "risks"]) }),
        execute: async ({ name }) => getSection(deps, ctx.gnafId, name),
      }),
      get_suburb_pulse: tool({
        description: "Suburb market context: days on market, stock, months of supply, strata levies, crime (buying) or vacancy and yield (renting).",
        inputSchema: z.object({}),
        execute: async () => (ctx.suburb ? getSuburbPulse(deps, ctx.suburb, ctx.mode) : { noData: "unknown suburb" }),
      }),
      street_check: tool({
        description: "Median sold price of similar homes on this street vs the whole suburb and nearby streets (last 3 years).",
        inputSchema: z.object({}),
        execute: async () => (ctx.target ? ((await streetCheck(deps, ctx.target, ctx.address)) ?? { noData: "Too few sales on this street." }) : { noData: "No target." }),
      }),
      yield_check: tool({
        description: "Implied gross rental yield of this listing (market rent of similar flats x 52 / asking price) vs the suburb's yield.",
        inputSchema: z.object({}),
        execute: async () =>
          ctx.target ? ((await yieldCheck(deps, ctx.target, ctx.mode)) ?? { noData: "Needs a sale listing with a price and enough similar rentals." }) : { noData: "No target." },
      }),
      block_profile: tool({
        description: "The census mesh block this property is in: homes, share rented, investor share, average annual growth, vs blocks within 1 km.",
        inputSchema: z.object({}),
        execute: async () => blockProfile(deps, ctx.gnafId),
      }),
      lookup_address: tool({
        description: "Match any City of Sydney address exactly and return its core facts (listing, price verdict, valuation, best comparable sale).",
        inputSchema: z.object({ address: z.string().min(5).max(160).describe("Full address, e.g. 'Unit 417, 261 Harris Street, Pyrmont'") }),
        execute: async ({ address }) => lookupAddress(deps, address, ctx.mode),
      }),
      compare_listings: tool({
        description: "Compare the property on screen with another City of Sydney address side by side.",
        inputSchema: z.object({ address: z.string().min(5).max(160) }),
        execute: async ({ address }) => ({ thisProperty: propertySummary(ctx.address, ctx.mode, ctx.facts), other: await lookupAddress(deps, address, ctx.mode) }),
      }),
      compare_suburbs: tool({
        description: "Market indicators for up to 3 City of Sydney suburbs side by side (days on market, supply, strata, crime; or vacancy and yield when renting).",
        inputSchema: z.object({ suburbs: z.array(Sal).min(1).max(3) }),
        execute: async ({ suburbs }) => compareSuburbs(deps, suburbs, ctx.mode),
      }),
      nearby_developments: tool({
        description: "Recent development applications (DAs) in a suburb: what is being built or changed. Defaults to this property's suburb.",
        inputSchema: z.object({ suburb: Sal.optional() }),
        execute: async ({ suburb }) => {
          const s = suburb ?? ctx.suburb;
          return s ? nearbyDevelopments(deps, s) : { noData: "unknown suburb" };
        },
      }),
      price_trend: tool({
        description: "Median sale price of units or houses in a suburb over the last 10 years, with 1, 5 and 10-year change.",
        inputSchema: z.object({ suburb: Sal.optional(), kind: z.enum(["unit", "house"]).default("unit") }),
        execute: async ({ suburb, kind }) => {
          const s = suburb ?? ctx.suburb;
          return s ? priceTrend(deps, s, kind) : { noData: "unknown suburb" };
        },
      }),
      costs_calculator: tool({
        description: "Approximate monthly cost of buying: principal-and-interest repayment plus the suburb's median strata levy. Uses the asking price unless another price is given.",
        inputSchema: z.object({
          price: z.number().positive().optional(),
          depositPct: z.number().min(0).max(100).default(20),
          ratePct: z.number().min(0).max(20).default(6),
          years: z.number().int().min(1).max(40).default(30),
        }),
        execute: async ({ price, depositPct, ratePct, years }) => {
          const p = price ?? ctx.facts.listing.value?.price ?? ctx.verdict.estimate;
          if (!p) return { noData: "No price to calculate with. Ask the user for one." };
          const pulse = ctx.suburb ? await getSuburbPulse(deps, ctx.suburb, "sale") : null;
          const strata = pulse?.indicators["strata-levies"]?.value?.median_levy_annual;
          return {
            ...ownershipCosts({ price: p, depositPct, ratePct, years, strataAnnual: typeof strata === "number" ? strata : null }),
            source: "Listing Lens calculator (arithmetic on the figures above, not Microburbs data). Cite it as [Listing Lens calculator].",
            priceSource: price ? "given by the user" : ctx.facts.listing.value?.price ? ctx.facts.listing.source : "estimate (no asking price)",
            strataSource:
              typeof strata === "number"
                ? `[Microburbs strata levies, ${pulse?.indicators["strata-levies"]?.asOf ?? "latest"}] (suburb median, not this building)`
                : "no data",
          };
        },
      }),
      find_alternatives: tool({
        description:
          "Active listings similar to this one but cheaper, from Microburbs listings. Defaults to the same suburb, bedrooms, bathrooms and parking. Override filters to follow the user's request.",
        inputSchema: z.object({
          maxPrice: z.number().positive().optional().describe("Budget ceiling. Weekly rent when renting."),
          bedrooms: z.number().int().min(0).max(6).optional(),
          minBathrooms: z.number().int().min(0).max(5).optional(),
          minParking: z.number().int().min(0).max(4).optional().describe("0 to accept listings without parking."),
          suburbs: z.array(Sal).max(4).optional().describe("Exact SAL names, e.g. 'Glebe (NSW)', 'Ultimo'."),
        }),
        execute: async (filters) => {
          if (!ctx.target) return { items: [], note: "No comparison target for this property." };
          const r = await findAlternatives(deps, ctx.target, { ...filters, limit: 5 });
          alternatives = { items: r.items, filters, seeAllUrl: r.seeAllUrl };
          return {
            searched: r.searched,
            items: r.items.map((a) => ({ address: `${a.address}, ${a.suburb}`, price: a.price, saving: a.saving, reasons: a.reasons, source: a.source, asOf: a.asOf })),
          };
        },
      }),
    },
  });

  return { answer: result.text.trim(), alternatives: alternatives as typeof alternatives, model: AGENT_MODEL };
}
