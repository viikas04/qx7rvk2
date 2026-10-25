import { describe, expect, it } from "vitest";
import { errorColor, mix, parseColor } from "./heat";

const palette = { neutral: [255, 255, 255], short: [200, 0, 0], surplus: [0, 150, 0] } as const;

describe("heat colours", () => {
  it("parses hex and rgb() colours", () => {
    expect(parseColor("#b5402c")).toEqual([181, 64, 44]);
    expect(parseColor(" #fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
  });

  it("mixes linearly", () => {
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
  });

  it("maps zero error to neutral and big errors to full colour", () => {
    const p = palette as unknown as Parameters<typeof errorColor>[2];
    expect(errorColor(0, 3000, p)).toEqual([255, 255, 255]);
    expect(errorColor(5000, 3000, p)).toEqual([200, 0, 0]);
    expect(errorColor(-5000, 3000, p)).toEqual([0, 150, 0]);
  });
});
