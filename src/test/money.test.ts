// @vitest-environment node
/** Real-backend money (src/lib/money.ts): integer satang, string parsing, display. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatSatang,
  MAX_SATANG,
  MONEY_INPUT_ERRORS as E,
  parseBahtToSatang,
  productPricingErrorSatang,
  satangToInput,
} from "@/lib/money";

const ok = (input: string) => {
  const r = parseBahtToSatang(input);
  if (!r.ok) throw new Error(`${input}: ${r.error}`);
  return r.satang;
};
const err = (input: string) => {
  const r = parseBahtToSatang(input);
  return r.ok ? `accepted as ${r.satang}` : r.error;
};

describe("parseBahtToSatang", () => {
  it("accepts plain, comma-grouped and decimal amounts", () => {
    expect(ok("1800")).toBe(180_000);
    expect(ok("1,800")).toBe(180_000);
    expect(ok("1800.50")).toBe(180_050);
    expect(ok("1,800.5")).toBe(180_050);
    expect(ok("1,800.05")).toBe(180_005);
    expect(ok("1,234,567.89")).toBe(123_456_789);
    expect(ok("0")).toBe(0);
    expect(ok("0.00")).toBe(0);
    expect(ok("0.01")).toBe(1);
  });

  it("is exact where floating point is not (0.1, 0.29, 1.15, 1800.10, 4.35)", () => {
    // In floating point: 0.29 * 100 = 28.999999999999996, 1.15 * 100 = 114.99999999999999.
    expect(ok("0.1")).toBe(10);
    expect(ok("0.29")).toBe(29);
    expect(ok("1.15")).toBe(115);
    expect(ok("1800.10")).toBe(180_010);
    expect(ok("4.35")).toBe(435);
    for (let s = 0; s < 100_000; s += 7) expect(ok(satangToInput(s))).toBe(s);
  });

  it("ignores surrounding whitespace only", () => {
    expect(ok("  1800.50\t")).toBe(180_050);
    expect(ok("\n1,800\n")).toBe(180_000);
    for (const bad of ["1 800", "1800 .50", "1800. 50", "1,800 .5"])
      expect(err(bad)).toBe(E.format);
  });

  it("rejects more than 2 decimals", () => {
    for (const bad of ["1.005", "0.001", "1800.500", "1,800.123"])
      expect(err(bad), bad).toBe(E.decimals);
  });

  it("rejects negatives", () => {
    for (const bad of ["-1", "-0.50", "−5", " -1800"]) expect(err(bad), bad).toBe(E.negative);
  });

  it("rejects absurd amounts: the upper bound is ฿10,000,000.00", () => {
    expect(ok("10,000,000")).toBe(MAX_SATANG);
    expect(ok("10000000.00")).toBe(MAX_SATANG);
    for (const bad of ["10,000,000.01", "10000001", "99999999", "123456789", "9".repeat(40)])
      expect(err(bad), bad).toBe(E.tooLarge);
  });

  it("rejects junk, wrong grouping and number syntax JavaScript would accept", () => {
    for (const bad of [
      "abc",
      "1800abc",
      "฿1800",
      "1800฿",
      "1.800,50",
      "18,00",
      "1,8000",
      ",1800",
      "1800,",
      ".5",
      "5.",
      "1..5",
      "007",
      "00.5",
      "+5",
      "1e3",
      "0x10",
      "Infinity",
      "NaN",
      "１８００", // full-width digits
      "๑๘๐๐", // Thai digits
    ])
      expect(err(bad), bad).toBe(E.format);
    expect(err("")).toBe(E.empty);
    expect(err("   ")).toBe(E.empty);
  });

  it("uses no floating-point parsing (no parseFloat / Number of a decimal string)", () => {
    const src = readFileSync("src/lib/money.ts", "utf8");
    expect(src).not.toMatch(/parseFloat|toFixed|Math\.round|\* ?100\)?\s*$/m);
  });
});

describe("display: always two decimals, ฿1,800.00 style", () => {
  it("formats satang with grouping and two decimals", () => {
    expect(formatSatang(180_000)).toBe("฿1,800.00");
    expect(formatSatang(180_050)).toBe("฿1,800.50");
    expect(formatSatang(5)).toBe("฿0.05");
    expect(formatSatang(0)).toBe("฿0.00");
    expect(formatSatang(MAX_SATANG)).toBe("฿10,000,000.00");
    expect(formatSatang(-150)).toBe("-฿1.50");
    expect(formatSatang(1.5)).toBe("฿—");
    expect(formatSatang(Number.NaN)).toBe("฿—");
  });

  it("round-trips: input → satang → display → satang, and satang → form value → satang", () => {
    for (const [typed, shown] of [
      ["1800", "฿1,800.00"],
      ["1,800.5", "฿1,800.50"],
      ["0.1", "฿0.10"],
      ["1,234,567.89", "฿1,234,567.89"],
    ] as const) {
      const satang = ok(typed);
      expect(formatSatang(satang)).toBe(shown);
      expect(ok(formatSatang(satang).replace("฿", ""))).toBe(satang);
      expect(ok(satangToInput(satang))).toBe(satang);
    }
    expect(satangToInput(180_050)).toBe("1800.50");
    expect(satangToInput(180_000)).toBe("1800.00");
  });
});

describe("productPricingErrorSatang (the server's rule)", () => {
  const base = { priceSatang: 50_000, minimumSellingPriceSatang: 35_000 };
  it("accepts valid satang prices, with a per-product minimum (no universal minimum)", () => {
    expect(productPricingErrorSatang(base)).toBeUndefined();
    expect(
      productPricingErrorSatang({ priceSatang: 1, minimumSellingPriceSatang: 0, costSatang: 0 }),
    ).toBeUndefined();
    expect(
      productPricingErrorSatang({ priceSatang: MAX_SATANG, minimumSellingPriceSatang: MAX_SATANG }),
    ).toBeUndefined();
  });

  it("rejects fractions of a satang, out-of-range values and minimum above price", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_SATANG + 1])
      expect(productPricingErrorSatang({ ...base, priceSatang: bad }), String(bad)).toMatch(
        /^Selling price/,
      );
    for (const bad of [-1, 0.5, MAX_SATANG + 1])
      expect(
        productPricingErrorSatang({ ...base, minimumSellingPriceSatang: bad }),
        String(bad),
      ).toMatch(/^Minimum selling price must/);
    for (const bad of [-1, 0.5, MAX_SATANG + 1])
      expect(productPricingErrorSatang({ ...base, costSatang: bad }), String(bad)).toMatch(/^Cost/);
    expect(productPricingErrorSatang({ ...base, minimumSellingPriceSatang: 50_001 })).toBe(
      "Minimum selling price cannot be higher than the selling price.",
    );
  });
});
