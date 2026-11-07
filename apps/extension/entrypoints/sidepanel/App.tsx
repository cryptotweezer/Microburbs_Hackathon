// Side panel: follows the active tab's listing and lets the user correct the address.
// Buying or renting is automatic: the listing's own index (for sale / for rent) decides.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProperty, type Mode, type PropertyResponse } from "@/lib/api";
import type { TabListing } from "../background";
import { AgencyCard, AlternativesCard, BlockCard, ComparablesCard, DevelopmentCard, StreetCard, HistoryCard, MatchReceipt, RisksCard, SchoolsCard, SuburbPulseCard, TransportCard } from "./sections";
import { Overview } from "./overview";
import { Spinner } from "./ui";
import { Chat } from "./Chat";

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function readSavedMode(): Mode {
  try {
    return localStorage.getItem("mode") === "rent" ? "rent" : "sale";
  } catch {
    return "sale";
  }
}

export default function App() {
  const [listing, setListing] = useState<TabListing | null>(null);
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<Mode>(readSavedMode);
  const [data, setData] = useState<PropertyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const detailsRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (addr: string, m: Mode, gnaf?: string, auto = true, price?: number) => {
    if (!addr.trim()) return;
    const id = ++seq.current;
    const cacheKey = `resp:v3:${addr.trim().toLowerCase()}|${auto ? "auto" : m}|${gnaf ?? ""}|${price ?? ""}`;
    setError(null);
    // Revisiting a listing within 10 minutes reuses the last answer: no request at all.
    const hit = (await browser.storage.session.get(cacheKey).catch(() => ({}) as Record<string, unknown>))[cacheKey] as { at: number; r: PropertyResponse } | undefined;
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
      if (id === seq.current) {
        setData(hit.r);
        if (hit.r.mode) setMode(hit.r.mode);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const r = await fetchProperty(addr.trim(), m, gnaf, auto, price);
      if (id === seq.current) {
        // Drop stale answers from a previous listing.
        setData(r);
        if (r.mode) setMode(r.mode);
      }
      if (r.match.status === "exact-unit") void browser.storage.session.set({ [cacheKey]: { at: Date.now(), r } }).catch(() => {});
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  // Follow the listing open in the active tab.
  const applyListing = useCallback(
    (l: TabListing | null) => {
      setListing(l);
      if (l?.address) {
        const m = l.modeHint ?? readSavedMode();
        setMode(m);
        setAddress(l.address);
        void run(l.address, m);
      }
    },
    [run],
  );

  useEffect(() => {
    const refresh = async () => {
      const tabId = await activeTabId();
      if (tabId === undefined) return;
      const l = (await browser.runtime.sendMessage({ type: "get-listing", tabId }).catch(() => null)) as TabListing | null;
      applyListing(l);
    };
    void refresh();
    const onMsg = async (msg: { type: string; payload?: TabListing }) => {
      if (msg.type === "listing-update" && msg.payload && msg.payload.tabId === (await activeTabId())) applyListing(msg.payload);
    };
    browser.runtime.onMessage.addListener(onMsg);
    browser.tabs.onActivated.addListener(refresh);
    return () => {
      browser.runtime.onMessage.removeListener(onMsg);
      browser.tabs.onActivated.removeListener(refresh);
    };
  }, [applyListing]);

  // Only offered when the listing is not in Microburbs' data, so the mode is a guess from the page.
  const switchMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem("mode", m);
    } catch {
      /* storage unavailable: keep the in-memory choice */
    }
    void run(address, m, undefined, false);
  };
  const confirmed = data?.modeSource === "listing";

  const exact = data?.match.status === "exact-unit" && data.facts;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-gradient-to-r from-brand-900 via-brand-800 to-violet-brand px-3 py-2 text-white shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon/48.png" alt="" className="h-7 w-7 rounded-md bg-white p-0.5" />
            <div>
              <h1 className="text-sm font-bold tracking-tight">Listing Lens</h1>
              <p className="text-[10px] text-brand-100/80">Powered by Microburbs · City of Sydney</p>
            </div>
          </div>
          {data && !loading ? (
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                <span className={`h-2 w-2 rounded-full ${data.match.status === "exact-unit" ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
                {data.match.status === "exact-unit" ? "Address matched" : data.match.status === "unsupported" ? "Outside coverage" : "Check address"}
              </span>
              {data.match.status === "exact-unit" ? (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10.5px] font-semibold" title={confirmed ? "From Microburbs listings" : "Guessed from the page"}>
                  {mode === "sale" ? "For sale" : "For rent"}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void run(address, mode);
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Open a listing, or type an address"
            className="min-w-0 flex-1 rounded-md border border-white/20 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-brand-200"
          />
          <button className="rounded-md bg-white/20 px-3 text-sm font-medium text-white hover:bg-white/30">Check</button>
        </form>
        {data?.match.status === "exact-unit" && !confirmed && !loading ? (
          <p className="mt-1 text-[11px] text-brand-100/80">
            Not in Microburbs listings, so {mode === "sale" ? "for sale" : "for rent"} is a guess.{" "}
            <button className="font-semibold text-white underline" onClick={() => switchMode(mode === "sale" ? "rent" : "sale")}>
              Show as {mode === "sale" ? "for rent" : "for sale"}
            </button>
          </p>
        ) : null}
        {listing?.isListing === false ? <p className="mt-1 text-[11px] text-brand-100/80">Open a property listing to load it automatically.</p> : null}
      </header>

      <main className="space-y-3 p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Matching the exact property...
          </div>
        ) : null}
        {error ? <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
        {!data && !loading && !error ? (
          <p className="text-sm text-slate-500">Open a listing on realestate.com.au or domain.com.au in the City of Sydney, or type an address above.</p>
        ) : null}

        {data && !loading ? (
          <>
            {!exact ? <MatchReceipt match={data.match} onPick={(g) => void run(address, mode, g)} /> : null}
            {exact ? (
              <>
                <Overview
                  key={`ov|${data.match.gnafId}|${mode}`}
                  data={data}
                  mode={mode}
                  onPrice={(p) => void run(address, mode, data.match.gnafId ?? undefined, data.modeSource === "listing", p)}
                  onShowDetails={() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                />
                <Chat data={data} mode={mode} />
                <AlternativesCard
                  alt={data.alternatives}
                  mode={mode}
                  onOpen={(a) => {
                    setAddress(a);
                    void run(a, mode);
                  }}
                />
                <p ref={detailsRef} className="scroll-mt-28 px-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                  Full property report
                </p>
                <div className="space-y-2" key={`${data.match.gnafId}|${mode}`}>
                  {mode === "sale" ? <AgencyCard f={data.facts!} /> : null}
                  {mode === "sale" ? <ComparablesCard f={data.facts!} /> : null}
                  <StreetCard data={data} />
                  {data.match.suburb ? <SuburbPulseCard suburb={data.match.suburb} mode={mode} /> : null}
                  <BlockCard gnaf={data.match.gnafId!} />
                  {data.match.suburb ? <DevelopmentCard suburb={data.match.suburb} /> : null}
                  <SchoolsCard gnaf={data.match.gnafId!} />
                  <HistoryCard gnaf={data.match.gnafId!} />
                  <TransportCard gnaf={data.match.gnafId!} />
                  <RisksCard gnaf={data.match.gnafId!} />
                </div>
              </>
            ) : null}
            <p className="px-1 text-[10.5px] leading-snug text-slate-400">
              Data from Microburbs, matched by G-NAF address. Estimates are indicative, not financial advice. When there is no data we say so instead of guessing.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
