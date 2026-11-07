// Personal match score: turns facts the panel already has into 0-100 factor scores, then weights them by
// what the user says matters. Pure functions only, so the scoring is easy to test and explain.

export type FactorKey = "value" | "investment" | "transport" | "risk" | "budget";
export type Weights = Record<FactorKey, number>;
export type Profile = "buyer" | "investor" | "renter";

export const FACTOR_LABEL: Record<FactorKey, string> = {
  value: "Value for money",
  investment: "Investment",
  transport: "Getting around",
  risk: "Low risk",
  budget: "Within budget",
};

/** Starting weights (0 to 5) for each profile; the user can change them with the sliders. */
export const PRESETS: Record<Profile, Weights> = {
  buyer: { value: 5, investment: 1, transport: 4, risk: 4, budget: 5 },
  investor: { value: 4, investment: 5, transport: 2, risk: 3, budget: 3 },
  renter: { value: 5, investment: 0, transport: 5, risk: 3, budget: 5 },
};

export interface MatchInputs {
  mode: "sale" | "rent";
  /** Asking vs our estimate, in percent (negative means below the estimate). */
  askingVsEstimatePct: number | null;
  /** This street's median vs the suburb's, in percent. */
  streetVsSuburbPct: number | null;
  grossYieldPct: number | null;
  suburbYieldPct: number | null;
  /** Nearest rail, light rail or ferry stop in metres, and nearest bus stop. */
  railM: number | null;
  busM: number | null;
  /** Overlays flagged on the property itself (flood, heritage, power lines...). Null when not loaded. */
  overlaysOnProperty: string[] | null;
  floodNearestM: number | null;
  /** Price to compare with the budget: asking if known, otherwise our estimate. */
  price: number | null;
  budget: number | null;
}

export interface FactorScore {
  key: FactorKey;
  score: number | null;
  reason: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (n: number) => `${Math.abs(Math.round(n * 10) / 10)}%`;

export function scoreFactors(i: MatchInputs): FactorScore[] {
  const out: FactorScore[] = [];

  if (i.askingVsEstimatePct !== null) {
    const d = i.askingVsEstimatePct;
    out.push({ key: "value", score: clamp(50 - d * 5), reason: Math.abs(d) < 1 ? "Asking is in line with our estimate" : `Asking is ${pct(d)} ${d < 0 ? "below" : "above"} our estimate` });
  } else if (i.streetVsSuburbPct !== null) {
    const d = i.streetVsSuburbPct;
    out.push({ key: "value", score: clamp(50 - d * 2.5), reason: `This street sells ${pct(d)} ${d < 0 ? "below" : "above"} the suburb median` });
  } else out.push({ key: "value", score: null, reason: "No asking price or estimate to compare" });

  if (i.mode === "sale") {
    if (i.grossYieldPct !== null && i.suburbYieldPct) {
      const ratio = i.grossYieldPct / i.suburbYieldPct;
      out.push({ key: "investment", score: clamp(50 + (ratio - 1) * 125), reason: `Gross yield ${i.grossYieldPct}% vs ${i.suburbYieldPct}% for the suburb` });
    } else out.push({ key: "investment", score: null, reason: "Not enough rent data for a yield" });
  }

  if (i.railM !== null) {
    out.push({ key: "transport", score: clamp(i.railM <= 400 ? 100 : 100 - ((i.railM - 400) / 1100) * 80), reason: `Train, light rail or ferry ${i.railM} m away` });
  } else if (i.busM !== null) {
    out.push({ key: "transport", score: i.busM <= 200 ? 60 : 40, reason: `No rail within 1 km; bus stop ${i.busM} m away` });
  } else out.push({ key: "transport", score: null, reason: "Transport data not loaded yet" });

  if (i.overlaysOnProperty === null) out.push({ key: "risk", score: null, reason: "Overlay data not loaded yet" });
  else if (i.overlaysOnProperty.length) {
    const flood = i.overlaysOnProperty.some((o) => /flood/i.test(o));
    out.push({ key: "risk", score: flood ? 10 : 30, reason: `On the property: ${i.overlaysOnProperty.join(", ")}` });
  } else if (i.floodNearestM !== null && i.floodNearestM < 100) {
    out.push({ key: "risk", score: 60, reason: `No overlays on the property; flood area ${i.floodNearestM} m away` });
  } else out.push({ key: "risk", score: 90, reason: "No overlays on the property" });

  if (i.budget && i.price) {
    const over = ((i.price - i.budget) / i.budget) * 100;
    out.push({
      key: "budget",
      score: over <= 0 ? 100 : clamp(100 - over * 5),
      reason: over <= 0 ? `Price is within your budget` : `Price is ${pct(over)} over your budget`,
    });
  } else out.push({ key: "budget", score: null, reason: i.budget ? "No price to compare with your budget" : "Add a budget to include it" });

  return out;
}

/** Weighted average of the factors that have a score and a weight above zero; null when none do. */
export function matchScore(factors: FactorScore[], w: Weights): number | null {
  let sum = 0;
  let total = 0;
  for (const f of factors) {
    const weight = w[f.key] ?? 0;
    if (f.score === null || weight <= 0) continue;
    sum += f.score * weight;
    total += weight;
  }
  return total ? Math.round(sum / total) : null;
}
