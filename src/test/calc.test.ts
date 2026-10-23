import { describe, expect, it } from "vitest";
import { cartTotals, cashChange, denominationTotal, expectedClosingCash } from "@/lib/calc";

describe("checkout calculations", () => {
  it("applies a percentage discount to the subtotal", () => {
    expect(
      cartTotals(
        [
          { unitPrice: 1290, qty: 2 },
          { unitPrice: 590, qty: 1 },
        ],
        10,
      ),
    ).toEqual({
      subtotal: 3170,
      discount: 317,
      total: 2853,
    });
  });
  it("calculates change when cash received covers the total", () => {
    expect(cashChange(2853, 3000)).toEqual({ sufficient: true, change: 147, shortBy: 0 });
  });
  it("blocks completion when cash received is insufficient", () => {
    expect(cashChange(2853, 2800).sufficient).toBe(false);
    expect(cashChange(2853, 2800).shortBy).toBe(53);
  });
});

describe("cash reconciliation", () => {
  it("expected closing cash = float + cash sales - cash refunds + inflows - outflows", () => {
    expect(
      expectedClosingCash({
        openingFloat: 2000,
        cashSales: 8450,
        cashRefunds: 590,
        inflows: 100,
        outflows: 300,
      }),
    ).toBe(9660);
  });
  it("sums a THB denomination count", () => {
    expect(denominationTotal({ "1000": 2, "500": 1, "20": 3, "1": 4 })).toBe(2564);
  });
});
