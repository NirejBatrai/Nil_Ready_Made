/**
 * SAMPLE DEMO DATA — all people, products, prices and transactions are fictional.
 * Generated deterministically so server and client render identically.
 * Never seed this into a production database.
 */
import { cashChange, expectedClosingCash } from "@/lib/calc";
import { variantLabel } from "@/lib/format";
import { must, nth } from "@/lib/assert";
import type {
  AppNotification,
  ApprovalRequest,
  AuditEvent,
  CashSession,
  Category,
  EmployeeProfile,
  InventoryMovement,
  Payment,
  Product,
  ProductVariant,
  Refund,
  Sale,
  ShopSettings,
  StockCount,
} from "@/types/domain";

export const DEMO_TODAY = "2026-10-22";
const DAY = 86_400_000;
const base = Date.parse(`${DEMO_TODAY}T00:00:00+07:00`);
const at = (dayOffset: number, h: number, m = 0) =>
  new Date(base + dayOffset * DAY + (h * 60 + m) * 60_000).toISOString();

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261022);
const pick = <T>(a: T[]) => nth(a, Math.floor(r() * a.length));
const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));

export const EMPLOYEES: EmployeeProfile[] = [
  {
    id: "emp_owner",
    name: "Ploy Siriwan",
    email: "ploy@luxe-demo.test",
    phone: "+66 81 000 1001",
    role: "owner",
    active: true,
    lastActiveAt: at(0, 8, 40),
    createdAt: at(-400, 9),
  },
  {
    id: "emp_mali",
    name: "Mali Chaiyaporn",
    email: "mali@luxe-demo.test",
    phone: "+66 81 000 1002",
    role: "employee",
    active: true,
    lastActiveAt: at(0, 16, 5),
    createdAt: at(-210, 9),
  },
  {
    id: "emp_kanya",
    name: "Kanya Rattana",
    email: "kanya@luxe-demo.test",
    phone: "+66 81 000 1003",
    role: "employee",
    active: true,
    lastActiveAt: at(-1, 19, 30),
    createdAt: at(-90, 9),
  },
  {
    id: "emp_arun",
    name: "Arun Thongdee",
    email: "arun@luxe-demo.test",
    phone: "+66 81 000 1004",
    role: "employee",
    active: false,
    lastActiveAt: at(-48, 18),
    createdAt: at(-300, 9),
  },
];

type Def = {
  name: string;
  cat: Category;
  price: number;
  cost?: number;
  sizes?: string[];
  colors?: string[];
  low?: number;
  desc: string;
  /** Target current stock per variant; small numbers create low-stock alerts. */
  target?: [number, number];
};

const DEFS: Def[] = [
  {
    name: "Leather Slide Sandal",
    cat: "shoes",
    price: 1290,
    cost: 520,
    sizes: ["37", "38", "39", "40"],
    colors: ["Tan", "Black"],
    desc: "Soft calf leather slide with cushioned footbed.",
  },
  {
    name: "Canvas Low Sneaker",
    cat: "shoes",
    price: 1590,
    cost: 640,
    sizes: ["38", "40", "42"],
    colors: ["White"],
    desc: "Everyday canvas sneaker, vulcanised sole.",
  },
  {
    name: "Espadrille Wedge",
    cat: "shoes",
    price: 1890,
    cost: 760,
    sizes: ["37", "38", "39"],
    colors: ["Natural"],
    target: [1, 2],
    desc: "Jute-wrapped wedge with ankle tie.",
  },
  {
    name: "Woven Straw Tote",
    cat: "bags",
    price: 990,
    cost: 380,
    desc: "Hand-woven straw tote with leather handles.",
  },
  {
    name: "Leather Crossbody",
    cat: "bags",
    price: 2490,
    cost: 1050,
    colors: ["Black", "Cognac"],
    desc: "Compact crossbody, adjustable strap.",
  },
  {
    name: "Striped Beach Bag",
    cat: "bags",
    price: 690,
    cost: 240,
    colors: ["Navy", "Sand"],
    desc: "Heavy canvas beach bag, inner pocket.",
  },
  {
    name: "Ribbed Triangle Bikini",
    cat: "bikinis",
    price: 1190,
    cost: 410,
    sizes: ["S", "M", "L"],
    colors: ["Sage", "Coral"],
    desc: "Ribbed recycled fabric, removable pads.",
  },
  {
    name: "Bandeau Bikini Set",
    cat: "bikinis",
    price: 1290,
    cost: 450,
    sizes: ["S", "M", "L"],
    colors: ["Black"],
    target: [0, 2],
    desc: "Strapless bandeau with high-cut brief.",
  },
  {
    name: "Square-Neck One-Piece",
    cat: "swimwear",
    price: 1690,
    cost: 600,
    sizes: ["S", "M", "L"],
    colors: ["Ivory", "Black"],
    desc: "Sculpting one-piece with low back.",
  },
  {
    name: "Men's Swim Short",
    cat: "swimwear",
    price: 890,
    cost: 300,
    sizes: ["M", "L", "XL"],
    colors: ["Navy", "Olive"],
    desc: "Quick-dry swim short, mesh lining.",
  },
  {
    name: "Kids Rash Guard",
    cat: "swimwear",
    price: 590,
    cost: 190,
    sizes: ["4Y", "6Y", "8Y"],
    desc: "UPF 50+ long-sleeve rash guard.",
  },
  {
    name: "Linen Midi Dress",
    cat: "dresses",
    price: 2290,
    cost: 880,
    sizes: ["S", "M", "L"],
    colors: ["Sand", "White"],
    desc: "Washed linen midi with tie waist.",
  },
  {
    name: "Floral Wrap Dress",
    cat: "dresses",
    price: 1790,
    cost: 690,
    sizes: ["S", "M"],
    target: [1, 3],
    desc: "Viscose wrap dress, flutter sleeve.",
  },
  { name: "Cotton Kaftan", cat: "dresses", price: 1490, desc: "One-size cotton kaftan cover-up." },
  {
    name: 'Cabin Spinner 20"',
    cat: "suitcases",
    price: 3990,
    cost: 1700,
    colors: ["Graphite", "Sand"],
    target: [2, 5],
    desc: "Polycarbonate cabin case, TSA lock.",
  },
  {
    name: 'Check-in Spinner 26"',
    cat: "suitcases",
    price: 5490,
    cost: 2400,
    colors: ["Graphite"],
    target: [1, 1],
    desc: "Expandable check-in case, 4 spinner wheels.",
  },
  {
    name: "Weekender Duffel",
    cat: "suitcases",
    price: 2190,
    cost: 900,
    desc: "Water-resistant duffel with shoe pocket.",
  },
  {
    name: "Beach Volleyball",
    cat: "sports_balls",
    price: 790,
    cost: 310,
    desc: "Soft-touch beach volleyball, size 5.",
  },
  {
    name: "Football Size 5",
    cat: "sports_balls",
    price: 690,
    cost: 260,
    desc: "Machine-stitched training football.",
  },
  {
    name: "Inflatable Beach Ball (3-pack)",
    cat: "sports_balls",
    price: 250,
    cost: 70,
    desc: "Three 40 cm inflatable beach balls.",
  },
  {
    name: "Wide-Brim Sun Hat",
    cat: "accessories",
    price: 790,
    cost: 260,
    colors: ["Natural", "Black"],
    desc: "Packable paper-straw hat.",
  },
  {
    name: "Polarized Sunglasses",
    cat: "accessories",
    price: 1190,
    cost: 380,
    colors: ["Tortoise", "Black"],
    desc: "UV400 polarized lenses.",
  },
  {
    name: "Microfiber Beach Towel",
    cat: "accessories",
    price: 490,
    cost: 150,
    colors: ["Sage", "Terracotta"],
    desc: "Sand-free quick-dry towel.",
  },
  {
    name: "Waterproof Phone Pouch",
    cat: "other",
    price: 190,
    cost: 45,
    desc: "IPX8 pouch with lanyard.",
  },
];

function buildProducts(): Product[] {
  return DEFS.map((d, i) => {
    const id = `prd_${String(i + 1).padStart(3, "0")}`;
    const sku = `LX-${d.cat.slice(0, 3).toUpperCase()}-${String(101 + i)}`;
    const sizes = d.sizes ?? [undefined];
    const colors = d.colors ?? [undefined];
    const variants: ProductVariant[] = [];
    let n = 0;
    for (const c of colors)
      for (const s of sizes) {
        n++;
        const vsku =
          sizes[0] || colors[0]
            ? `${sku}-${[s, c?.slice(0, 3).toUpperCase()].filter(Boolean).join("-")}`
            : sku;
        variants.push({
          id: `${id}_v${n}`,
          productId: id,
          sku: vsku,
          size: s,
          color: c,
          barcode: `885${String(100000 + i * 100 + n).padStart(7, "0")}`,
          openingStock: 0,
          stock: d.target ? int(d.target[0], d.target[1]) : int(4, 14),
        });
      }
    return {
      id,
      name: d.name,
      sku,
      category: d.cat,
      description: d.desc,
      price: d.price,
      cost: d.cost,
      barcode: variants.length === 1 ? nth(variants, 0).barcode : undefined,
      active: true,
      lowStockThreshold: d.cat === "suitcases" ? 2 : 3,
      variants,
    };
  });
}

export interface DemoSeed {
  products: Product[];
  sales: Sale[];
  payments: Payment[];
  movements: InventoryMovement[];
  cashSessions: CashSession[];
  refunds: Refund[];
  approvals: ApprovalRequest[];
  audit: AuditEvent[];
  employees: EmployeeProfile[];
  notifications: AppNotification[];
  stockCounts: StockCount[];
  settings: ShopSettings;
  counters: { receipt: number; approval: number };
}

export function createSeed(): DemoSeed {
  const products = buildProducts();
  const variants = products.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const sales: Sale[] = [];
  const payments: Payment[] = [];
  const movements: InventoryMovement[] = [];
  const audit: AuditEvent[] = [];
  const cashSessions: CashSession[] = [];
  const soldBy: Record<string, number> = {};
  let receipt = 1;

  for (let d = -13; d <= 0; d++) {
    const staff = d % 3 === 0 ? "emp_kanya" : "emp_mali";
    const sessionId = `cs_${d + 100}`;
    const count = d === 0 ? 9 : int(6, 13);
    for (let k = 0; k < count; k++) {
      const h = 10 + Math.floor((k / count) * 9);
      const createdAt = at(d, h, int(0, 59));
      const nItems = r() < 0.6 ? 1 : int(2, 3);
      const items = Array.from({ length: nItems }, () => {
        const { p, v } = pick(variants);
        const qty = r() < 0.85 ? 1 : 2;
        soldBy[v.id] = (soldBy[v.id] || 0) + qty;
        return {
          productId: p.id,
          variantId: v.id,
          name: p.name,
          variantLabel: variantLabel(v),
          sku: v.sku,
          qty,
          unitPrice: p.price,
          unitCost: p.cost,
        };
      });
      const subtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const discount = r() < 0.08 ? Math.round(subtotal * 0.05) : 0;
      const total = subtotal - discount;
      const method = r() < 0.55 ? "cash" : "qr";
      const id = `sale_${receipt}`;
      const no = `LX-${(d + 100).toString()}-${String(receipt).padStart(4, "0")}`;
      const received =
        method === "cash" ? Math.ceil(total / 100) * 100 + (r() < 0.3 ? 500 : 0) : undefined;
      sales.push({
        id,
        receiptNo: no,
        createdAt,
        employeeId: staff,
        items,
        subtotal,
        discount,
        total,
        paymentMethod: method,
        status: "completed",
        cashReceived: received,
        change: received !== undefined ? cashChange(total, received).change : undefined,
        cashSessionId: method === "cash" ? sessionId : undefined,
      });
      const qrStatus = d === 0 && k > 4 ? "pending" : d === -2 && k === 1 ? "failed" : "verified";
      payments.push({
        id: `pay_${receipt}`,
        saleId: id,
        method,
        expected: total,
        recorded: total,
        reference: method === "qr" ? `QR${(728100 + receipt * 37).toString()}` : undefined,
        recordedAt: createdAt,
        status: method === "cash" ? "recorded" : qrStatus,
        verifiedBy: method === "qr" && qrStatus === "verified" ? "emp_owner" : undefined,
        verifiedAt: method === "qr" && qrStatus === "verified" ? at(d, 21) : undefined,
        verificationNote:
          method === "qr" && qrStatus === "verified"
            ? "Matched against bank app statement (manual)."
            : qrStatus === "failed"
              ? "No matching credit found in bank statement."
              : undefined,
        verificationSource: method === "qr" && qrStatus !== "pending" ? "manual" : undefined,
      });
      items.forEach((it, j) =>
        movements.push({
          id: `mv_s${receipt}_${j}`,
          variantId: it.variantId,
          type: "sale",
          qty: -it.qty,
          at: createdAt,
          actorId: staff,
          reference: no,
        }),
      );
      audit.push({
        id: `au_s${receipt}`,
        at: createdAt,
        actorId: staff,
        action: "sale.completed",
        target: no,
        result: "success",
        summary: `Sale of ${items.length} line(s), ${method.toUpperCase()}, ฿${total}`,
      });
      receipt++;
    }
  }

  // Mark one sale voided and one refunded (historic)
  const voided = nth(sales, 20);
  voided.status = "voided";
  const refundedSale = must(
    sales.find((s, i) => i > 40 && s.paymentMethod === "cash"),
    "refund sale",
  );
  refundedSale.status = "refunded";

  // Opening stock = current target + sold
  for (const { v } of variants) {
    v.openingStock = v.stock + (soldBy[v.id] || 0);
    movements.push({
      id: `mv_o_${v.id}`,
      variantId: v.id,
      type: "opening",
      qty: v.openingStock,
      at: at(-14, 9),
      actorId: "emp_owner",
      note: "Opening stock count",
    });
  }
  // Some restocks + damage
  const rs = nth(variants, 5).v;
  rs.openingStock -= 6;
  movements.push({
    id: "mv_r1",
    variantId: rs.id,
    type: "restock",
    qty: 6,
    at: at(-5, 11),
    actorId: "emp_owner",
    reference: "PO-2026-118",
  });
  const dm = nth(variants, 30).v;
  dm.openingStock += 1;
  movements.push({
    id: "mv_d1",
    variantId: dm.id,
    type: "damaged",
    qty: -1,
    at: at(-4, 15),
    actorId: "emp_owner",
    note: "Torn strap, approved write-off",
  });

  const refunds: Refund[] = [
    {
      id: "rf_1",
      saleId: refundedSale.id,
      amount: refundedSale.total,
      method: "cash",
      reason: "Wrong size; customer returned unworn item.",
      at: at(-3, 14),
      approvalId: "apr_1",
    },
  ];
  refundedSale.items.forEach((it, j) =>
    movements.push({
      id: `mv_ret_${j}`,
      variantId: it.variantId,
      type: "customer_return",
      qty: it.qty,
      at: at(-3, 14),
      actorId: "emp_mali",
      reference: refundedSale.receiptNo,
    }),
  );
  // reflect return in stock
  refundedSale.items.forEach((it) => {
    const v = must(
      variants.find((x) => x.v.id === it.variantId),
      "variant",
    ).v;
    v.stock += it.qty;
  });

  // Cash sessions
  for (let d = -13; d <= 0; d++) {
    const id = `cs_${d + 100}`;
    const employeeId = d % 3 === 0 ? "emp_kanya" : "emp_mali";
    const cashSales = sales
      .filter((s) => s.cashSessionId === id && s.status !== "voided")
      .reduce((a, s) => a + s.total, 0);
    const cashRefunds = refunds
      .filter((f) => f.method === "cash" && dayOf(f.at) === d)
      .reduce((a, f) => a + f.amount, 0);
    const cm =
      d === -6
        ? [
            {
              id: "cm1",
              direction: "out" as const,
              amount: 300,
              reason: "Cleaning supplies (receipt kept)",
              at: at(d, 13),
            },
          ]
        : [];
    const s: CashSession = {
      id,
      employeeId,
      openedAt: at(d, 9, 50),
      openingFloat: 2000,
      cashMovements: cm,
      status: "open",
    };
    if (d < 0) {
      const expected = expectedClosingCash({
        openingFloat: 2000,
        cashSales,
        cashRefunds,
        inflows: 0,
        outflows: cm.reduce((a, c) => a + c.amount, 0),
      });
      const diff = d === -3 ? -120 : d === -6 ? 20 : 0;
      s.closedAt = at(d, 20, 10);
      s.expectedAtClose = expected;
      s.countedCash = expected + diff;
      s.status = diff === 0 ? "balanced" : d === -3 ? "pending_review" : "resolved";
      s.explanation =
        d === -3
          ? "Busy afternoon; may have given change for ฿500 instead of ฿380 on one sale."
          : d === -6
            ? "Customer left ฿20 extra and did not wait for change."
            : undefined;
      s.ownerNote = d === -6 ? "Accepted. Logged as overage." : undefined;
    }
    cashSessions.push(s);
  }

  const approvals: ApprovalRequest[] = [
    {
      id: "apr_1",
      number: "REQ-1001",
      type: "refund",
      requesterId: "emp_mali",
      createdAt: at(-3, 13, 40),
      saleId: refundedSale.id,
      amount: refundedSale.total,
      reason: "Wrong size; customer returned unworn item with tags.",
      status: "approved",
      decidedAt: at(-3, 13, 55),
      decidedBy: "emp_owner",
      decisionNote: "OK, tags intact.",
    },
    {
      id: "apr_2",
      number: "REQ-1002",
      type: "discount",
      requesterId: "emp_kanya",
      createdAt: at(-2, 15),
      amount: 25,
      reason: "Customer asked for 25% off two dresses.",
      status: "rejected",
      decidedAt: at(-2, 15, 20),
      decidedBy: "emp_owner",
      decisionNote: "Above policy. Offer 5% instead.",
    },
    {
      id: "apr_3",
      number: "REQ-1003",
      type: "refund",
      requesterId: "emp_mali",
      createdAt: at(0, 14, 12),
      saleId: nth(sales, sales.length - 6).id,
      amount: nth(sales, sales.length - 6).total,
      reason: "Customer reports a loose seam on the item.",
      status: "pending",
    },
    {
      id: "apr_4",
      number: "REQ-1004",
      type: "stock_adjustment",
      requesterId: "emp_mali",
      createdAt: at(0, 11, 5),
      variantId: nth(variants, 12).v.id,
      stockDiff: -1,
      reason: "Damaged item: water stain found on display piece.",
      status: "pending",
    },
    {
      id: "apr_5",
      number: "REQ-1005",
      type: "cash_discrepancy",
      requesterId: "emp_mali",
      createdAt: at(-3, 20, 12),
      cashSessionId: "cs_97",
      amount: -120,
      reason: "Busy afternoon; may have given change for ฿500 instead of ฿380 on one sale.",
      status: "pending",
    },
    {
      id: "apr_6",
      number: "REQ-1006",
      type: "discount",
      requesterId: "emp_kanya",
      createdAt: at(0, 15, 30),
      amount: 10,
      reason: "Returning customer buying 3 swim items; requests 10%.",
      status: "pending",
    },
  ];

  audit.push(
    {
      id: "au_x1",
      at: at(-3, 13, 40),
      actorId: "emp_mali",
      action: "refund.requested",
      target: refundedSale.receiptNo,
      result: "pending",
      summary: "Refund requested: wrong size.",
    },
    {
      id: "au_x2",
      at: at(-3, 13, 55),
      actorId: "emp_owner",
      action: "refund.approved",
      target: refundedSale.receiptNo,
      result: "success",
      summary: "Refund approved; item returned to stock.",
    },
    {
      id: "au_x3",
      at: at(-2, 15, 20),
      actorId: "emp_owner",
      action: "discount.rejected",
      target: "REQ-1002",
      result: "success",
      summary: "Discount request above policy rejected.",
    },
    {
      id: "au_x4",
      at: at(-4, 10),
      actorId: "emp_owner",
      action: "product.price_changed",
      target: nth(products, 4).sku,
      result: "success",
      summary: "Selling price changed ฿2,390 → ฿2,490.",
    },
    {
      id: "au_x5",
      at: at(0, 11, 5),
      actorId: "emp_mali",
      action: "stock_adjustment.requested",
      target: nth(variants, 12).v.sku,
      result: "pending",
      summary: "Requested −1 (damaged).",
    },
    {
      id: "au_x6",
      at: at(-3, 20, 12),
      actorId: "emp_mali",
      action: "cash_session.closed",
      target: "cs_97",
      result: "success",
      summary: "Closed with −฿120 discrepancy; explanation provided.",
    },
    {
      id: "au_x7",
      at: at(0, 9, 50),
      actorId: "emp_mali",
      action: "cash_session.opened",
      target: "cs_100",
      result: "success",
      summary: "Opened with ฿2,000 float.",
    },
    {
      id: "au_x8",
      at: at(0, 7, 12),
      actorId: "unknown",
      action: "auth.login_failed",
      target: "kanya@luxe-demo.test",
      result: "failure",
      summary: "3 failed login attempts from a new device.",
    },
    {
      id: "au_x9",
      at: at(-1, 21),
      actorId: "emp_owner",
      action: "payment.manually_verified",
      target: "QR batch",
      result: "success",
      summary: "QR payments marked verified (manual check).",
    },
    {
      id: "au_x10",
      at: at(-4, 15),
      actorId: "emp_owner",
      action: "stock_adjustment.approved",
      target: dm.sku,
      result: "success",
      summary: "Damaged write-off −1 approved.",
    },
  );

  const notifications: AppNotification[] = [
    {
      id: "nt1",
      severity: "critical",
      at: at(-3, 20, 12),
      title: "Cash discrepancy requires review",
      body: "Session closed −฿120 against expected cash.",
      link: "/reconciliation",
      read: false,
    },
    {
      id: "nt2",
      severity: "warning",
      at: at(0, 15, 40),
      title: "QR payments pending verification",
      body: "Several QR payments recorded today await manual verification.",
      link: "/payments",
      read: false,
    },
    {
      id: "nt3",
      severity: "warning",
      at: at(0, 14, 12),
      title: "Refund request received",
      body: "REQ-1003 submitted by Mali Chaiyaporn.",
      link: "/approvals",
      read: false,
    },
    {
      id: "nt4",
      severity: "info",
      at: at(0, 11, 5),
      title: "Stock adjustment awaiting approval",
      body: "REQ-1004: −1 damaged item.",
      link: "/approvals",
      read: true,
    },
    {
      id: "nt5",
      severity: "warning",
      at: at(0, 8),
      title: "Products below minimum stock",
      body: "Several variants are at or below their threshold.",
      link: "/inventory",
      read: false,
    },
    {
      id: "nt6",
      severity: "info",
      at: at(-1, 22),
      title: "Transaction requires review",
      body: "One sale was voided yesterday evening.",
      link: "/sales",
      read: true,
    },
    {
      id: "nt7",
      severity: "info",
      at: at(0, 6),
      title: "Backup status unknown",
      body: "No backend is connected, so no backups are running.",
      link: "/settings",
      read: true,
    },
  ];

  return {
    products,
    sales,
    payments,
    movements,
    cashSessions,
    refunds,
    approvals,
    audit: audit.sort((a, b) => b.at.localeCompare(a.at)),
    employees: EMPLOYEES,
    notifications,
    stockCounts: [],
    settings: {
      shopName: "Luxe Beach Boutique",
      address: "88/12 Beach Road, Patong, Phuket 83150",
      taxId: "0-0000-00000-00-0 (demo)",
      receiptFooter: "Thank you. Exchanges within 7 days with receipt.",
      showSkuOnReceipt: true,
      defaultLowStock: 3,
      maxEmployeeDiscountPct: 0,
      refundWindowDays: 7,
      notifyCashDiscrepancy: true,
      notifyPendingQr: true,
      notifyLowStock: true,
    },
    counters: { receipt, approval: 1007 },
  };

  function dayOf(iso: string) {
    return Math.floor((Date.parse(iso) - base) / DAY);
  }
}
