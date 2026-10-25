import { describe, expect, it } from "vitest";
import { addDays, clampDay, gw, HALF_HOURS, signedMw, ukTime } from "./format";

describe("format", () => {
  it("formats signed megawatts with a real minus sign", () => {
    expect(signedMw(1234.4)).toBe("+1,234 MW");
    expect(signedMw(-50)).toBe("−50 MW");
    expect(signedMw(null)).toBe("–");
  });

  it("shows UK local time, including summer time", () => {
    expect(ukTime("2026-01-15T09:00:00Z")).toBe("09:00");
    expect(ukTime("2026-06-15T09:00:00Z")).toBe("10:00");
  });

  it("does day arithmetic across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("clamps days to the pilot window", () => {
    expect(clampDay("2025-12-30", "2026-01-01", "2026-02-01")).toBe("2026-01-01");
    expect(clampDay("2026-01-10", "2026-01-01", "2026-02-01")).toBe("2026-01-10");
  });

  it("offers 48 half-hour decision times", () => {
    expect(HALF_HOURS).toHaveLength(48);
    expect(HALF_HOURS[19]).toBe("09:30");
    expect(gw(12345)).toBe("12.3 GW");
  });
});
