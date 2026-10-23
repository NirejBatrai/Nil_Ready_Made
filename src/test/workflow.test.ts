/**
 * Demo workflow scenarios exercised through the repository layer.
 * These verify the browser demo's business rules; they are NOT backend authorization tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createSeed } from "@/data/demo-seed";
import { must } from "@/lib/assert";
import { findVariant, repo, sessionFigures } from "@/lib/repository";
import { getState, resetDemoState } from "@/lib/repository/demo-store";

const inStock = () =>
  must(
    getState()
      .products.filter((p) => p.active)
      .flatMap((p) => p.variants)
      .find((v) => v.stock >= 2),
    "variant in stock",
  );
const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const openSession = () => must(getState().cashSessions.find((c) => c.status === "open"));

beforeEach(() => resetDemoState());

describe("checkout", () => {
  it("cash sale creates one consistent sale, payment, stock movement and audit event", async () => {
    repo.setDemoRole("employee");
    const v = inStock();
    const before = getState();
    const sale = ok(
      await repo.createSale({
        lines: [{ variantId: v.id, qty: 2 }],
        discountPct: 0,
        paymentMethod: "cash",
        cashReceived: 100_000,
        idempotencyKey: "k1",
      }),
    );
    const s = getState();
    expect(before.sales.some((x) => x.receiptNo === sale.receiptNo)).toBe(false);
    expect(s.sales.filter((x) => x.receiptNo === sale.receiptNo)).toHaveLength(1);
    expect(sale.employeeId).toBe("emp_mali");
    expect(sale.change).toBe(100_000 - sale.total);
    expect(s.payments.filter((p) => p.saleId === sale.id)).toEqual([
      expect.objectContaining({ method: "cash", status: "recorded", recorded: sale.total }),
    ]);
    expect(must(findVariant(s, v.id)).variant.stock).toBe(v.stock - 2);
    expect(s.movements.filter((m) => m.reference === sale.receiptNo)).toEqual([
      expect.objectContaining({ variantId: v.id, type: "sale", qty: -2, actorId: "emp_mali" }),
    ]);
    expect(s.audit.filter((a) => a.target === sale.receiptNo)).toEqual([
      expect.objectContaining({ action: "sale.completed", actorId: "emp_mali" }),
    ]);
  });

  it("receipt numbers are unique across consecutive sales", async () => {
    const v = inStock();
    const line = { variantId: v.id, qty: 1 };
    const a = ok(
      await repo.createSale({
        lines: [line],
        discountPct: 0,
        paymentMethod: "qr",
        idempotencyKey: "a",
      }),
    );
    const b = ok(
      await repo.createSale({
        lines: [line],
        discountPct: 0,
        paymentMethod: "qr",
        idempotencyKey: "b",
      }),
    );
    expect(a.receiptNo).not.toBe(b.receiptNo);
    const all = getState().sales.map((x) => x.receiptNo);
    expect(new Set(all).size).toBe(all.length);
  });

  it("resubmitting the same checkout does not duplicate the sale or stock movement", async () => {
    const v = inStock();
    const req = {
      lines: [{ variantId: v.id, qty: 1 }],
      discountPct: 0,
      paymentMethod: "qr" as const,
      idempotencyKey: "dup",
    };
    const [first, second] = await Promise.all([repo.createSale(req), repo.createSale(req)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    const s = getState();
    expect(s.sales).toHaveLength(createSeed().sales.length + 1);
    expect(must(findVariant(s, v.id)).variant.stock).toBe(v.stock - 1);
  });

  it("refuses insufficient cash and overselling", async () => {
    const v = inStock();
    const short = await repo.createSale({
      lines: [{ variantId: v.id, qty: 1 }],
      discountPct: 0,
      paymentMethod: "cash",
      cashReceived: 1,
      idempotencyKey: "short",
    });
    expect(short.ok).toBe(false);
    const oversell = await repo.createSale({
      lines: [{ variantId: v.id, qty: v.stock + 1 }],
      discountPct: 0,
      paymentMethod: "qr",
      idempotencyKey: "over",
    });
    expect(oversell.ok).toBe(false);
    expect(getState().sales).toHaveLength(createSeed().sales.length);
  });
});

describe("QR payments", () => {
  async function qrSale(key: string) {
    const sale = ok(
      await repo.createSale({
        lines: [{ variantId: inStock().id, qty: 1 }],
        discountPct: 0,
        paymentMethod: "qr",
        qrReference: "REF123",
        idempotencyKey: key,
      }),
    );
    return must(getState().payments.find((p) => p.saleId === sale.id));
  }

  it("a recorded QR payment stays pending until someone verifies it", async () => {
    repo.setDemoRole("employee");
    const p = await qrSale("q1");
    expect(p.status).toBe("pending");
    expect(p.verifiedBy).toBeUndefined();
  });

  it("an employee cannot verify payments", async () => {
    repo.setDemoRole("employee");
    const p = await qrSale("q2");
    const r = await repo.verifyPayment(p.id, "verified", p.expected, "looks fine");
    expect(r.ok).toBe(false);
    expect(must(getState().payments.find((x) => x.id === p.id)).status).toBe("pending");
  });

  it("a mismatched received amount becomes an exception, not verified", async () => {
    const p = await qrSale("q3");
    ok(await repo.verifyPayment(p.id, "verified", p.expected - 50, "Bank app shows less"));
    const after = must(getState().payments.find((x) => x.id === p.id));
    expect(after.status).toBe("exception");
    expect(after.verifiedBy).toBe("emp_owner");
    expect(after.verificationSource).toBe("manual");
  });
});

describe("approvals", () => {
  async function employeeRefundRequest() {
    repo.setDemoRole("employee");
    const sale = must(getState().sales.find((x) => x.status === "completed"));
    const req = ok(await repo.requestRefund(sale.id, "Wrong size"));
    return { sale, req };
  }

  it("an employee cannot decide requests", async () => {
    const { req } = await employeeRefundRequest();
    const r = await repo.decideApproval(req.id, "approved", "");
    expect(r.ok).toBe(false);
    expect(must(getState().approvals.find((a) => a.id === req.id)).status).toBe("pending");
  });

  it("the owner cannot approve their own request", async () => {
    const req = ok(await repo.requestApproval({ type: "discount", amount: 10, reason: "test" }));
    const r = await repo.decideApproval(req.id, "approved", "");
    expect(r).toEqual({ ok: false, error: "You cannot approve your own request." });
  });

  it("a duplicate refund request for the same receipt is refused while one is pending", async () => {
    const { sale } = await employeeRefundRequest();
    expect((await repo.requestRefund(sale.id, "again")).ok).toBe(false);
  });

  it("approving a refund records the refund and returns stock exactly once", async () => {
    const { sale, req } = await employeeRefundRequest();
    repo.setDemoRole("owner");
    const expectedStock = new Map<string, number>();
    for (const i of sale.items)
      expectedStock.set(
        i.variantId,
        (expectedStock.get(i.variantId) ??
          must(findVariant(getState(), i.variantId)).variant.stock) + i.qty,
      );
    const [a, b] = await Promise.all([
      repo.decideApproval(req.id, "approved", "ok"),
      repo.decideApproval(req.id, "approved", "ok"),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const s = getState();
    expect(must(s.sales.find((x) => x.id === sale.id)).status).toBe("refunded");
    expect(s.refunds.filter((r) => r.approvalId === req.id)).toHaveLength(1);
    for (const [variantId, stock] of expectedStock)
      expect(must(findVariant(s, variantId)).variant.stock).toBe(stock);
    expect(
      s.audit.filter((e) => e.action === "refund.approved" && e.target === req.number),
    ).toHaveLength(1);
  });

  it("rejection requires a note", async () => {
    const { req } = await employeeRefundRequest();
    repo.setDemoRole("owner");
    expect((await repo.decideApproval(req.id, "rejected", "  ")).ok).toBe(false);
    ok(await repo.decideApproval(req.id, "rejected", "Outside refund window"));
    expect(must(getState().approvals.find((a) => a.id === req.id)).decisionNote).toBe(
      "Outside refund window",
    );
  });
});

describe("cash drawer", () => {
  it("a shortage needs an explanation, goes to review, and the owner resolves it", async () => {
    repo.setDemoRole("employee");
    const cs = openSession();
    const expected = sessionFigures(getState(), cs).expected;
    expect((await repo.closeCashSession(cs.id, expected - 100, {})).ok).toBe(false);
    ok(await repo.closeCashSession(cs.id, expected - 100, {}, "Gave too much change"));
    const closed = must(getState().cashSessions.find((c) => c.id === cs.id));
    expect(closed).toMatchObject({
      status: "pending_review",
      employeeId: cs.employeeId,
      closedBy: "emp_mali",
      expectedAtClose: expected,
      countedCash: expected - 100,
    });
    expect((await repo.closeCashSession(cs.id, expected, {})).ok).toBe(false);
    const req = must(
      getState().approvals.find((a) => a.cashSessionId === cs.id && a.status === "pending"),
    );
    expect(req).toMatchObject({ type: "cash_discrepancy", amount: -100, requesterId: "emp_mali" });

    repo.setDemoRole("owner");
    ok(await repo.decideApproval(req.id, "approved", "Accepted shortage"));
    const resolved = must(getState().cashSessions.find((c) => c.id === cs.id));
    expect(resolved.status).toBe("resolved");
    // The expected figure is a snapshot and is never rewritten to match the count.
    expect(resolved.expectedAtClose).toBe(expected);
  });

  it("an exact count closes balanced without an approval request", async () => {
    const cs = openSession();
    const approvals = getState().approvals.length;
    ok(await repo.closeCashSession(cs.id, sessionFigures(getState(), cs).expected, {}));
    expect(must(getState().cashSessions.find((c) => c.id === cs.id)).status).toBe("balanced");
    expect(getState().approvals).toHaveLength(approvals);
  });

  it("cannot open a second drawer while one is open", async () => {
    expect((await repo.openCashSession(2000)).ok).toBe(false);
  });
});

describe("reset demo", () => {
  it("restores the original fixtures and today's open drawer after changes", async () => {
    const cs = openSession();
    ok(await repo.closeCashSession(cs.id, 0, {}, "test"));
    repo.setDemoRole("employee");
    resetDemoState();
    const s = getState();
    const { role, currentUserId, ...data } = s;
    expect(data).toEqual(createSeed());
    expect({ role, currentUserId }).toEqual({ role: "owner", currentUserId: "emp_owner" });
    expect(openSession().id).toBe(cs.id);
  });
});

describe("stock adjustments", () => {
  it("an approved increase is recorded as a correction even if the reason mentions damage", async () => {
    repo.setDemoRole("employee");
    const v = inStock();
    const req = ok(await repo.requestStockAdjustment(v.id, 1, "Damaged item: found in back room"));
    repo.setDemoRole("owner");
    ok(await repo.decideApproval(req.id, "approved", "ok"));
    const s = getState();
    expect(must(findVariant(s, v.id)).variant.stock).toBe(v.stock + 1);
    expect(s.movements.filter((m) => m.reference === req.number)).toEqual([
      expect.objectContaining({ type: "approved_correction", qty: 1 }),
    ]);
  });

  it("an approved damage write-off reduces stock as a damaged movement", async () => {
    repo.setDemoRole("employee");
    const v = inStock();
    const req = ok(await repo.requestStockAdjustment(v.id, -1, "Damaged item: torn"));
    expect(must(findVariant(getState(), v.id)).variant.stock).toBe(v.stock);
    repo.setDemoRole("owner");
    ok(await repo.decideApproval(req.id, "approved", "ok"));
    const s = getState();
    expect(must(findVariant(s, v.id)).variant.stock).toBe(v.stock - 1);
    expect(s.movements.filter((m) => m.reference === req.number)).toEqual([
      expect.objectContaining({ type: "damaged", qty: -1 }),
    ]);
  });
});
