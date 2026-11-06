// Unit tests for deterministic agent tools (loan arithmetic and its disclaimer).
import { describe, expect, it } from "vitest";
import { ownershipCosts } from "../lib/agent-tools";

describe("ownershipCosts", () => {
  it("computes a standard principal-and-interest repayment and always carries a disclaimer", () => {
    const r = ownershipCosts({ price: 1_000_000, depositPct: 20, ratePct: 6, years: 30, strataAnnual: 12_000 });
    expect(r.assumptions.loan).toBe(800_000);
    expect(r.monthlyRepayment).toBe(4796); // 800k at 6% over 30 years
    expect(r.strataMonthly).toBe(1000);
    expect(r.monthlyTotal).toBe(5796);
    expect(r.disclaimer).toMatch(/bank or a mortgage broker/);
  });
  it("handles a zero rate", () => {
    expect(ownershipCosts({ price: 360_000, depositPct: 0, ratePct: 0, years: 30 }).monthlyRepayment).toBe(1000);
  });
});
