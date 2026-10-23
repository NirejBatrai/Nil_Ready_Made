import { describe, expect, it } from "vitest";
import { createSeed, DEMO_TODAY } from "@/data/demo-seed";
import { dailySeries, lastNDays, periodMetrics } from "@/lib/metrics";
import { dayKey } from "@/lib/format";
import { nth } from "@/lib/assert";
import type { Payment, Sale } from "@/types/domain";

function sale(id: string, createdAt: string, total: number, method: Sale["paymentMethod"]): Sale {
  return {
    id,
    receiptNo: id,
    createdAt,
    employeeId: "emp_mali",
    items: [],
    subtotal: total,
    discount: 0,
    total,
    paymentMethod: method,
    status: "completed",
  };
}
function payment(s: Sale): Payment {
  return {
    id: `pay_${s.id}`,
    saleId: s.id,
    method: s.paymentMethod,
    expected: s.total,
    recorded: s.total,
    recordedAt: s.createdAt,
    status: s.paymentMethod === "cash" ? "recorded" : "pending",
  };
}

describe("dashboard daily series", () => {
  // 23:59 and 00:00 Bangkok time are 16:59Z and 17:00Z on the previous UTC date.
  const late = sale("late", "2026-10-21T16:59:00.000Z", 1000, "cash");
  const early = sale("early", "2026-10-21T17:00:00.000Z", 500, "qr");
  const state = {
    sales: [late, early],
    payments: [late, early].map(payment),
    refunds: [],
    cashSessions: [],
  };

  it("groups sales by Bangkok calendar day at the midnight boundary", () => {
    const series = dailySeries(state, ["2026-10-21", "2026-10-22"]);
    expect(nth(series, 0)).toMatchObject({
      date: "2026-10-21",
      net: 1000,
      cash: 1000,
      qr: 0,
      count: 1,
    });
    expect(nth(series, 1)).toMatchObject({
      date: "2026-10-22",
      net: 500,
      cash: 0,
      qr: 500,
      count: 1,
    });
  });

  it("returns zeros for a day with no sales", () => {
    expect(nth(dailySeries(state, ["2026-10-23"]), 0)).toMatchObject({
      net: 0,
      cash: 0,
      qr: 0,
      count: 0,
    });
  });

  it("lastNDays ends on the requested day and has no gaps", () => {
    expect(lastNDays("2026-10-22", 3)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(lastNDays("2026-11-01", 2)).toEqual(["2026-10-31", "2026-11-01"]);
  });

  it("every chart point matches periodMetrics for that day (net line and payment bars agree)", () => {
    const s = createSeed();
    for (const p of dailySeries(s, lastNDays(DEMO_TODAY, 14))) {
      const m = periodMetrics(s, p.date, p.date);
      expect(p.net).toBe(m.net);
      expect(p.cash + p.qr).toBe(m.recorded);
      // Bars show recorded payments (after discount); the line also subtracts refunds.
      expect(p.net).toBe(p.cash + p.qr - p.refunds);
      expect(p.count).toBeGreaterThan(0);
    }
  });

  it("subtracts a refund on the day it was paid out, not the day of the sale", () => {
    const s = createSeed();
    const rf = nth(s.refunds, 0);
    const refundDay = dayKey(rf.at);
    const saleDay = dayKey(
      nth(
        s.sales.filter((x) => x.id === rf.saleId),
        0,
      ).createdAt,
    );
    expect(refundDay).not.toBe(saleDay);
    expect(nth(dailySeries(s, [refundDay]), 0).refunds).toBe(rf.amount);
    expect(nth(dailySeries(s, [saleDay]), 0).refunds).toBe(0);
  });

  it("seed has QR payments pending today, matching the pending-QR notification", () => {
    const s = createSeed();
    expect(periodMetrics(s, DEMO_TODAY, DEMO_TODAY).pendingQr).toBeGreaterThan(0);
  });
});
