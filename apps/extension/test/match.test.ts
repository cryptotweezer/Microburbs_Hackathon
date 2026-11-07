// Match score tests: factor scoring from panel facts, missing data, and weighting by the user's sliders.
import { describe, expect, it } from "vitest";
import { matchScore, type MatchInputs, PRESETS, scoreFactors } from "../lib/match";

const base: MatchInputs = {
  mode: "sale",
  askingVsEstimatePct: -6,
  streetVsSuburbPct: -12,
  grossYieldPct: 5.7,
  suburbYieldPct: 4.6,
  railM: 350,
  busM: 40,
  overlaysOnProperty: [],
  floodNearestM: 600,
  price: 800_000,
  budget: 850_000,
};
const byKey = (i: MatchInputs) => Object.fromEntries(scoreFactors(i).map((f) => [f.key, f]));

describe("scoreFactors", () => {
  it("scores a fairly priced, well located listing highly", () => {
    const f = byKey(base);
    expect(f.value!.score).toBe(80);
    expect(f.investment!.score).toBeGreaterThan(70);
    expect(f.transport!.score).toBe(100);
    expect(f.risk!.score).toBe(90);
    expect(f.budget!.score).toBe(100);
  });

  it("penalises an overpriced listing, flood on the property and going over budget", () => {
    const f = byKey({ ...base, askingVsEstimatePct: 12, overlaysOnProperty: ["Flood"], budget: 700_000 });
    expect(f.value!.score).toBe(0);
    expect(f.risk!.score).toBe(10);
    expect(f.budget!.score).toBe(29);
  });

  it("marks missing facts as null instead of guessing, and hides investment for rentals", () => {
    const f = byKey({ ...base, mode: "rent", askingVsEstimatePct: null, streetVsSuburbPct: null, railM: null, busM: null, overlaysOnProperty: null, budget: null });
    expect(f.value!.score).toBeNull();
    expect(f.transport!.score).toBeNull();
    expect(f.risk!.score).toBeNull();
    expect(f.budget!.score).toBeNull();
    expect(f.investment).toBeUndefined();
  });
});

describe("matchScore", () => {
  it("weights factors by the sliders and skips missing ones", () => {
    const factors = scoreFactors({ ...base, budget: null });
    const s = matchScore(factors, PRESETS.buyer)!;
    expect(s).toBeGreaterThan(80);
    expect(matchScore(factors, { value: 1, investment: 0, transport: 0, risk: 0, budget: 5 })).toBe(80); // budget missing, value only
  });

  it("returns null when nothing can be scored", () => {
    expect(matchScore([{ key: "value", score: null, reason: "" }], PRESETS.buyer)).toBeNull();
  });
});
