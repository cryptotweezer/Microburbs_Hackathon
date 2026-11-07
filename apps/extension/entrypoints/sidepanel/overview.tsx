// Overview: the first screen of the panel. One headline estimate with its confidence, four key tiles and a
// short local context list. Every value comes from data the panel already loads, or says there is none.
import type React from "react";
import { useEffect } from "react";
import { fetchDevelopments, fetchSection, type Mode, type PropertyResponse, type Verdict } from "@/lib/api";
import { MatchCard } from "./match-card";
import { AskingPriceInput } from "./sections";
import { Badge, money, short, Source, useLazy } from "./ui";

type Level = "High" | "Medium" | "Low";

/** Confidence comes from the method behind the estimate, never from a made-up percentage. */
function confidenceOf(v: Verdict | undefined, sameBuilding: boolean): Level | null {
  if (!v?.estimate || !v.method) return null;
  if (v.method === "avm" || v.method === "rent-model") return "High";
  if (v.method === "cma" && sameBuilding) return "Medium";
  return "Low";
}

const CONFIDENCE_HELP: Record<Level, string> = {
  High: "Microburbs valuation model or our validated rent model",
  Medium: "Based on a recent sale in the same building",
  Low: "Based on nearby comparables only, treat as a rough guide",
};

function ConfidenceRing({ level }: { level: Level }) {
  const share = { High: 0.9, Medium: 0.6, Low: 0.3 }[level];
  const color = { High: "text-emerald-500", Medium: "text-amber-500", Low: "text-rose-500" }[level];
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5" title={CONFIDENCE_HELP[level]}>
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-slate-200" />
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke="currentColor" className={color} strokeDasharray={`${c * share} ${c}`} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-900">{level}</span>
      </div>
      <span className="text-[10.5px] text-slate-500">Confidence</span>
    </div>
  );
}

const ESTIMATE_LABEL: Record<string, string> = {
  avm: "Microburbs estimate",
  cma: "Comparable sale estimate",
  comparables: "Comparables estimate",
  "agent-quoting": "Likely sale price",
  "rent-model": "Fair rent",
  "market-rent": "Market rent",
};

function Hero({ data, mode }: { data: PropertyResponse; mode: Mode }) {
  const v = data.verdict;
  const rent = mode === "rent";
  const level = confidenceOf(v, !!data.facts?.cma.value?.same_building);
  const tone = { below: "green", "in-line": "blue", above: "red", unknown: "slate" } as const;
  const word = { below: "below", "in-line": "in line with", above: "above", unknown: "" } as const;
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-brand-50 p-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-brand-800">{(v?.method && ESTIMATE_LABEL[v.method]) || (rent ? "Fair rent" : "Estimate")}</p>
        {v?.estimate ? (
          <>
            <p className="text-3xl font-extrabold leading-tight tracking-tight text-brand-900">{money(v.estimate, rent)}</p>
            {v.low && v.high ? (
              <p className="text-sm font-semibold text-slate-600">
                {short(v.low)} to {short(v.high)}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-slate-500">Estimate, not the asking {rent ? "rent" : "price"}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500">No estimate for this property yet.</p>
        )}
        {v?.asking ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
            Asking <strong className="text-lg font-bold text-slate-900">{money(v.asking, rent)}</strong>
            {v.label !== "unknown" && v.diffPct !== null ? (
              <Badge tone={tone[v.label]}>
                {v.label === "in-line" ? "in line" : `${Math.abs(Math.round(v.diffPct * 10) / 10)}% ${word[v.label]}`}
              </Badge>
            ) : null}
          </p>
        ) : null}
      </div>
      {level ? <ConfidenceRing level={level} /> : null}
    </div>
  );
}

/* Small line icons (24px grid), drawn inline so there is no icon dependency. */
const ICON: Record<string, string> = {
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  bars: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  scale: "M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8",
  car: "M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3zM7 13h.01M17 13h.01",
  key: "M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z",
  doc: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  pillar: "M4 21h16M6 18V9M10 18V9M14 18V9M18 18V9M3 9l9-6 9 6z",
  train: "M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM4 11h16M8 21l2-3M16 21l-2-3M8 15h.01M16 15h.01",
};
function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICON[name]} />
    </svg>
  );
}

function Tile({ icon, label, value, sub }: { icon: string; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-brand-600">
          <Icon name={icon} />
        </span>
        {label}
      </p>
      <p className="mt-0.5 text-base font-bold leading-tight text-slate-900">{value}</p>
      {sub ? <p className="text-[11px] leading-snug text-slate-500">{sub}</p> : null}
    </div>
  );
}
const Missing = () => <span className="text-sm font-medium text-slate-400">No data</span>;
const signed = (p: number) => `${p > 0 ? "+" : ""}${Math.round(p * 10) / 10}%`;

function SaleTiles({ data }: { data: PropertyResponse }) {
  const f = data.facts!;
  const cma = f.cma.value;
  const prices = (f.comparables.value ?? []).map((c) => c.price).filter((p): p is number => !!p);
  const street = data.insights?.street;
  const y = data.insights?.yield;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile
        icon="calendar"
        label={cma?.same_building ? "Sold in this building" : "Best comparable"}
        value={cma?.price ? money(cma.price) : <Missing />}
        sub={cma?.date_sold ?? undefined}
      />
      <Tile
        icon="bars"
        label="Nearby sales"
        value={prices.length ? (prices.length > 1 ? `${short(Math.min(...prices))} to ${short(Math.max(...prices))}` : short(prices[0]!)) : <Missing />}
        sub={prices.length ? `${prices.length} sale${prices.length > 1 ? "s" : ""} nearby` : undefined}
      />
      <Tile
        icon="trend"
        label="Street vs suburb"
        value={street?.diffPct !== null && street?.diffPct !== undefined ? signed(street.diffPct) : <Missing />}
        sub={street?.thisStreet ? `${street.street}, ${street.thisStreet.sales} sales` : undefined}
      />
      <Tile
        icon="scale"
        label="Price vs rent"
        value={y ? `${y.grossYieldPct}% yield` : <Missing />}
        sub={y ? (y.suburbYieldPct ? `Suburb ${y.suburbYieldPct}%` : y.note) : undefined}
      />
    </div>
  );
}

function RentTiles({ data }: { data: PropertyResponse }) {
  const r = data.rent?.available ? data.rent.value : null;
  const lease = (data.facts?.rentHistory.value ?? []).filter((h) => h.price).at(-1);
  const asking = data.facts?.listing.value?.price;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile icon="car" label="Fair rent with car space" value={r ? money(r.rentWithCarSpace, true) : <Missing />} />
      <Tile icon="key" label="Fair rent without car" value={r ? money(r.rentWithoutCarSpace, true) : <Missing />} sub={r ? `Car space worth ${money(r.rentWithCarSpace - r.rentWithoutCarSpace, true)}` : undefined} />
      <Tile icon="calendar" label="Last leased" value={lease?.price ? money(lease.price, true) : <Missing />} sub={lease?.date} />
      <Tile icon="bars" label="Asking rent" value={asking ? money(asking, true) : <Missing />} sub={data.facts?.listing.value?.listingDate ? `Listed ${data.facts.listing.value.listingDate}` : undefined} />
    </div>
  );
}

type RiskRow = { name?: string | null; value?: string | null; on_property?: boolean | null; nearest_distance_m?: number | null };
function overlay(rows: RiskRow[] | null | undefined) {
  if (!rows?.length) return "None recorded";
  if (rows.some((r) => r.on_property)) return "On property";
  const d = Math.min(...rows.map((r) => r.nearest_distance_m ?? Infinity));
  return Number.isFinite(d) ? `Nearest ${d} m` : "Nearby";
}

function ContextRow({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5">
      <span className="flex items-center gap-2 text-slate-700">
        <span className="text-slate-500">
          <Icon name={icon} />
        </span>
        {label}
      </span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </li>
  );
}

/** Loads risks, transport and development applications as soon as the overview shows (shared by the match card). */
function useLocalData(gnaf: string, suburb: string | null) {
  const risks = useLazy(() => fetchSection(gnaf, "risks"));
  const transport = useLazy(() => fetchSection(gnaf, "transport"));
  const das = useLazy(() => (suburb ? fetchDevelopments(suburb) : Promise.reject(new Error("no suburb"))));
  useEffect(() => {
    risks.start();
    transport.start();
    das.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { risks, transport, das };
}
export type LocalData = ReturnType<typeof useLocalData>;

function LocalContext({ local }: { local: LocalData }) {
  const { risks, transport, das } = local;
  const wait = (s: string) => (s === "loading" || s === "idle" ? <span className="text-slate-400">...</span> : <span className="text-slate-400">No data</span>);
  const r = risks.data?.risks.value as Record<string, RiskRow[] | null> | null | undefined;
  const n = transport.data?.transport.value?.nearest;
  const stop = n ? (["train", "tram", "ferry", "bus"] as const).map((m) => ({ m, s: n[m] })).find((x) => x.s) : undefined;
  const stopLabel = { train: "Train or light rail", tram: "Light rail", ferry: "Ferry", bus: "Bus stop" } as const;
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Local context <span className="h-px flex-1 bg-slate-200" />
      </p>
      <ul className="divide-y divide-slate-100 text-xs">
        <ContextRow
          icon="doc"
          label="Planning applications"
          value={das.data?.lastTwelveMonths !== undefined ? `${das.data.lastTwelveMonths} in suburb, 12 months` : wait(das.status)}
        />
        <ContextRow icon="home" label="Public housing" value={r ? overlay(r.public_housing) : wait(risks.status)} />
        <ContextRow icon="shield" label="Flood overlay" value={r ? overlay(r.flood) : wait(risks.status)} />
        <ContextRow icon="pillar" label="Heritage overlay" value={r ? overlay(r.heritage) : wait(risks.status)} />
        <ContextRow
          icon="train"
          label="Nearest transport"
          value={stop?.s ? `${stopLabel[stop.m]}, ${stop.s.distance_m} m` : transport.status === "done" ? "None within 1 km" : wait(transport.status)}
        />
      </ul>
    </div>
  );
}

export function Overview({ data, mode, onShowDetails, onPrice }: { data: PropertyResponse; mode: Mode; onShowDetails: () => void; onPrice: (n: number) => void }) {
  const refreshed = (data.generatedAt ?? "").slice(0, 10);
  const f = data.facts!;
  const l = f.listing.value;
  const q = f.agentQuoting.value;
  const local = useLocalData(data.match.gnafId ?? "", data.match.suburb);
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div>
        <p className="text-sm font-semibold leading-snug text-slate-900">{data.match.matchedAddress ?? data.match.normalized}</p>
        <p className="text-[11px] text-slate-500">
          {l ? `${l.bedrooms ?? "?"} bed · ${l.bathrooms ?? "?"} bath · ${l.parking ?? 0} car${l.buildingSize ? ` · ${l.buildingSize} m2` : ""} · ` : ""}G-NAF {data.match.gnafId}
        </p>
        {data.match.note ? <p className="mt-0.5 text-[11px] text-slate-500">{data.match.note}</p> : null}
      </div>
      <Hero data={data} mode={mode} />
      {mode === "sale" && q?.likely_sale_price && data.verdict?.method !== "agent-quoting" ? (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          Likely to sell for about <strong>{money(q.likely_sale_price)}</strong>, based on how {q.agency_name ?? "this agency"} usually quotes ({q.total_sales ?? 0} sales
          {(q.total_sales ?? 0) < 10 ? ", weak signal" : ""}).
        </p>
      ) : null}
      {!l?.price && (!l?.listedFor || l.listedFor === mode) ? <AskingPriceInput mode={mode} onPrice={onPrice} /> : null}
      {f.listing.userPrice ? <p className="-mt-2 text-[11px] text-slate-500">Asking price entered by you, not from Microburbs.</p> : null}
      <MatchCard data={data} mode={mode} local={local} />
      {mode === "sale" ? <SaleTiles data={data} /> : <RentTiles data={data} />}
      <LocalContext local={local} />
      <div className="flex items-center justify-between gap-2 pt-1">
        <button onClick={onShowDetails} className="rounded-lg bg-brand-900 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-800">
          View full property report →
        </button>
        {refreshed ? <span className="text-[10.5px] text-slate-400">Data refreshed {refreshed}</span> : null}
      </div>
      {data.verdict?.note ? <p className="text-[11px] leading-snug text-slate-500">{data.verdict.note}</p> : null}
      <div>
        <Source source={data.facts!.listing.source} asOf={data.facts!.listing.asOf} />
        {data.verdict?.sources.map((s) => <Source key={s} source={s} />)}
        {data.rent?.available ? <Source source={data.rent.source} asOf={data.rent.asOf} /> : null}
      </div>
    </section>
  );
}
