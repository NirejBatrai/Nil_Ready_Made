// @vitest-environment node
/**
 * INTERIM Quick Sales server functions (src/lib/quick-sales.ts, decision 0004) and the staff
 * role's refusals everywhere else, run through TanStack Start's real server-side middleware chain
 * (`safeErrors` → `requirePermission` / `requireOwner` → validator → handler), against an
 * ISOLATED, throwaway MongoDB (mongodb-memory-server on 127.0.0.1). Never reads MONGODB_URI or
 * .env and never touches Atlas.
 *
 * The harness is the one in products-server-fns.test.ts: only the session cookie value
 * (`getCookie`) and `database.withDatabase` are replaced. Sessions, users and data are real.
 */
import { readFileSync } from "node:fs";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthService, ensureAuthIndexes } from "@/server/auth/auth.server";
import { connectOptions } from "@/server/db.server";
import { openingFloatModel, quickSaleModel } from "@/server/models/quick-sale.server";
import { ensureProductIndexes, productModel } from "@/server/models/product.server";
import { userModel } from "@/server/models/user.server";
import { createProductService } from "@/server/products.server";
import {
  archiveProductForOwner,
  createProductForOwner,
  getProductForEditing,
  getProductForOwner,
  listProductsForOwner,
  restoreProductForOwner,
  updateProductForOwner,
} from "@/lib/products";
import {
  addQuickSale,
  cancelQuickSale,
  getDayForOwner,
  getQuickSalesPage,
  ownerCancelQuickSale,
  recordOpeningFloat,
  removeQuickSaleEntry,
  restoreQuickSaleEntry,
} from "@/lib/quick-sales";
import { bangkokDay } from "@/lib/bangkok-time";

const state = vi.hoisted<{ conn: Connection | null; token: string | undefined; down: boolean }>(
  () => ({ conn: null, token: undefined, down: false }),
);

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  const compiledLike = <T extends object>(builder: T): T =>
    new Proxy(builder, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (prop === "handler") return (fn: unknown) => Reflect.apply(value, target, [fn, fn]);
        if (prop === "middleware" || prop === "inputValidator")
          return (arg: unknown) => {
            const next: unknown = Reflect.apply(value, target, [arg]);
            return typeof next === "function" ? compiledLike(next) : next;
          };
        return value;
      },
    });
  return {
    ...actual,
    createServerFn: (...args: Parameters<typeof actual.createServerFn>) =>
      compiledLike(actual.createServerFn(...args)),
  };
});

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => state.token,
  setCookie: () => undefined,
  deleteCookie: () => undefined,
  getRequestHeader: () => undefined,
  getRequestIP: () => undefined,
}));

vi.mock("@/server/db.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db.server")>();
  return {
    ...actual,
    database: {
      withDatabase: <T>(fn: (conn: Connection) => Promise<T>): Promise<T> => {
        if (state.down || !state.conn)
          return Promise.reject(new actual.DatabaseUnavailableError("unavailable"));
        return fn(state.conn);
      },
    },
  };
});

const PASSWORD = "correct-horse-battery-1"; // test-only value for a throwaway database

let server: MongoMemoryServer;
let conn: Connection;

/** Runs a server function on the "server" side, the way a real `/_serverFn` request does. */
async function call(fn: unknown, data: unknown): Promise<{ result: unknown; error: unknown }> {
  if (typeof fn !== "function" || !("__executeServer" in fn)) throw new Error("not a server fn");
  const execute: unknown = fn.__executeServer;
  if (typeof execute !== "function") throw new Error("not a server fn");
  const out: unknown = await runWithStartContext(
    {
      getRouter: () => {
        throw new Error("no router in unit tests");
      },
      request: new Request("http://127.0.0.1/_serverFn/test", { method: "POST" }),
      startOptions: {},
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: "serverFn",
    },
    () => Reflect.apply(execute, fn, [{ data, context: {} }]),
  );
  if (typeof out !== "object" || out === null) throw new Error("no server fn result");
  return {
    result: "result" in out ? out.result : undefined,
    error: "error" in out ? out.error : undefined,
  };
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const tokens = { owner: "", som: "", noi: "" };
const ids = { owner: "", som: "", noi: "" };

async function account(kind: "owner" | "som" | "noi") {
  const auth = createAuthService(conn);
  const email = `${kind}@example.invalid`;
  const made =
    kind === "owner"
      ? await auth.createFirstOwner({ email, name: "Fn Owner", password: PASSWORD })
      : await auth.createStaff({ email, name: kind === "som" ? "Som" : "Noi", password: PASSWORD });
  if (!made.ok) throw new Error(made.error);
  const login = await auth.login({ email, password: PASSWORD }, undefined);
  if (!login.ok) throw new Error(login.error);
  tokens[kind] = login.token;
  ids[kind] = login.user.id;
}

/** Calls as `who` and fails the test if the call was refused. */
async function as(who: keyof typeof tokens, fn: unknown, data?: unknown): Promise<unknown> {
  state.token = tokens[who];
  const { result, error } = await call(fn, data);
  if (error !== undefined) throw new Error(`${who}: ${errorMessage(error)}`);
  return result;
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  // Safety: only ever a local, credential-free test database.
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_quick_sales_fns_test" });
  await ensureAuthIndexes(conn);
  await ensureProductIndexes(conn);
  state.conn = conn;
  await account("owner");
  await account("som");
  await account("noi");
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await openingFloatModel(conn).collection.deleteMany({});
  await quickSaleModel(conn).collection.deleteMany({});
  await productModel(conn).collection.deleteMany({});
  await userModel(conn).updateMany({}, { $set: { active: true } });
  state.token = undefined;
  state.down = false;
});

describe("staff are refused on the server everywhere except their four Quick Sales actions", () => {
  it("every product function and the owner day view: 'Not allowed.', nothing returned or changed", async () => {
    const made = await createProductService(conn).createProduct({
      name: "Towel",
      sku: "LX-QS-1",
      category: "accessories",
      priceSatang: 50000,
      minimumSellingPriceSatang: 35000,
      costSatang: 20000,
      lowStockThreshold: 1,
      variants: [{ sku: "LX-QS-1" }],
    });
    if (!made.ok) throw new Error(made.error);
    const id = made.data.id;
    const cases = [
      ["getProductForOwner", getProductForOwner, id],
      ["listProductsForOwner", listProductsForOwner, { includeArchived: true }],
      ["createProductForOwner", createProductForOwner, { name: "X", sku: "LX-QS-2" }],
      ["getProductForEditing", getProductForEditing, id],
      ["updateProductForOwner", updateProductForOwner, { id, update: { name: "Hacked" } }],
      ["archiveProductForOwner", archiveProductForOwner, id],
      ["restoreProductForOwner", restoreProductForOwner, id],
      ["getDayForOwner", getDayForOwner, null],
    ] as const;
    for (const staff of ["som", "noi"] as const) {
      state.token = tokens[staff];
      for (const [name, fn, data] of cases) {
        const { result, error } = await call(fn, data);
        expect(errorMessage(error), `${staff} ${name}`).toBe("Not allowed.");
        expect(result, `${staff} ${name}`).toBeUndefined();
        expect(error instanceof Error && Object.hasOwn(error, "stack"), name).toBe(false);
      }
    }
    expect(await productModel(conn).countDocuments()).toBe(1);
    expect(await productModel(conn).findById(id).lean()).toMatchObject({
      name: "Towel",
      active: true,
    });
    // The owner still has them all.
    state.token = tokens.owner;
    for (const [name, fn, data] of cases.filter(([n]) => n !== "createProductForOwner"))
      expect((await call(fn, data)).error, name).toBeUndefined();
  });

  it("signed out, a forged token or an inactive staff account: 'Not signed in.' everywhere", async () => {
    const fns = [
      [getQuickSalesPage, undefined],
      [recordOpeningFloat, { amountText: "500" }],
      [addQuickSale, { itemText: "A", amountText: "1", payment: "cash" }],
      [cancelQuickSale, "qs_x"],
      [getDayForOwner, null],
      [ownerCancelQuickSale, { saleId: "qs_x", reason: "x" }],
      [removeQuickSaleEntry, { kind: "sale", id: "qs_x", reason: "x" }],
      [restoreQuickSaleEntry, { kind: "sale", id: "qs_x" }],
    ] as const;
    for (const token of [undefined, "A".repeat(43), "inactive"] as const) {
      if (token === "inactive") {
        await userModel(conn).updateOne({ _id: ids.som }, { $set: { active: false } });
        state.token = tokens.som;
      } else state.token = token;
      for (const [fn, data] of fns)
        expect(errorMessage((await call(fn, data)).error), String(token)).toBe("Not signed in.");
    }
    expect(await openingFloatModel(conn).countDocuments()).toBe(0);
    expect(await quickSaleModel(conn).countDocuments()).toBe(0);
  });

  it("every Quick Sales server function runs safeErrors, then requirePermission (source check)", () => {
    const source = readFileSync("src/lib/quick-sales.ts", "utf8");
    const fns = source.match(/createServerFn\(/g) ?? [];
    const guarded =
      source.match(
        /\.middleware\(\[safeErrors, requirePermission\("quickSales\.[A-Za-z]+"\)\]\)/g,
      ) ?? [];
    expect(fns.length).toBe(8);
    expect(guarded.length).toBe(fns.length);
    expect(source).toContain('requirePermission("quickSales.viewDay")');
    // The owner actions use the owner-only permissions.
    for (const [fn, permission] of [
      ["ownerCancelQuickSale", "quickSales.cancelAny"],
      ["removeQuickSaleEntry", "quickSales.remove"],
      ["restoreQuickSaleEntry", "quickSales.remove"],
    ] as const)
      expect(source).toMatch(
        new RegExp(
          `export const ${fn} = createServerFn\\(\\{ method: "POST" \\}\\)\\s*\\.middleware\\(\\[safeErrors, requirePermission\\("${permission.replace(".", "\\.")}"\\)\\]\\)`,
        ),
      );
  });
});

describe("the staff flow through the real middleware", () => {
  it("opening change once a day, then add, list and cancel their own sale", async () => {
    expect(await as("som", getQuickSalesPage)).toEqual({ hasOpeningFloat: false, sales: [] });
    expect(await as("som", recordOpeningFloat, { amountText: "1,000" })).toEqual({ ok: true });
    expect(await as("noi", recordOpeningFloat, { amountText: "5" })).toEqual({
      ok: false,
      error: "Today's change money is already recorded.",
    });
    const added = await as("som", addQuickSale, {
      itemText: "Scarf",
      amountText: "1800.5",
      payment: "qr",
    });
    expect(added).toMatchObject({ ok: true, sale: { itemText: "Scarf", amountSatang: 180050 } });
    const page = await as("som", getQuickSalesPage);
    expect(page).toMatchObject({ hasOpeningFloat: true, sales: [{ itemText: "Scarf" }] });
    const saleId = (page as { sales: { id: string }[] }).sales[0]?.id;
    expect(await as("som", cancelQuickSale, saleId)).toEqual({ ok: true });
    expect(await quickSaleModel(conn).findById(saleId).lean()).toMatchObject({
      cancelled: true,
      userId: ids.som,
      businessDay: bangkokDay(new Date()),
    });
  });

  it("the user always comes from the session: a client-sent userId or date is refused", async () => {
    await as("som", recordOpeningFloat, { amountText: "100" });
    for (const extra of [{ userId: ids.noi }, { businessDay: "2026-01-01" }, { createdAt: 0 }])
      expect(
        await as("som", addQuickSale, {
          itemText: "A",
          amountText: "1",
          payment: "cash",
          ...extra,
        }),
      ).toMatchObject({ ok: false });
    expect(await quickSaleModel(conn).countDocuments()).toBe(0);
  });

  it("cancelling someone else's sale is refused and leaves it unchanged", async () => {
    await as("som", recordOpeningFloat, { amountText: "100" });
    const r = (await as("noi", addQuickSale, {
      itemText: "Noi's sale",
      amountText: "50",
      payment: "cash",
    })) as { sale: { id: string } };
    expect(await as("som", cancelQuickSale, r.sale.id)).toEqual({
      ok: false,
      error: "This sale can no longer be cancelled.",
    });
    expect(await quickSaleModel(conn).findById(r.sale.id).lean()).toMatchObject({
      cancelled: false,
    });
  });
});

describe("owner actions through the real middleware (owner only, role re-read every call)", () => {
  const today = () => bangkokDay(new Date());
  async function setup() {
    await as("som", recordOpeningFloat, { amountText: "100" });
    const mine = (await as("som", addQuickSale, {
      itemText: "Som's sale",
      amountText: "10",
      payment: "cash",
    })) as { sale: { id: string } };
    const theirs = (await as("noi", addQuickSale, {
      itemText: "Noi's sale",
      amountText: "20",
      payment: "qr",
    })) as { sale: { id: string } };
    return { mine: mine.sale.id, theirs: theirs.sale.id };
  }
  const unchanged = async () => {
    expect(
      await quickSaleModel(conn).countDocuments({
        $or: [{ cancelled: true }, { removed: true }],
      }),
    ).toBe(0);
    expect(await openingFloatModel(conn).findById(today()).lean()).toMatchObject({
      removed: false,
    });
  };

  it("staff cannot owner-cancel, remove or restore anything, not even their own: 'Not allowed.'", async () => {
    const { mine, theirs } = await setup();
    await quickSaleModel(conn).updateOne({ _id: theirs }, { $set: { removed: true } });
    for (const staff of ["som", "noi"] as const) {
      state.token = tokens[staff];
      for (const [name, fn, data] of [
        ["ownerCancel mine", ownerCancelQuickSale, { saleId: mine, reason: "x" }],
        ["ownerCancel theirs", ownerCancelQuickSale, { saleId: theirs, reason: "x" }],
        ["remove sale", removeQuickSaleEntry, { kind: "sale", id: mine, reason: "x" }],
        ["remove opening", removeQuickSaleEntry, { kind: "opening", id: today(), reason: "x" }],
        ["restore sale", restoreQuickSaleEntry, { kind: "sale", id: theirs }],
        ["restore opening", restoreQuickSaleEntry, { kind: "opening", id: today() }],
      ] as const) {
        const { result, error } = await call(fn, data);
        expect(errorMessage(error), `${staff} ${name}`).toBe("Not allowed.");
        expect(result, `${staff} ${name}`).toBeUndefined();
      }
    }
    await quickSaleModel(conn).updateOne({ _id: theirs }, { $set: { removed: false } });
    await unchanged();
  });

  it("staff still cannot cancel someone else's sale or an own sale older than 10 minutes", async () => {
    const { mine, theirs } = await setup();
    expect(await as("som", cancelQuickSale, theirs)).toMatchObject({ ok: false });
    await quickSaleModel(conn).updateOne(
      { _id: mine },
      { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } },
    );
    expect(await as("som", cancelQuickSale, mine)).toMatchObject({ ok: false });
    await unchanged();
  });

  it("the role is re-read from the database: an owner demoted to staff is refused at once", async () => {
    const { theirs } = await setup();
    await userModel(conn).updateOne({ _id: ids.owner }, { $set: { role: "staff" } });
    try {
      state.token = tokens.owner;
      for (const [fn, data] of [
        [ownerCancelQuickSale, { saleId: theirs, reason: "x" }],
        [removeQuickSaleEntry, { kind: "sale", id: theirs, reason: "x" }],
        [restoreQuickSaleEntry, { kind: "sale", id: theirs }],
      ] as const)
        expect(errorMessage((await call(fn, data)).error)).toBe("Not allowed.");
      await unchanged();
    } finally {
      await userModel(conn).updateOne({ _id: ids.owner }, { $set: { role: "owner" } });
    }
  });

  it("the owner cancels any staff member's sale and removes/restores sales and the opening change", async () => {
    const { mine, theirs } = await setup();
    expect(await as("owner", ownerCancelQuickSale, { saleId: theirs, reason: "Returned" })).toEqual(
      { ok: true },
    );
    expect(await as("owner", ownerCancelQuickSale, { saleId: mine, reason: "" })).toEqual({
      ok: false,
      error: "Enter a reason (1–200 characters, no line breaks).",
    });
    expect(
      await as("owner", removeQuickSaleEntry, { kind: "sale", id: mine, reason: "Duplicate" }),
    ).toEqual({ ok: true });
    expect(
      await as("owner", removeQuickSaleEntry, { kind: "opening", id: today(), reason: "Wrong" }),
    ).toEqual({ ok: true });
    expect(await quickSaleModel(conn).findById(theirs).lean()).toMatchObject({
      cancelled: true,
      cancelledBy: ids.owner,
      cancelReason: "Returned",
    });
    expect(await quickSaleModel(conn).findById(mine).lean()).toMatchObject({
      removed: true,
      removedBy: ids.owner,
      removeReason: "Duplicate",
    });
    const day = (await as("owner", getDayForOwner, null)) as {
      sales: { cancelledByName: string | null }[];
      removed: { sales: { removedByName: string }[]; openingFloats: unknown[] };
      openingFloatSatang: number | null;
    };
    expect(day.openingFloatSatang).toBeNull();
    expect(day.sales).toEqual([expect.objectContaining({ cancelledByName: "Fn Owner" })]);
    expect(day.removed.sales).toEqual([expect.objectContaining({ removedByName: "Fn Owner" })]);
    expect(day.removed.openingFloats).toHaveLength(1);
    // Staff see neither the removed sale nor an opening change; they may record a new one.
    expect(await as("som", getQuickSalesPage)).toEqual({ hasOpeningFloat: false, sales: [] });
    expect(await as("noi", recordOpeningFloat, { amountText: "300" })).toEqual({ ok: true });
    expect(await as("owner", restoreQuickSaleEntry, { kind: "sale", id: mine })).toEqual({
      ok: true,
    });
    expect(await as("som", getQuickSalesPage)).toMatchObject({
      hasOpeningFloat: true,
      sales: [{ id: mine }],
    });
    // Never deleted.
    expect(await quickSaleModel(conn).countDocuments()).toBe(2);
    expect(await openingFloatModel(conn).countDocuments()).toBe(1);
  });
});

describe("leak tests: staff responses never contain totals or other people's sales", () => {
  it("no totals, names, ids, emails or other users' entries in any staff response", async () => {
    const responses: unknown[] = [];
    const keep = async (who: "som" | "noi", fn: unknown, data?: unknown) => {
      const r = await as(who, fn, data);
      responses.push(r);
      return r;
    };
    await keep("som", recordOpeningFloat, { amountText: "4321.09" });
    // Other people's sales, with distinctive values.
    await as("noi", addQuickSale, {
      itemText: "NOI-SECRET",
      amountText: "98765.43",
      payment: "qr",
    });
    state.token = tokens.owner;
    await call(addQuickSale, { itemText: "OWNER-SECRET", amountText: "55555", payment: "cash" });
    await keep("som", addQuickSale, { itemText: "Mine", amountText: "12.34", payment: "cash" });
    const page = (await keep("som", getQuickSalesPage)) as { sales: { id: string }[] };
    await keep("som", cancelQuickSale, page.sales[0]?.id);
    await keep("som", getQuickSalesPage);
    // Refusals carry nothing either.
    state.token = tokens.som;
    responses.push((await call(getDayForOwner, null)).error);

    const text = JSON.stringify(responses);
    for (const forbidden of [
      "NOI-SECRET",
      "OWNER-SECRET",
      "9876543",
      "5555500",
      "432109", // the opening change money
      "totalSatang",
      "cashSatang",
      "qrSatang",
      "openingFloatSatang",
      "expectedCashSatang",
      "cancelledCount",
      '"count"',
      "staffName",
      "userId",
      "usr_",
      "Noi",
      "Fn Owner",
      "@example.invalid",
      "businessDay",
    ])
      expect(text, forbidden).not.toContain(forbidden);
    expect(text).toContain("Mine");
  });

  it("the owner's day view does contain all of it (control)", async () => {
    await as("som", recordOpeningFloat, { amountText: "100" });
    await as("noi", addQuickSale, { itemText: "N", amountText: "10", payment: "qr" });
    await as("som", addQuickSale, { itemText: "S", amountText: "20", payment: "cash" });
    const day = await as("owner", getDayForOwner, "not-a-date");
    expect(day).toMatchObject({
      date: bangkokDay(new Date()),
      openingFloatSatang: 10000,
      totalSatang: 3000,
      cashSatang: 2000,
      qrSatang: 1000,
      count: 2,
      cancelledCount: 0,
      expectedCashSatang: 12000,
    });
    expect(JSON.stringify(day)).toMatch(/"staffName":"Noi".*"staffName":"Som"/);
    expect(await as("owner", getDayForOwner, "2020-01-01")).toMatchObject({
      date: "2020-01-01",
      count: 0,
    });
  });
});
