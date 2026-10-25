import { describe, expect, it } from "vitest";
import { planReserve, quantileSorted } from "./stats";

describe("stats", () => {
  it("matches numpy's linear quantile", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantileSorted(xs, 0.9)).toBeCloseTo(9.1);
    expect(quantileSorted(xs, 0.5)).toBeCloseTo(5.5);
    expect(quantileSorted([], 0.5)).toBeNull();
  });

  it("plans a backup that covers the requested share of periods", () => {
    const errors = Array.from({ length: 100 }, (_, i) => i * 10); // 0..990 MW short
    const plan = planReserve(errors, 0.9)!;
    expect(plan.reserveMw).toBeCloseTo(891);
    expect(plan.shortPeriods).toBe(10);
    expect(plan.worstUncoveredMw).toBeCloseTo(99);
  });

  it("never asks for negative backup", () => {
    expect(planReserve([-500, -200, -100], 0.9)!.reserveMw).toBe(0);
  });
});
