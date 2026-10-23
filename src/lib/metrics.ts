import { dayKey } from "@/lib/format";
import type { DemoState } from "@/lib/repository/demo-store";
import type { Sale } from "@/types/domain";

/**
 * Metric definitions (shared by dashboard and reports):
 * - Gross sales: sum of item subtotals of non-voided sales.
 * - Discounts: discounts given on those sales.
 * - Refunds: approved refund amounts dated in the period.
 * - Net sales: gross − discounts − refunds.
 * - Recorded payments: payments recorded at checkout (not proof of funds).
 * - Verified payments: QR payments manually verified by the owner + cash in balanced/resolved sessions.
 */
export function periodMetrics(
  s: Pick<DemoState, "sales" | "payments" | "refunds" | "cashSessions">,
  from: string,
  to: string,
) {
  const inRange = (iso: string) => {
    const k = dayKey(iso);
    return k >= from && k <= to;
  };
  const sales = s.sales.filter((x) => inRange(x.createdAt) && x.status !== "voided");
  const saleIds = new Set(sales.map((x) => x.id));
  const pays = s.payments.filter((p) => saleIds.has(p.saleId));
  const gross = sales.reduce((a, x) => a + x.subtotal, 0);
  const discounts = sales.reduce((a, x) => a + x.discount, 0);
  const refunds = s.refunds.filter((r) => inRange(r.at)).reduce((a, r) => a + r.amount, 0);
  const cash = pays.filter((p) => p.method === "cash").reduce((a, p) => a + p.recorded, 0);
  const qr = pays.filter((p) => p.method === "qr").reduce((a, p) => a + p.recorded, 0);
  const closedOk = new Set(
    s.cashSessions
      .filter((c) => c.status === "balanced" || c.status === "resolved")
      .map((c) => c.id),
  );
  const saleById = new Map(sales.map((x) => [x.id, x]));
  const verified = pays
    .filter(
      (p) =>
        (p.method === "qr" && p.status === "verified") ||
        (p.method === "cash" && closedOk.has(saleById.get(p.saleId)?.cashSessionId ?? "")),
    )
    .reduce((a, p) => a + p.recorded, 0);
  const pendingQr = pays
    .filter((p) => p.method === "qr" && p.status === "pending")
    .reduce((a, p) => a + p.recorded, 0);
  const cogsKnown = sales.flatMap((x) => x.items).every((i) => i.unitCost !== undefined);
  const cogs = sales.flatMap((x) => x.items).reduce((a, i) => a + (i.unitCost ?? 0) * i.qty, 0);
  const net = gross - discounts - refunds;
  return {
    sales,
    count: sales.length,
    gross,
    discounts,
    refunds,
    net,
    recorded: cash + qr,
    cash,
    qr,
    verified,
    pendingQr,
    avg: sales.length ? Math.round((gross - discounts) / sales.length) : 0,
    cogs,
    cogsKnown,
    grossProfit: net - cogs,
  };
}

export function dailySeries(s: Pick<DemoState, "sales" | "refunds">, days: string[]) {
  return days.map((d) => {
    const sales = s.sales.filter((x) => dayKey(x.createdAt) === d && x.status !== "voided");
    return {
      day: d.slice(5),
      date: d,
      net:
        sales.reduce((a, x) => a + x.total, 0) -
        s.refunds.filter((r) => dayKey(r.at) === d).reduce((a, r) => a + r.amount, 0),
      cash: sales.filter((x) => x.paymentMethod === "cash").reduce((a, x) => a + x.total, 0),
      qr: sales.filter((x) => x.paymentMethod === "qr").reduce((a, x) => a + x.total, 0),
      count: sales.length,
    };
  });
}

export function lastNDays(end: string, n: number) {
  const e = Date.parse(`${end}T12:00:00+07:00`);
  return Array.from({ length: n }, (_, i) => dayKey(new Date(e - (n - 1 - i) * 86_400_000)));
}

export function topProducts(sales: Sale[], n = 5) {
  const m = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const s of sales)
    for (const i of s.items) {
      const r = m.get(i.productId) ?? { name: i.name, qty: 0, revenue: 0 };
      r.qty += i.qty;
      r.revenue += i.qty * i.unitPrice;
      m.set(i.productId, r);
    }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, n);
}

export function lowStock(s: Pick<DemoState, "products">) {
  return s.products
    .filter((p) => p.active)
    .flatMap((p) =>
      p.variants
        .filter((v) => v.stock <= p.lowStockThreshold)
        .map((v) => ({ product: p, variant: v })),
    );
}
