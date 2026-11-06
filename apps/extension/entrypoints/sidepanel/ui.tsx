// Small presentational building blocks for the side panel.
import { type ReactNode, useState } from "react";

export const money = (n: number | null | undefined, perWeek = false) =>
  n === null || n === undefined ? "n/a" : `$${Math.round(n).toLocaleString("en-AU")}${perWeek ? "/wk" : ""}`;

export const short = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : n >= 10_000 ? `$${Math.round(n / 1000)}k` : money(n);

/** Every number in the panel shows where it came from and when. */
export function Source({ source, asOf }: { source: string; asOf?: string | null }) {
  const label = source.startsWith("/v1/") ? `Microburbs ${source.replace("/v1/", "").replace(/\{[a-z]+\}\//g, "")}` : source;
  return (
    <p className="mt-1 text-[10.5px] leading-tight text-slate-400">
      Source: {label}
      {asOf ? ` · ${asOf}` : ""}
    </p>
  );
}

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function NoData({ children = "No data" }: { children?: ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "slate" | "blue"; children: ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    blue: "bg-sky-50 text-sky-700 ring-sky-200",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}>{children}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-lg font-semibold leading-tight text-slate-900">{value}</p>
      {sub ? <p className="text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />;
}

/** Collapsed card for secondary information. Children render only once opened. */
export function Fold({ title, hint, children, onOpen }: { title: string; hint?: string; children: ReactNode; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-brand-50"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
          {hint && !open ? <span className="block text-[11px] text-slate-400">{hint}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-brand-600">
          {open ? "Hide" : "Show"}
          <span className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            ▾
          </span>
        </span>
      </button>
      {open ? <div className="border-t border-slate-100 px-3 pb-3 pt-2">{children}</div> : null}
    </section>
  );
}

/** Loads data once, on demand. */
export function useLazy<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; data: T | null }>({ status: "idle", data: null });
  const start = () => {
    if (state.status !== "idle" && state.status !== "error") return;
    setState({ status: "loading", data: null });
    load().then(
      (data) => setState({ status: "done", data }),
      () => setState({ status: "error", data: null }),
    );
  };
  return { ...state, start };
}

export function LazyBody<T>({ lazy, children }: { lazy: { status: string; data: T | null }; children: (d: T) => ReactNode }) {
  if (lazy.status === "loading" || lazy.status === "idle") return <Spinner />;
  if (lazy.status === "error" || !lazy.data) return <NoData>Could not load this right now.</NoData>;
  return <>{children(lazy.data)}</>;
}
