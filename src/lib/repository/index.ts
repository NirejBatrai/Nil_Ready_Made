/**
 * Data-access layer. Screens call `repo.*` for writes and `useDemoState()` for reads.
 * Swap `demoRepository` for a Supabase-backed implementation of `RetailRepository` later.
 * The backend MUST re-validate prices, totals, stock, permissions and idempotency.
 */
import {
  cartTotals,
  cashChange,
  discountBreaksMinimum,
  expectedClosingCash,
  productPricingError,
  unitPriceError,
} from "@/lib/calc";
import { dayKey, variantLabel } from "@/lib/format";
import type {
  ApprovalRequest,
  ApprovalType,
  AuditEvent,
  CashSession,
  CreateSaleRequest,
  EmployeeProfile,
  InventoryMovement,
  MovementType,
  Product,
  Result,
  Role,
  Sale,
  SaleItem,
  ShopSettings,
} from "@/types/domain";
import { getState, mutate, type DemoState } from "./demo-store";
import { nth } from "@/lib/assert";

export interface RetailRepository {
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  saveProduct(p: Product): Promise<Result<Product>>;
  archiveProduct(id: string, active: boolean): Promise<Result<null>>;
  createSale(req: CreateSaleRequest): Promise<Result<Sale>>;
  getSales(): Promise<Sale[]>;
  getSaleDetails(id: string): Promise<Sale | undefined>;
  requestRefund(saleId: string, reason: string): Promise<Result<ApprovalRequest>>;
  requestApproval(
    input: Partial<ApprovalRequest> & { type: ApprovalType; reason: string },
  ): Promise<Result<ApprovalRequest>>;
  requestStockAdjustment(
    variantId: string,
    diff: number,
    reason: string,
    stockCountId?: string,
  ): Promise<Result<ApprovalRequest>>;
  getInventoryMovements(variantId?: string): Promise<InventoryMovement[]>;
  openCashSession(openingFloat: number, notes?: string): Promise<Result<CashSession>>;
  closeCashSession(
    id: string,
    counted: number,
    denominations: Record<string, number>,
    explanation?: string,
  ): Promise<Result<CashSession>>;
  addCashMovement(
    id: string,
    direction: "in" | "out",
    amount: number,
    reason: string,
  ): Promise<Result<null>>;
  getPendingApprovals(): Promise<ApprovalRequest[]>;
  decideApproval(
    id: string,
    decision: "approved" | "rejected",
    note: string,
  ): Promise<Result<ApprovalRequest>>;
  verifyPayment(
    id: string,
    result: "verified" | "failed" | "exception",
    actual: number,
    note: string,
    reference?: string,
  ): Promise<Result<null>>;
  getAuditEvents(): Promise<AuditEvent[]>;
  submitStockCount(
    lines: { variantId: string; counted: number }[],
  ): Promise<Result<{ id: string; requests: number }>>;
  saveEmployee(e: EmployeeProfile): Promise<Result<null>>;
  saveSettings(s: ShopSettings): Promise<Result<null>>;
  setDemoRole(role: Role): void;
}

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const uid = (p: string) =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const usedKeys = new Set<string>();

function log(
  d: DemoState,
  action: string,
  target: string,
  summary: string,
  result: AuditEvent["result"] = "success",
) {
  d.audit.unshift({
    id: uid("au"),
    at: now(),
    actorId: d.currentUserId,
    action,
    target,
    result,
    summary,
  });
}

export function findVariant(d: Pick<DemoState, "products">, variantId: string) {
  for (const p of d.products) {
    const v = p.variants.find((x) => x.id === variantId);
    if (v) return { product: p, variant: v };
  }
  return undefined;
}

export function sessionFigures(d: Pick<DemoState, "sales" | "refunds">, s: CashSession) {
  const cashSales = d.sales
    .filter((x) => x.cashSessionId === s.id && x.status !== "voided")
    .reduce((a, x) => a + x.total, 0);
  const end = s.closedAt ?? "9999";
  const cashRefunds = d.refunds
    .filter((f) => f.method === "cash" && f.at >= s.openedAt && f.at <= end)
    .reduce((a, f) => a + f.amount, 0);
  const inflows = s.cashMovements
    .filter((m) => m.direction === "in")
    .reduce((a, m) => a + m.amount, 0);
  const outflows = s.cashMovements
    .filter((m) => m.direction === "out")
    .reduce((a, m) => a + m.amount, 0);
  const expected =
    s.expectedAtClose ??
    expectedClosingCash({
      openingFloat: s.openingFloat,
      cashSales,
      cashRefunds,
      inflows,
      outflows,
    });
  return {
    cashSales,
    cashRefunds,
    inflows,
    outflows,
    expected,
    difference: s.countedCash !== undefined ? s.countedCash - expected : undefined,
  };
}

function newApproval(
  d: DemoState,
  a: Partial<ApprovalRequest> & { type: ApprovalType; reason: string },
): ApprovalRequest {
  const req: ApprovalRequest = {
    id: uid("apr"),
    number: `REQ-${d.counters.approval++}`,
    requesterId: d.currentUserId,
    createdAt: now(),
    status: "pending",
    ...a,
  };
  d.approvals.unshift(req);
  d.notifications.unshift({
    id: uid("nt"),
    severity: "warning",
    at: now(),
    title: "New approval request",
    body: `${req.number}: ${req.type.replace("_", " ")}`,
    link: "/approvals",
    read: false,
  });
  return req;
}

export const repo: RetailRepository = {
  async listProducts() {
    return getState().products;
  },
  async getProduct(id) {
    return getState().products.find((p) => p.id === id);
  },
  async saveProduct(p) {
    await wait();
    if (getState().role !== "owner")
      return { ok: false, error: "Only the owner can edit products." };
    if (!p.name.trim() || !p.sku.trim()) return { ok: false, error: "Name and SKU are required." };
    const pricing = productPricingError(p);
    if (pricing) return { ok: false, error: pricing };
    const dup = getState().products.find((x) => x.sku === p.sku && x.id !== p.id);
    if (dup) return { ok: false, error: `SKU already used by ${dup.name}.` };
    // Store a copy so the caller cannot change prices after validation.
    p = structuredClone(p);
    mutate((d) => {
      const i = d.products.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const prev = nth(d.products, i);
        if (prev.price !== p.price)
          log(
            d,
            "product.price_changed",
            p.sku,
            `Selling price changed ฿${prev.price} → ฿${p.price}.`,
          );
        if (prev.minimumSellingPrice !== p.minimumSellingPrice)
          log(
            d,
            "product.minimum_price_changed",
            p.sku,
            `Minimum selling price changed ฿${prev.minimumSellingPrice} → ฿${p.minimumSellingPrice}.`,
          );
        // stock is only changed via movements; keep recorded stock
        p.variants = p.variants.map((v) => {
          const old = prev.variants.find((o) => o.id === v.id);
          return old ? { ...v, stock: old.stock, openingStock: old.openingStock } : v;
        });
        d.products[i] = p;
        log(d, "product.updated", p.sku, `Product “${p.name}” updated.`);
      } else {
        d.products.unshift(p);
        p.variants.forEach((v) => {
          if (v.openingStock > 0)
            d.movements.push({
              id: uid("mv"),
              variantId: v.id,
              type: "opening",
              qty: v.openingStock,
              at: now(),
              actorId: d.currentUserId,
              note: "Opening stock",
            });
        });
        log(
          d,
          "product.created",
          p.sku,
          `Product “${p.name}” created with ${p.variants.length} variant(s).`,
        );
      }
    });
    return { ok: true, data: p };
  },
  async archiveProduct(id, active) {
    await wait();
    if (getState().role !== "owner")
      return { ok: false, error: "Only the owner can archive products." };
    mutate((d) => {
      const p = d.products.find((x) => x.id === id);
      if (!p) return;
      p.active = active;
      log(
        d,
        active ? "product.restored" : "product.archived",
        p.sku,
        `${p.name} ${active ? "restored" : "archived"}.`,
      );
    });
    return { ok: true, data: null };
  },

  async createSale(req) {
    await wait(400);
    if (usedKeys.has(req.idempotencyKey))
      return { ok: false, error: "This checkout was already submitted." };
    const s = getState();
    if (!req.lines.length) return { ok: false, error: "Add at least one item." };
    const session = s.cashSessions.find((c) => c.status === "open");
    if (req.paymentMethod === "cash" && !session)
      return { ok: false, error: "Open a cash session before taking cash." };
    if (!Number.isFinite(req.discountPct) || req.discountPct < 0 || req.discountPct > 100)
      return { ok: false, error: "Invalid discount." };
    if (req.discountPct > 0 && s.role !== "owner")
      return { ok: false, error: "Discounts need owner approval." };
    const items: SaleItem[] = [];
    const qtyByVariant = new Map<string, number>();
    for (const l of req.lines) {
      const f = findVariant(s, l.variantId);
      if (!f || !f.product.active) return { ok: false, error: "An item is no longer available." };
      if (!Number.isInteger(l.qty) || l.qty < 1) return { ok: false, error: "Invalid quantity." };
      // Stock is checked against the total of all lines for the same variant.
      const wanted = (qtyByVariant.get(f.variant.id) ?? 0) + l.qty;
      qtyByVariant.set(f.variant.id, wanted);
      if (wanted > f.variant.stock)
        return {
          ok: false,
          error: `Only ${f.variant.stock} left of ${f.product.name} (${variantLabel(f.variant)}).`,
        };
      // Pricing rule comes from stored product data, never from the request.
      const { price: listPrice, minimumSellingPrice } = f.product;
      const unitPrice = l.unitPrice ?? listPrice;
      const belowMinimum =
        unitPrice < minimumSellingPrice ||
        discountBreaksMinimum(unitPrice, req.discountPct, minimumSellingPrice);
      const priceError =
        unitPriceError(unitPrice, { listPrice, minimumSellingPrice }) ??
        (belowMinimum
          ? `A ${req.discountPct}% discount would take ${f.product.name} below its minimum selling price of ฿${minimumSellingPrice}. Sales below the minimum are not permitted.`
          : undefined);
      if (priceError) {
        // Below-minimum attempts are audited so the owner can see them; nothing else is recorded.
        if (belowMinimum)
          mutate((d) =>
            log(
              d,
              "sale.blocked_below_minimum",
              f.variant.sku,
              `Checkout blocked: ฿${unitPrice}${req.discountPct ? ` less ${req.discountPct}%` : ""} is below the ฿${minimumSellingPrice} minimum.`,
              "failure",
            ),
          );
        return { ok: false, error: priceError };
      }
      items.push({
        productId: f.product.id,
        variantId: f.variant.id,
        name: f.product.name,
        variantLabel: variantLabel(f.variant),
        sku: f.variant.sku,
        qty: l.qty,
        unitPrice,
        listPrice,
        minimumPrice: minimumSellingPrice,
        lineDiscount: (listPrice - unitPrice) * l.qty,
        unitCost: f.product.cost,
      });
    }
    const t = cartTotals(items, req.discountPct);
    let change: number | undefined;
    if (req.paymentMethod === "cash") {
      const c = cashChange(t.total, req.cashReceived ?? 0);
      if (!c.sufficient) return { ok: false, error: `Cash received is short by ฿${c.shortBy}.` };
      change = c.change;
    }
    usedKeys.add(req.idempotencyKey);
    let sale!: Sale;
    mutate((d) => {
      const n = d.counters.receipt++;
      // Receipt date follows the shop's reporting day (Asia/Bangkok), not UTC.
      const today = dayKey(new Date()).slice(2).replace(/-/g, "");
      sale = {
        id: uid("sale"),
        receiptNo: `LX-${today}-${String(n).padStart(4, "0")}`,
        createdAt: now(),
        employeeId: d.currentUserId,
        items,
        ...t,
        paymentMethod: req.paymentMethod,
        status: "completed",
        cashReceived: req.paymentMethod === "cash" ? req.cashReceived : undefined,
        change,
        cashSessionId: req.paymentMethod === "cash" ? session?.id : undefined,
      };
      d.sales.push(sale);
      d.payments.push({
        id: uid("pay"),
        saleId: sale.id,
        method: req.paymentMethod,
        expected: t.total,
        recorded: t.total,
        reference: req.qrReference || undefined,
        recordedAt: sale.createdAt,
        status: req.paymentMethod === "cash" ? "recorded" : "pending",
      });
      for (const it of items) {
        const f = findVariant(d, it.variantId)!;
        f.variant.stock -= it.qty;
        d.movements.push({
          id: uid("mv"),
          variantId: it.variantId,
          type: "sale",
          qty: -it.qty,
          at: sale.createdAt,
          actorId: d.currentUserId,
          reference: sale.receiptNo,
        });
      }
      log(
        d,
        "sale.completed",
        sale.receiptNo,
        `Sale of ${items.length} line(s), ${req.paymentMethod.toUpperCase()}, ฿${t.total}`,
      );
    });
    return { ok: true, data: sale };
  },
  async getSales() {
    return getState().sales;
  },
  async getSaleDetails(id) {
    return getState().sales.find((s) => s.id === id);
  },
  async requestRefund(saleId, reason) {
    await wait();
    const s = getState();
    const sale = s.sales.find((x) => x.id === saleId);
    if (!sale || sale.status !== "completed")
      return { ok: false, error: "Only completed sales can be refunded." };
    if (
      s.approvals.some((a) => a.saleId === saleId && a.type === "refund" && a.status === "pending")
    )
      return { ok: false, error: "A refund request for this receipt is already pending." };
    if (!reason.trim()) return { ok: false, error: "A reason is required." };
    let req!: ApprovalRequest;
    mutate((d) => {
      req = newApproval(d, { type: "refund", saleId, amount: sale.total, reason });
      log(d, "refund.requested", sale.receiptNo, reason, "pending");
    });
    return { ok: true, data: req };
  },
  async requestApproval(input) {
    await wait();
    if (!input.reason.trim()) return { ok: false, error: "A reason is required." };
    let req!: ApprovalRequest;
    mutate((d) => {
      req = newApproval(d, input);
      log(d, `${input.type}.requested`, req.number, input.reason, "pending");
    });
    return { ok: true, data: req };
  },
  async requestStockAdjustment(variantId, diff, reason, stockCountId) {
    await wait();
    if (diff === 0) return { ok: false, error: "No difference to adjust." };
    if (!reason.trim()) return { ok: false, error: "A reason is required." };
    let req!: ApprovalRequest;
    mutate((d) => {
      req = newApproval(d, {
        type: "stock_adjustment",
        variantId,
        stockDiff: diff,
        reason,
        stockCountId,
      });
      const f = findVariant(d, variantId);
      log(
        d,
        "stock_adjustment.requested",
        f?.variant.sku ?? variantId,
        `Requested ${diff > 0 ? "+" : ""}${diff}: ${reason}`,
        "pending",
      );
    });
    return { ok: true, data: req };
  },
  async getInventoryMovements(variantId) {
    const m = getState().movements;
    return variantId ? m.filter((x) => x.variantId === variantId) : m;
  },
  async openCashSession(openingFloat, notes) {
    await wait();
    if (getState().cashSessions.some((c) => c.status === "open"))
      return { ok: false, error: "A session is already open." };
    if (!(openingFloat >= 0)) return { ok: false, error: "Enter a valid opening float." };
    let cs!: CashSession;
    mutate((d) => {
      cs = {
        id: uid("cs"),
        employeeId: d.currentUserId,
        openedAt: now(),
        openingFloat,
        openingNotes: notes,
        cashMovements: [],
        status: "open",
      };
      d.cashSessions.push(cs);
      log(d, "cash_session.opened", cs.id, `Opened with ฿${openingFloat} float.`);
    });
    return { ok: true, data: cs };
  },
  async closeCashSession(id, counted, denominations, explanation) {
    await wait();
    const s = getState();
    const cs = s.cashSessions.find((c) => c.id === id);
    if (!cs || cs.status !== "open") return { ok: false, error: "Session is not open." };
    const f = sessionFigures(s, cs);
    const diff = counted - f.expected;
    if (diff !== 0 && !explanation?.trim())
      return { ok: false, error: "Explain the difference before closing." };
    mutate((d) => {
      const c = d.cashSessions.find((x) => x.id === id)!;
      c.closedAt = now();
      c.closedBy = d.currentUserId;
      c.expectedAtClose = f.expected;
      c.countedCash = counted;
      c.denominations = denominations;
      c.explanation = explanation;
      c.status = diff === 0 ? "balanced" : "pending_review";
      log(
        d,
        "cash_session.closed",
        id,
        diff === 0
          ? "Closed balanced."
          : `Closed with ${diff > 0 ? "+" : "−"}฿${Math.abs(diff)} difference.`,
      );
      if (diff !== 0) {
        newApproval(d, {
          type: "cash_discrepancy",
          cashSessionId: id,
          amount: diff,
          reason: explanation!,
        });
        d.notifications.unshift({
          id: uid("nt"),
          severity: "critical",
          at: now(),
          title: "Cash discrepancy requires review",
          body: `Session closed ${diff > 0 ? "+" : "−"}฿${Math.abs(diff)} against expected.`,
          link: "/reconciliation",
          read: false,
        });
      }
    });
    return { ok: true, data: getState().cashSessions.find((x) => x.id === id)! };
  },
  async addCashMovement(id, direction, amount, reason) {
    await wait();
    if (!(amount > 0) || !reason.trim())
      return { ok: false, error: "Amount and reason are required." };
    mutate((d) => {
      const c = d.cashSessions.find((x) => x.id === id);
      c?.cashMovements.push({ id: uid("cm"), direction, amount, reason, at: now() });
      log(
        d,
        `cash_movement.${direction}`,
        id,
        `${direction === "in" ? "+" : "−"}฿${amount}: ${reason}`,
      );
    });
    return { ok: true, data: null };
  },
  async getPendingApprovals() {
    return getState().approvals.filter((a) => a.status === "pending");
  },
  async decideApproval(id, decision, note) {
    await wait(350);
    const s = getState();
    if (s.role !== "owner") return { ok: false, error: "Only the owner can decide requests." };
    const a = s.approvals.find((x) => x.id === id);
    if (!a || a.status !== "pending") return { ok: false, error: "Request is no longer pending." };
    if (a.requesterId === s.currentUserId)
      return { ok: false, error: "You cannot approve your own request." };
    if (decision === "rejected" && !note.trim())
      return { ok: false, error: "Add a note explaining the rejection." };
    mutate((d) => {
      const r = d.approvals.find((x) => x.id === id)!;
      r.status = decision;
      r.decidedAt = now();
      r.decidedBy = d.currentUserId;
      r.decisionNote = note;
      if (decision === "approved") {
        if (r.type === "refund" && r.saleId) {
          const sale = d.sales.find((x) => x.id === r.saleId)!;
          sale.status = "refunded";
          d.refunds.push({
            id: uid("rf"),
            saleId: sale.id,
            amount: r.amount ?? sale.total,
            method: sale.paymentMethod,
            reason: r.reason,
            at: now(),
            approvalId: r.id,
          });
          for (const it of sale.items) {
            const f = findVariant(d, it.variantId);
            if (f) f.variant.stock += it.qty;
            d.movements.push({
              id: uid("mv"),
              variantId: it.variantId,
              type: "customer_return",
              qty: it.qty,
              at: now(),
              actorId: d.currentUserId,
              reference: sale.receiptNo,
            });
          }
        }
        if (r.type === "stock_adjustment" && r.variantId && r.stockDiff) {
          const f = findVariant(d, r.variantId);
          if (f) f.variant.stock = Math.max(0, f.variant.stock + r.stockDiff);
          // Only a reduction can be a damage write-off; increases are always corrections.
          const type: MovementType =
            r.stockDiff < 0 && /damag/i.test(r.reason) ? "damaged" : "approved_correction";
          d.movements.push({
            id: uid("mv"),
            variantId: r.variantId,
            type,
            qty: r.stockDiff,
            at: now(),
            actorId: d.currentUserId,
            reference: r.number,
            note: r.reason,
          });
        }
        if (r.type === "cash_discrepancy" && r.cashSessionId) {
          const c = d.cashSessions.find((x) => x.id === r.cashSessionId);
          if (c) {
            c.status = "resolved";
            c.ownerNote = note || "Accepted by owner.";
          }
        }
      }
      if (r.stockCountId) {
        const sc = d.stockCounts.find((x) => x.id === r.stockCountId);
        if (sc && !d.approvals.some((x) => x.stockCountId === sc.id && x.status === "pending"))
          sc.status = "reviewed";
      }
      log(d, `${r.type}.${decision}`, r.number, note || `${r.type} ${decision}.`);
    });
    return { ok: true, data: getState().approvals.find((x) => x.id === id)! };
  },
  async verifyPayment(id, result, actual, note, reference) {
    await wait();
    if (getState().role !== "owner")
      return { ok: false, error: "Only the owner can verify payments." };
    if (!note.trim()) return { ok: false, error: "Describe how you verified this payment." };
    mutate((d) => {
      const p = d.payments.find((x) => x.id === id);
      if (!p) return;
      p.status = result === "verified" && actual !== p.expected ? "exception" : result;
      p.recorded = actual;
      if (reference) p.reference = reference;
      p.verifiedBy = d.currentUserId;
      p.verifiedAt = now();
      p.verificationNote = note;
      p.verificationSource = "manual";
      const sale = d.sales.find((s) => s.id === p.saleId);
      log(
        d,
        "payment.manually_verified",
        sale?.receiptNo ?? id,
        `Marked ${p.status} (manual): ${note}`,
      );
    });
    return { ok: true, data: null };
  },
  async submitStockCount(lines) {
    await wait(350);
    if (!lines.length) return { ok: false, error: "Select at least one item to count." };
    if (lines.some((l) => !Number.isInteger(l.counted) || l.counted < 0))
      return { ok: false, error: "Counts must be whole numbers of 0 or more." };
    const id = uid("sc");
    let requests = 0;
    mutate((d) => {
      const recorded = lines.map((l) => ({
        variantId: l.variantId,
        recorded: findVariant(d, l.variantId)?.variant.stock ?? 0,
        counted: l.counted,
      }));
      d.stockCounts.unshift({
        id,
        startedAt: now(),
        submittedAt: now(),
        actorId: d.currentUserId,
        lines: recorded,
        status: "submitted",
      });
      for (const l of recorded) {
        const diff = l.counted - l.recorded;
        if (diff !== 0) {
          requests++;
          newApproval(d, {
            type: "stock_adjustment",
            variantId: l.variantId,
            stockDiff: diff,
            reason: `Stock count variance (${l.recorded} recorded, ${l.counted} counted)`,
            stockCountId: id,
          });
        }
      }
      if (!requests) {
        const sc = d.stockCounts[0];
        if (sc) sc.status = "reviewed";
      }
      log(
        d,
        "stock_count.submitted",
        id,
        `${recorded.length} item(s) counted, ${requests} variance(s) sent for approval.`,
      );
    });
    return { ok: true, data: { id, requests } };
  },
  async getAuditEvents() {
    return getState().audit;
  },
  async saveEmployee(e) {
    await wait();
    if (!e.name.trim() || !/^\S+@\S+\.\S+$/.test(e.email))
      return { ok: false, error: "Enter a name and a valid email." };
    mutate((d) => {
      const i = d.employees.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        const prev = nth(d.employees, i);
        d.employees[i] = e;
        if (prev.active !== e.active)
          log(
            d,
            e.active ? "employee.reactivated" : "employee.deactivated",
            e.email,
            `${e.name} ${e.active ? "reactivated" : "deactivated"}.`,
          );
        else log(d, "employee.updated", e.email, `${e.name} updated.`);
      } else {
        d.employees.push(e);
        log(
          d,
          "employee.created",
          e.email,
          `Account placeholder created for ${e.name} (no invite sent — backend not connected).`,
        );
      }
    });
    return { ok: true, data: null };
  },
  async saveSettings(st) {
    await wait(400);
    if (!st.shopName.trim()) return { ok: false, error: "Shop name is required." };
    mutate((d) => {
      d.settings = st;
      log(d, "settings.updated", "shop", "Shop settings updated.");
    });
    return { ok: true, data: null };
  },
  setDemoRole(role) {
    mutate((d) => {
      d.role = role;
      d.currentUserId = role === "owner" ? "emp_owner" : "emp_mali";
    });
  },
};

export function markNotificationsRead(ids?: string[]) {
  mutate((d) =>
    d.notifications.forEach((n) => (!ids || ids.includes(n.id) ? (n.read = true) : null)),
  );
}

export const newId = uid;
