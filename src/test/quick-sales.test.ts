// @vitest-environment node
/**
 * INTERIM Quick Sales (decision 0004): Bangkok business day, permission table, staff accounts and
 * the Quick Sales service, against an ISOLATED, throwaway MongoDB (mongodb-memory-server on
 * 127.0.0.1). Never reads MONGODB_URI or .env and never touches Atlas.
 */
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bangkokDay, bangkokTime, parseBusinessDay } from "@/lib/bangkok-time";
import { hasPermission, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { createAuthService, ensureAuthIndexes } from "@/server/auth/auth.server";
import { connectOptions } from "@/server/db.server";
import { openingFloatModel, quickSaleModel } from "@/server/models/quick-sale.server";
import { userModel } from "@/server/models/user.server";
import {
  CANCEL_WINDOW_MS,
  createQuickSalesService,
  QUICK_SALE_ERRORS,
} from "@/server/quick-sales.server";

const PASSWORD = "correct-horse-battery-1"; // test-only value for a throwaway database
const MIN = 60 * 1000;
/** 2026-11-01 10:00 in Bangkok (03:00 UTC). */
const MORNING = Date.UTC(2026, 10, 1, 3, 0, 0);
/** The last millisecond of 2026-11-01 in Bangkok, and midnight right after it. */
const LAST_MS = Date.UTC(2026, 10, 1, 16, 59, 59, 999);
const MIDNIGHT = Date.UTC(2026, 10, 1, 17, 0, 0, 0);

let server: MongoMemoryServer;
let conn: Connection;
let clock: number;
const now = () => new Date(clock);
let q: ReturnType<typeof createQuickSalesService>;
const ALICE = { id: "usr_alice" };
const BOB = { id: "usr_bob" };

const sale = (over: Record<string, unknown> = {}) => ({
  itemText: "Silk scarf",
  amountText: "1,800.50",
  payment: "cash",
  ...over,
});

async function added(actor: { id: string }, over: Record<string, unknown> = {}) {
  const r = await q.addSale(actor, sale(over));
  if (!r.ok) throw new Error(r.error);
  return r.sale;
}

async function opened(amountText = "500") {
  const r = await q.recordOpeningFloat(ALICE, { amountText });
  if (!r.ok) throw new Error(r.error);
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_quick_sales_test" });
  await ensureAuthIndexes(conn);
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await openingFloatModel(conn).collection.deleteMany({});
  await quickSaleModel(conn).collection.deleteMany({});
  await userModel(conn).collection.deleteMany({});
  clock = MORNING;
  q = createQuickSalesService(conn, { now });
});

describe("Bangkok business day", () => {
  it("changes at midnight Bangkok time (17:00 UTC), not at UTC midnight", () => {
    expect(bangkokDay(new Date(LAST_MS))).toBe("2026-11-01");
    expect(bangkokDay(new Date(MIDNIGHT))).toBe("2026-11-02");
    expect(bangkokTime(new Date(LAST_MS))).toBe("23:59");
    expect(bangkokTime(new Date(MIDNIGHT))).toBe("00:00");
    // UTC midnight is 07:00 in Bangkok, the same business day as the evening before (UTC).
    expect(bangkokDay(new Date(Date.UTC(2026, 10, 2, 0, 0)))).toBe("2026-11-02");
    expect(bangkokDay(new Date(Date.UTC(2026, 10, 1, 23, 59)))).toBe("2026-11-02");
    expect(bangkokTime(new Date(MORNING))).toBe("10:00");
  });

  it("parseBusinessDay accepts real YYYY-MM-DD dates only and never throws", () => {
    expect(parseBusinessDay("2026-11-01")).toBe("2026-11-01");
    expect(parseBusinessDay("2028-02-29")).toBe("2028-02-29");
    for (const bad of [
      "2026-02-29",
      "2026-13-01",
      "2026-11-31",
      "2026-11-1",
      "26-11-01",
      " 2026-11-01",
      "2026-11-01T00:00",
      "1999-01-01",
      "",
      null,
      undefined,
      20261101,
      { $gt: "" },
    ])
      expect(parseBusinessDay(bad), String(bad)).toBeNull();
  });
});

describe("permission table (deny by default)", () => {
  const ALL: Permission[] = [
    "quickSales.useOwn",
    "quickSales.recordOpeningFloat",
    "quickSales.add",
    "quickSales.cancelOwn",
    "quickSales.viewDay",
  ];

  it("staff may only use their own page, record the opening change, add and cancel their own", () => {
    expect([...(ROLE_PERMISSIONS["staff"] ?? [])].sort()).toEqual(
      [
        "quickSales.add",
        "quickSales.cancelOwn",
        "quickSales.recordOpeningFloat",
        "quickSales.useOwn",
      ].sort(),
    );
    expect(hasPermission("staff", "quickSales.viewDay")).toBe(false);
  });

  it("the owner has every permission", () => {
    for (const p of ALL) expect(hasPermission("owner", p), p).toBe(true);
  });

  it("unknown roles, prototype keys and non-strings get nothing", () => {
    for (const role of ["employee", "Owner", "", "__proto__", "constructor", "toString", null, 1])
      for (const p of ALL) expect(hasPermission(role, p), `${String(role)} ${p}`).toBe(false);
    expect(hasPermission("owner", "products.delete" as Permission)).toBe(false);
  });
});

describe("staff accounts", () => {
  it("createStaff makes a staff user who can sign in; requireOwner refuses them", async () => {
    const auth = createAuthService(conn);
    expect(
      await auth.createStaff({ email: "S@Example.invalid", name: "Som", password: PASSWORD }),
    ).toEqual({ ok: true });
    const stored = await userModel(conn).findOne({ email: "s@example.invalid" }).lean();
    expect(stored).toMatchObject({ role: "staff", name: "Som", active: true });
    const login = await auth.login({ email: "s@example.invalid", password: PASSWORD }, undefined);
    if (!login.ok) throw new Error(login.error);
    expect(login.user).toMatchObject({ name: "Som", role: "staff" });
    await expect(auth.requireOwner(login.token)).rejects.toThrow("Not allowed.");
    await expect(auth.requirePermission(login.token, "quickSales.viewDay")).rejects.toThrow(
      "Not allowed.",
    );
    await expect(auth.requirePermission(login.token, "quickSales.add")).resolves.toMatchObject({
      role: "staff",
    });
    await expect(auth.requirePermission("A".repeat(43), "quickSales.add")).rejects.toThrow(
      "Not signed in.",
    );
  });

  it("refuses a duplicate email (also the owner's), bad input and weak passwords; several staff are fine", async () => {
    const auth = createAuthService(conn);
    const owner = await auth.createFirstOwner({
      email: "owner@example.invalid",
      name: "Owner",
      password: PASSWORD,
    });
    expect(owner.ok).toBe(true);
    const make = (email: string, password = PASSWORD) =>
      auth.createStaff({ email, name: "Staff", password });
    expect(await make("a@example.invalid")).toEqual({ ok: true });
    expect(await make("b@example.invalid")).toEqual({ ok: true });
    expect(await make("A@example.invalid")).toEqual({
      ok: false,
      error: "An account with that email already exists.",
    });
    expect((await make("owner@example.invalid")).ok).toBe(false);
    expect((await make("not-an-email")).ok).toBe(false);
    expect((await make("c@example.invalid", "short")).ok).toBe(false);
    expect(
      (
        await auth.createStaff({
          email: "d@example.invalid",
          name: "X",
          password: PASSWORD,
          role: "owner",
        })
      ).ok,
    ).toBe(false);
    expect(await userModel(conn).countDocuments({ role: "owner" })).toBe(1);
    expect(await userModel(conn).countDocuments({ role: "staff" })).toBe(2);
  });
});

describe("opening change money", () => {
  it("one per Bangkok business day; the second attempt gets a clear message", async () => {
    expect(await q.recordOpeningFloat(ALICE, { amountText: "1,000.50" })).toEqual({ ok: true });
    expect(await q.recordOpeningFloat(BOB, { amountText: "200" })).toEqual({
      ok: false,
      error: QUICK_SALE_ERRORS.openingExists,
    });
    const stored = await openingFloatModel(conn).find().lean();
    expect(stored).toEqual([
      {
        _id: "2026-11-01",
        amountSatang: 100050,
        userId: ALICE.id,
        createdAt: new Date(MORNING),
        __v: 0,
      },
    ]);
  });

  it("5 simultaneous attempts store exactly one", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => q.recordOpeningFloat({ id: `usr_${n}` }, { amountText: `${n}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await openingFloatModel(conn).countDocuments()).toBe(1);
  });

  it("the next business day starts at midnight Bangkok time", async () => {
    clock = LAST_MS;
    await opened();
    expect((await q.recordOpeningFloat(ALICE, { amountText: "1" })).ok).toBe(false);
    clock = MIDNIGHT;
    expect(await q.recordOpeningFloat(ALICE, { amountText: "300" })).toEqual({ ok: true });
    expect(
      (await openingFloatModel(conn).find().sort({ _id: 1 }).lean()).map((f) => f._id),
    ).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("refuses bad amounts and any extra field (date, user)", async () => {
    for (const input of [
      { amountText: "1.005" },
      { amountText: "-5" },
      { amountText: "abc" },
      { amountText: 500 },
      { amountText: "500", businessDay: "2026-10-31" },
      { amountText: "500", userId: BOB.id },
      null,
      "500",
    ])
      expect((await q.recordOpeningFloat(ALICE, input)).ok, JSON.stringify(input)).toBe(false);
    expect(await openingFloatModel(conn).countDocuments()).toBe(0);
    // Zero change money is a valid opening.
    expect(await q.recordOpeningFloat(ALICE, { amountText: "0" })).toEqual({ ok: true });
  });
});

describe("adding a quick sale", () => {
  it("needs today's opening change first", async () => {
    expect(await q.addSale(ALICE, sale())).toEqual({
      ok: false,
      error: QUICK_SALE_ERRORS.openingMissing,
    });
    expect(await quickSaleModel(conn).countDocuments()).toBe(0);
  });

  it("stores satang, the user, the server time and the business day; trims the item", async () => {
    await opened();
    const r = await q.addSale(ALICE, sale({ itemText: "  Silk scarf  ", payment: "qr" }));
    expect(r).toEqual({
      ok: true,
      sale: {
        id: expect.stringMatching(/^qs_[0-9a-f-]{36}$/),
        itemText: "Silk scarf",
        amountSatang: 180050,
        payment: "qr",
        time: "10:00",
        cancelled: false,
        canCancel: true,
      },
    });
    const [stored] = await quickSaleModel(conn).find().lean();
    expect(stored).toMatchObject({
      itemText: "Silk scarf",
      amountSatang: 180050,
      payment: "qr",
      userId: ALICE.id,
      businessDay: "2026-11-01",
      createdAt: new Date(MORNING),
      cancelled: false,
      cancelledAt: null,
    });
  });

  it("refuses bad items, amounts, payments and every client-supplied server field", async () => {
    await opened();
    const bad: Record<string, unknown>[] = [
      { itemText: "" },
      { itemText: "   " },
      { itemText: "x".repeat(101) },
      { itemText: "two\nlines" },
      { itemText: "tab\there" },
      { itemText: 5 },
      { amountText: "0" },
      { amountText: "0.00" },
      { amountText: "0.1.0" },
      { amountText: "1.005" },
      { amountText: "-1" },
      { amountText: "10,000,000.01" },
      { amountText: 100 },
      { payment: "card" },
      { payment: "CASH" },
      { payment: undefined },
      { createdAt: "2020-01-01T00:00:00Z" },
      { businessDay: "2026-10-31" },
      { userId: BOB.id },
      { cancelled: true },
      { _id: "qs_mine" },
    ];
    for (const over of bad)
      expect((await q.addSale(ALICE, sale(over))).ok, JSON.stringify(over)).toBe(false);
    expect(await quickSaleModel(conn).countDocuments()).toBe(0);
    expect((await q.addSale(ALICE, sale({ itemText: "x".repeat(100) }))).ok).toBe(true);
    expect((await q.addSale(ALICE, sale({ itemText: "ผ้าไหม", amountText: "0.01" }))).ok).toBe(
      true,
    );
  });

  it("payment must be chosen: no payment, null, empty or a guess is refused and nothing is stored", async () => {
    await opened();
    const { payment: _none, ...withoutPayment } = sale();
    for (const input of [
      withoutPayment,
      sale({ payment: null }),
      sale({ payment: "" }),
      sale({ payment: ["cash"] }),
      sale({ payment: { $in: ["cash", "qr"] } }),
    ])
      expect(await q.addSale(ALICE, input), JSON.stringify(input)).toEqual({
        ok: false,
        error: QUICK_SALE_ERRORS.input,
      });
    expect(await quickSaleModel(conn).countDocuments()).toBe(0);
  });

  it("a sale at 23:59:59.999 belongs to that day; at midnight a new day (and opening) begins", async () => {
    clock = LAST_MS;
    await opened();
    await added(ALICE, { itemText: "Late", amountText: "100" });
    clock = MIDNIGHT;
    expect(await q.addSale(ALICE, sale())).toEqual({
      ok: false,
      error: QUICK_SALE_ERRORS.openingMissing,
    });
    await opened("50");
    await added(ALICE, { itemText: "Early", amountText: "200" });
    const first = await q.daySummary("2026-11-01");
    const second = await q.daySummary("2026-11-02");
    expect(first.sales).toEqual([
      { time: "23:59", itemText: "Late", amountSatang: 10000, payment: "cash" },
    ]);
    expect(second.sales).toEqual([
      { time: "00:00", itemText: "Early", amountSatang: 20000, payment: "cash" },
    ]);
    expect([first.openingFloatSatang, second.openingFloatSatang]).toEqual([50000, 5000]);
  });
});

describe("cancelling one's own sale", () => {
  it("works until just under 10 minutes; at 10 minutes it is refused", async () => {
    await opened();
    const early = await added(ALICE);
    const late = await added(ALICE);
    clock = MORNING + CANCEL_WINDOW_MS - 1;
    expect(await q.cancelOwnSale(ALICE, early.id)).toEqual({ ok: true });
    clock = MORNING + CANCEL_WINDOW_MS;
    expect(await q.cancelOwnSale(ALICE, late.id)).toEqual({
      ok: false,
      error: QUICK_SALE_ERRORS.cannotCancel,
    });
    const stored = await quickSaleModel(conn).find().sort({ createdAt: 1 }).lean();
    const byId = new Map(stored.map((s) => [s._id, s]));
    expect(byId.get(early.id)).toMatchObject({
      cancelled: true,
      cancelledAt: new Date(MORNING + CANCEL_WINDOW_MS - 1),
    });
    expect(byId.get(late.id)).toMatchObject({ cancelled: false, cancelledAt: null });
  });

  it("someone else's sale is refused with the same message and stays unchanged", async () => {
    await opened();
    const bobs = await added(BOB);
    expect(await q.cancelOwnSale(ALICE, bobs.id)).toEqual({
      ok: false,
      error: QUICK_SALE_ERRORS.cannotCancel,
    });
    expect(await quickSaleModel(conn).findById(bobs.id).lean()).toMatchObject({
      cancelled: false,
      cancelledAt: null,
    });
    // The same answer as for an id that does not exist: nothing is revealed.
    expect(
      await q.cancelOwnSale(ALICE, `qs_${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`),
    ).toEqual({ ok: false, error: QUICK_SALE_ERRORS.cannotCancel });
  });

  it("is atomic: a second cancel, simultaneous cancels and query objects are refused", async () => {
    await opened();
    const s = await added(ALICE);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => q.cancelOwnSale(ALICE, s.id)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await q.cancelOwnSale(ALICE, s.id)).ok).toBe(false);
    for (const id of [{ $ne: null }, ["x"], 1, "", "qs_x", null])
      expect((await q.cancelOwnSale(ALICE, id)).ok, JSON.stringify(id)).toBe(false);
  });
});

describe("what staff see", () => {
  it("ALL their own sales of today, newest first; not yesterday's, not other people's; no totals", async () => {
    // Yesterday (Bangkok): a sale 1 ms before today's midnight, by ALICE herself.
    clock = Date.UTC(2026, 9, 31, 16, 59, 59, 999);
    await q.recordOpeningFloat(ALICE, { amountText: "100" });
    await added(ALICE, { itemText: "Yesterday", amountText: "33333" });
    clock = Date.UTC(2026, 9, 31, 17, 0, 0, 0); // 00:00 today in Bangkok
    await opened();
    await added(ALICE, { itemText: "Mine 0" });
    for (let i = 1; i <= 6; i++) {
      clock = MORNING + i * MIN;
      await added(ALICE, { itemText: `Mine ${i}` });
      await added(BOB, { itemText: `Bob ${i}`, amountText: "77777" });
    }
    clock = MORNING + 3 * 60 * MIN; // three hours later, still today
    await added(ALICE, { itemText: "Latest" });
    const page = await q.staffPage(ALICE);
    expect(page.hasOpeningFloat).toBe(true);
    expect(page.sales.map((s) => s.itemText)).toEqual([
      "Latest",
      "Mine 6",
      "Mine 5",
      "Mine 4",
      "Mine 3",
      "Mine 2",
      "Mine 1",
      "Mine 0",
    ]);
    // Cancel is offered only on the entry under 10 minutes old.
    expect(page.sales.map((s) => s.canCancel)).toEqual([true, ...Array(7).fill(false)]);
    expect(Object.keys(page).sort()).toEqual(["hasOpeningFloat", "sales"]);
    for (const s of page.sales)
      expect(Object.keys(s).sort()).toEqual(
        ["amountSatang", "canCancel", "cancelled", "id", "itemText", "payment", "time"].sort(),
      );
    const text = JSON.stringify(page);
    expect(text).not.toMatch(
      /Yesterday|3333300|Bob|77777|7777700|usr_|Satang"?:\s*\d{7,}|total|count|sum|cash"?:\s*\d/i,
    );
    // Bob sees only his own.
    expect((await q.staffPage(BOB)).sales.map((s) => s.itemText)).toEqual(
      [6, 5, 4, 3, 2, 1].map((i) => `Bob ${i}`),
    );
  });

  it("cancelled own entries stay listed, marked cancelled, without Cancel", async () => {
    await opened();
    const s = await added(ALICE);
    await q.cancelOwnSale(ALICE, s.id);
    expect((await q.staffPage(ALICE)).sales).toEqual([
      expect.objectContaining({ id: s.id, cancelled: true, canCancel: false }),
    ]);
  });

  it("Cancel is refused on the server for an old own entry that is still listed today", async () => {
    await opened();
    const old = await added(ALICE);
    clock = MORNING + 2 * 60 * MIN;
    const listed = (await q.staffPage(ALICE)).sales;
    expect(listed).toEqual([expect.objectContaining({ id: old.id, canCancel: false })]);
    expect(await q.cancelOwnSale(ALICE, old.id)).toEqual({
      ok: false,
      error: QUICK_SALE_ERRORS.cannotCancel,
    });
    expect(await quickSaleModel(conn).findById(old.id).lean()).toMatchObject({ cancelled: false });
  });

  it("without today's opening change the page says so", async () => {
    expect(await q.staffPage(ALICE)).toEqual({ hasOpeningFloat: false, sales: [] });
  });
});

describe("the day for the owner and the API", () => {
  it("totals exclude cancelled sales; expected cash = opening + Cash; sales oldest first", async () => {
    await userModel(conn).collection.insertMany([
      {
        _id: ALICE.id,
        email: "a@x.invalid",
        name: "Alice",
        role: "staff",
        passwordHash: "x",
        active: true,
      },
      {
        _id: BOB.id,
        email: "b@x.invalid",
        name: "Bob",
        role: "staff",
        passwordHash: "x",
        active: true,
      },
    ] as never[]);
    await opened("500.25");
    const a = await added(ALICE, { itemText: "A", amountText: "100.50", payment: "cash" });
    clock += 1000;
    await added(BOB, { itemText: "B", amountText: "200", payment: "qr" });
    clock += 1000;
    const c = await added(ALICE, { itemText: "C", amountText: "999", payment: "cash" });
    await q.cancelOwnSale(ALICE, c.id);
    expect(await q.daySummary("2026-11-01")).toEqual({
      date: "2026-11-01",
      openingFloatSatang: 50025,
      totalSatang: 30050,
      cashSatang: 10050,
      qrSatang: 20000,
      count: 2,
      cancelledCount: 1,
      sales: [
        { time: "10:00", itemText: "A", amountSatang: 10050, payment: "cash" },
        { time: "10:00", itemText: "B", amountSatang: 20000, payment: "qr" },
      ],
    });
    const day = await q.ownerDay("2026-11-01");
    expect(day.expectedCashSatang).toBe(50025 + 10050);
    expect(day.sales.map((s) => [s.itemText, s.staffName, s.cancelled])).toEqual([
      ["A", "Alice", false],
      ["B", "Bob", false],
      ["C", "Alice", true],
    ]);
    expect(day.sales[0]?.id).toBe(a.id);
  });

  it("an empty day: opening not recorded (null), zero totals", async () => {
    expect(await q.ownerDay("2026-10-01")).toEqual({
      date: "2026-10-01",
      openingFloatSatang: null,
      totalSatang: 0,
      cashSatang: 0,
      qrSatang: 0,
      count: 0,
      cancelledCount: 0,
      expectedCashSatang: 0,
      sales: [],
    });
  });
});
