// "Your match" card: the user picks a profile and adjusts sliders; the card scores how well this property fits.
// Preferences stay in the browser (extension storage), with no account and nothing sent to the server.
import { useEffect, useMemo, useState } from "react";
import type { Mode, PropertyResponse } from "@/lib/api";
import { FACTOR_LABEL, type FactorKey, matchScore, type MatchInputs, PRESETS, type Profile, scoreFactors, type Weights } from "@/lib/match";
import type { LocalData } from "./overview";

// The listing decides sale vs rent: rentals are always scored as a renter; on a sale only the user knows
// whether they are buying to live in or to invest. Preferences are saved separately for each.
interface Prefs {
  profile: Profile;
  weights: Weights;
  budget: number | null;
  /** True once the user has set anything; the score stays hidden until then. */
  touched?: boolean;
}
const keyFor = (mode: Mode) => `match:v2:${mode}`;
const defaults = (mode: Mode): Prefs => {
  const profile: Profile = mode === "rent" ? "renter" : "buyer";
  return { profile, weights: { ...PRESETS[profile] }, budget: null };
};
const validFor = (mode: Mode, p: Profile) => (mode === "rent" ? p === "renter" : p !== "renter");

type RiskRow = { name?: string | null; on_property?: boolean | null; nearest_distance_m?: number | null };
const IGNORED_LAYERS = new Set(["public_housing", "mobile_black_spot"]);

function inputsFrom(data: PropertyResponse, mode: Mode, local: LocalData, budget: number | null): MatchInputs {
  const v = data.verdict;
  const risks = local.risks.data?.risks.value as Record<string, RiskRow[] | null> | null | undefined;
  const near = local.transport.data?.transport.value?.nearest;
  const rail = near ? (["train", "tram", "ferry"] as const).map((m) => near[m]?.distance_m).filter((d): d is number => typeof d === "number") : [];
  const flood = risks?.flood ?? [];
  return {
    mode,
    askingVsEstimatePct: v?.asking && v.estimate && v.diffPct !== null ? v.diffPct : null,
    streetVsSuburbPct: data.insights?.street?.diffPct ?? null,
    grossYieldPct: data.insights?.yield?.grossYieldPct ?? null,
    suburbYieldPct: data.insights?.yield?.suburbYieldPct ?? null,
    railM: rail.length ? Math.min(...rail) : null,
    busM: near?.bus?.distance_m ?? null,
    overlaysOnProperty:
      local.risks.status === "done" && risks
        ? Object.entries(risks)
            .filter(([k, rows]) => !IGNORED_LAYERS.has(k) && rows?.some((r) => r.on_property))
            .map(([k, rows]) => rows?.[0]?.name ?? k)
        : null,
    floodNearestM: flood.length ? Math.min(...flood.map((r) => r.nearest_distance_m ?? Infinity)) : null,
    price: v?.asking ?? v?.estimate ?? null,
    budget,
  };
}

const tone = (s: number) => (s >= 70 ? "text-emerald-600" : s >= 45 ? "text-amber-600" : "text-rose-600");
const bar = (s: number) => (s >= 70 ? "bg-emerald-500" : s >= 45 ? "bg-amber-500" : "bg-rose-500");
const fit = (s: number) => (s >= 70 ? "Strong fit for you" : s >= 45 ? "Fair fit for you" : "Weak fit for you");

export function MatchCard({ data, mode, local }: { data: PropertyResponse; mode: Mode; local: LocalData }) {
  const [prefs, setPrefs] = useState<Prefs>(() => defaults(mode));
  const [why, setWhy] = useState(false);
  const [budgetRaw, setBudgetRaw] = useState("");

  // Load saved preferences once; any storage failure just keeps the defaults.
  useEffect(() => {
    browser.storage.local
      .get(keyFor(mode))
      .then((r) => {
        const saved = r[keyFor(mode)] as Prefs | undefined;
        if (saved?.weights && validFor(mode, saved.profile)) {
          setPrefs(saved);
          if (saved.budget) setBudgetRaw(String(saved.budget));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = (p: Prefs) => {
    const next = { ...p, touched: true };
    setPrefs(next);
    void browser.storage.local.set({ [keyFor(mode)]: next }).catch(() => {});
  };
  const ready = !!prefs.touched;
  const showSliders = true; // Sliders stay visible: changing them is how the user sets the match.

  const budget = prefs.budget;
  const factors = useMemo(() => scoreFactors(inputsFrom(data, mode, local, budget)), [data, mode, local, budget]);
  const score = matchScore(factors, prefs.weights);
  const shown = factors.filter((f) => (prefs.weights[f.key] ?? 0) > 0);

  const setBudget = (raw: string) => {
    setBudgetRaw(raw);
    const n = Number(raw.replace(/[^0-9.]/g, "")) * (/k$/i.test(raw.trim()) ? 1000 : /m$/i.test(raw.trim()) ? 1_000_000 : 1);
    const value = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    save({ ...prefs, budget: value });
  };

  return (
    <div className="rounded-xl border border-brand-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brand-800">{ready ? `Your match${mode === "rent" ? " as a renter" : ""}` : "What matters to you?"}</p>
        {mode === "sale" ? (
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px]">
          {(["buyer", "investor"] as const).map((p) => (
            <button
              key={p}
              onClick={() => save({ ...prefs, profile: p, weights: { ...PRESETS[p] } })}
              className={`rounded-md px-2 py-0.5 font-medium capitalize ${prefs.profile === p ? "bg-white text-brand-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {p === "buyer" ? "To live in" : "To invest"}
            </button>
          ))}
        </div>
        ) : null}
      </div>

      {!ready ? (
        <p className="mt-1 text-[11px] leading-snug text-slate-600">
          Move a slider to see how well this place fits you.{" "}
          <button onClick={() => save(prefs)} className="font-medium text-brand-600 underline hover:text-brand-800">
            Use suggested settings
          </button>
        </p>
      ) : score !== null ? (
        <p className="mt-1 flex items-baseline gap-2">
          <span className={`text-3xl font-extrabold ${tone(score)}`}>{score}%</span>
          <span className="text-xs text-slate-600">{fit(score)}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Not enough data yet to score this property for you.</p>
      )}

      {ready ? (
        <button onClick={() => setWhy(!why)} className="mt-1 text-[11px] font-medium text-slate-500 hover:text-slate-700" aria-expanded={why}>
          {why ? "Hide why" : "Why this score?"} {why ? "▴" : "▾"}
        </button>
      ) : null}
      <ul className={ready && why ? "mt-2 space-y-1.5" : "hidden"}>
        {shown.map((f) => (
          <li key={f.key}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-700">{FACTOR_LABEL[f.key]}</span>
              <span className={f.score === null ? "text-slate-400" : `font-semibold ${tone(f.score)}`}>{f.score === null ? "n/a" : f.score}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              {f.score !== null ? <div className={`h-full rounded-full ${bar(f.score)}`} style={{ width: `${f.score}%` }} /> : null}
            </div>
            <p className="text-[10.5px] leading-snug text-slate-500">{f.reason}</p>
          </li>
        ))}
      </ul>

      {showSliders ? (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
          {(Object.keys(FACTOR_LABEL) as FactorKey[])
            .filter((k) => !(k === "investment" && mode === "rent"))
            .map((k) => (
              <label key={k} className="flex items-center gap-2 text-[11px] text-slate-700">
                <span className="w-24 shrink-0">{FACTOR_LABEL[k]}</span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={prefs.weights[k]}
                  onChange={(e) => save({ ...prefs, weights: { ...prefs.weights, [k]: Number(e.target.value) } })}
                  className="flex-1 accent-brand-600"
                />
                <span className="w-3 text-right font-semibold">{prefs.weights[k]}</span>
              </label>
            ))}
          <label className="flex items-center gap-2 text-[11px] text-slate-700">
            <span className="w-24 shrink-0">Your budget</span>
            <input
              value={budgetRaw}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="numeric"
              placeholder={mode === "rent" ? "e.g. 900 per week" : "e.g. 850k"}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] outline-none focus:border-brand-500"
            />
          </label>
        </div>
      ) : null}
      <p className="mt-2 text-[10px] leading-snug text-slate-400">Scored from the facts in this panel. Your settings stay in this browser.</p>
    </div>
  );
}
