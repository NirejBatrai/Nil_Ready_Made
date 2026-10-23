/** Pure business calculations. The backend must re-compute all of these. */
import { fmtTHB } from "@/lib/format";

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

/**
 * Validates an actual unit selling price against a product's pricing rule.
 * Permitted range is [minimumSellingPrice, listPrice], whole baht only.
 */
export function unitPriceError(
  price: number,
  rule: { listPrice: number; minimumSellingPrice: number },
): string | undefined {
  if (!Number.isFinite(price) || price < 0) return "Enter a valid price.";
  if (price < rule.minimumSellingPrice)
    return `This item's minimum selling price is ${fmtTHB(rule.minimumSellingPrice)}. Sales below the minimum are not permitted.`;
  if (!Number.isInteger(price)) return "Prices must be in whole baht.";
  if (price > rule.listPrice)
    return `Price cannot be above the normal price of ${fmtTHB(rule.listPrice)}.`;
  return undefined;
}

/** True when a cart-level percentage discount would take this unit price below its minimum. */
export function discountBreaksMinimum(unitPrice: number, discountPct: number, minimum: number) {
  return unitPrice * (100 - discountPct) < minimum * 100;
}

/** Validates an owner's product pricing configuration. */
export function productPricingError(p: {
  price: number;
  minimumSellingPrice: number;
  cost?: number | undefined;
}): string | undefined {
  if (!Number.isInteger(p.price) || p.price <= 0)
    return "Selling price must be a whole number of baht greater than zero.";
  if (!Number.isInteger(p.minimumSellingPrice) || p.minimumSellingPrice < 0)
    return "Minimum selling price must be a whole number of baht, 0 or more.";
  if (p.minimumSellingPrice > p.price)
    return "Minimum selling price cannot be higher than the selling price.";
  if (p.cost !== undefined && (!Number.isInteger(p.cost) || p.cost < 0))
    return "Cost must be a whole number of baht, 0 or more.";
  return undefined;
}

/** (actual price − cost snapshot) × qty, or undefined when cost is unknown. Never estimated. */
export function lineGrossProfit(i: {
  unitPrice: number;
  qty: number;
  unitCost?: number | undefined;
}) {
  return i.unitCost === undefined ? undefined : (i.unitPrice - i.unitCost) * i.qty;
}
