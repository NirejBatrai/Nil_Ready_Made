/**
 * Money for the REAL backend (owner pages, product service, server functions). All money is
 * integer satang (฿1 = 100 satang); never floats. The demo keeps its own whole-baht rules in
 * src/lib/calc.ts and does not use this file.
 *
 * - `parseBahtToSatang` turns what a person typed ("1800", "1,800", "1800.50") into satang using
 *   string and integer operations only: no decimal number is ever created, so values such as
 *   "0.1" or "1800.10" cannot pick up floating-point error.
 * - `formatSatang` always shows two decimals: ฿1,800.00, ฿1,800.50.
 * - `productPricingErrorSatang` is the per-product price rule on satang values (the server checks
 *   it again; nothing from the browser is trusted). There is no universal minimum price.
 *
 * Browser-importable: no server code here.
 */

/** Upper bound for any single amount: ฿10,000,000.00. */
export const MAX_SATANG = 1_000_000_000;

const MAX_INPUT_LENGTH = 32;
/**
 * Digits with optional correctly placed thousands commas ("1,800", "12,345,678"), then optionally
 * a dot and 1–2 digits. No sign, no leading dot, no spaces inside, no leading zeros ("007").
 */
const AMOUNT = /^(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

export type SatangParse = { ok: true; satang: number } | { ok: false; error: string };

const fail = (error: string): SatangParse => ({ ok: false, error });

export const MONEY_INPUT_ERRORS = {
  empty: "Enter an amount.",
  format: "Enter an amount like 1800, 1,800 or 1800.50.",
  negative: "The amount cannot be negative.",
  decimals: "Use at most 2 decimal places (satang).",
  tooLarge: "The amount is too large (maximum ฿10,000,000.00).",
} as const;

/** Parses a baht amount typed by a person into integer satang, without floating-point math. */
export function parseBahtToSatang(input: string): SatangParse {
  const text = input.trim();
  if (text === "") return fail(MONEY_INPUT_ERRORS.empty);
  if (text.length > MAX_INPUT_LENGTH) return fail(MONEY_INPUT_ERRORS.tooLarge);
  if (/^[-−]/.test(text)) return fail(MONEY_INPUT_ERRORS.negative);
  if (/^\d[\d,]*\.\d{3,}$/.test(text)) return fail(MONEY_INPUT_ERRORS.decimals);
  const match = AMOUNT.exec(text);
  if (!match) return fail(MONEY_INPUT_ERRORS.format);
  const whole = (match[1] ?? "").replaceAll(",", "");
  // ฿10,000,000 has 8 digits; anything longer is too large before any arithmetic.
  if (whole.length > 8) return fail(MONEY_INPUT_ERRORS.tooLarge);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  // Both parts are short digit strings, so these are exact integers.
  const satang = Number(whole) * 100 + Number(fraction);
  if (satang > MAX_SATANG) return fail(MONEY_INPUT_ERRORS.tooLarge);
  return { ok: true, satang };
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** ฿1,800.00 style, always two decimals. Integer arithmetic only. */
export function formatSatang(satang: number): string {
  if (!Number.isSafeInteger(satang)) return "฿—";
  const sign = satang < 0 ? "-" : "";
  const abs = Math.abs(satang);
  const rest = abs % 100;
  const baht = (abs - rest) / 100;
  return `${sign}฿${grouped.format(baht)}.${String(rest).padStart(2, "0")}`;
}

/** The value to put back into an amount field: "1800.50" (no symbol, no commas). */
export function satangToInput(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) return "";
  const rest = satang % 100;
  return `${(satang - rest) / 100}.${String(rest).padStart(2, "0")}`;
}

const isSatang = (v: number, min: number) => Number.isSafeInteger(v) && v >= min && v <= MAX_SATANG;

/**
 * Pricing rule for one product, in satang. Each product has its own minimum; there is no
 * universal minimum price. Returns an error message, or undefined when valid.
 */
export function productPricingErrorSatang(p: {
  priceSatang: number;
  minimumSellingPriceSatang: number;
  costSatang?: number | undefined;
}): string | undefined {
  if (!isSatang(p.priceSatang, 1))
    return "Selling price must be more than ฿0.00 and at most ฿10,000,000.00, in whole satang.";
  if (!isSatang(p.minimumSellingPriceSatang, 0))
    return "Minimum selling price must be ฿0.00 to ฿10,000,000.00, in whole satang.";
  if (p.minimumSellingPriceSatang > p.priceSatang)
    return "Minimum selling price cannot be higher than the selling price.";
  if (p.costSatang !== undefined && !isSatang(p.costSatang, 0))
    return "Cost must be ฿0.00 to ฿10,000,000.00, in whole satang.";
  return undefined;
}
