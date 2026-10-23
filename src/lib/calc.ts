/** Pure business calculations. The backend must re-compute all of these. */

export function lineTotal(unitPrice: number, qty: number) {
  return unitPrice * qty;
}

export function cartTotals(lines: { unitPrice: number; qty: number }[], discountPct: number) {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l.unitPrice, l.qty), 0);
  const pct = Math.min(Math.max(discountPct, 0), 100);
  const discount = Math.round((subtotal * pct) / 100);
  return { subtotal, discount, total: subtotal - discount };
}

export function cashChange(total: number, received: number) {
  if (!Number.isFinite(received) || received < total) {
    return { sufficient: false, change: 0, shortBy: Math.max(total - (received || 0), 0) };
  }
  return { sufficient: true, change: received - total, shortBy: 0 };
}

export function expectedClosingCash(input: {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  inflows: number;
  outflows: number;
}) {
  return input.openingFloat + input.cashSales - input.cashRefunds + input.inflows - input.outflows;
}

export const THB_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

export function denominationTotal(counts: Record<string, number>) {
  return THB_DENOMINATIONS.reduce((s, d) => s + d * (counts[String(d)] || 0), 0);
}
