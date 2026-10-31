// @vitest-environment node
/**
 * Product server functions (src/lib/products.ts) run through TanStack Start's real server-side
 * middleware chain (`safeErrors` → `requireOwner` → input validator → handler), against an
 * ISOLATED, throwaway MongoDB (mongodb-memory-server on 127.0.0.1). Never reads MONGODB_URI or
 * .env and never touches Atlas.
 *
 * Only two seams are replaced: the session cookie value (`getCookie`) and `database.withDatabase`
 * (which hands over the test connection). Sessions, users and products are real.
 *
 * Without the Start compiler, `.handler(fn)` would treat `fn` as the client stub; the wrapper
 * below passes it as both stub and server implementation, as the compiler does for the server
 * bundle, so `__executeServer` runs the real middleware.
 */
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthService, ensureAuthIndexes } from "@/server/auth/auth.server";
import { connectOptions, DatabaseUnavailableError } from "@/server/db.server";
import { userModel } from "@/server/models/user.server";
import { ensureProductIndexes, productModel } from "@/server/models/product.server";
import { createProductService } from "@/server/products.server";
import {
  archiveProductForOwner,
  getProductForEditing,
  listProductsForOwner,
  restoreProductForOwner,
  updateProductForOwner,
} from "@/lib/products";

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
const EMAIL = "owner@example.invalid";

let server: MongoMemoryServer;
let conn: Connection;
let ownerToken: string;

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

const towel = (over: Record<string, unknown> = {}) => ({
  name: "Test Towel",
  sku: "LX-FN-1",
  category: "accessories",
  price: 500,
  minimumSellingPrice: 350,
  cost: 200,
  lowStockThreshold: 2,
  variants: [{ sku: "LX-FN-1" }],
  ...over,
});

async function created(over: Record<string, unknown> = {}) {
  const r = await createProductService(conn).createProduct(towel(over));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const stored = (id: string) => productModel(conn).findById(id).select("+cost").lean();

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  // Safety: only ever a local, credential-free test database.
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_product_fns_test" });
  await ensureAuthIndexes(conn);
  await ensureProductIndexes(conn);
  const auth = createAuthService(conn);
  const owner = await auth.createFirstOwner({ email: EMAIL, name: "Fn Owner", password: PASSWORD });
  if (!owner.ok) throw new Error(owner.error);
  const login = await auth.login({ email: EMAIL, password: PASSWORD }, "203.0.113.7");
  if (!login.ok) throw new Error(login.error);
  ownerToken = login.token;
  state.conn = conn;
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await productModel(conn).collection.deleteMany({});
  await userModel(conn).updateOne({ email: EMAIL }, { $set: { active: true } });
  state.token = ownerToken;
  state.down = false;
});

describe("owner-only: every product server function refuses without a valid owner session", () => {
  const cases = (id: string) =>
    [
      ["listProductsForOwner", listProductsForOwner, { includeArchived: true }],
      ["getProductForEditing", getProductForEditing, id],
      ["updateProductForOwner", updateProductForOwner, { id, update: { name: "Hacked" } }],
      ["archiveProductForOwner", archiveProductForOwner, id],
      ["restoreProductForOwner", restoreProductForOwner, id],
    ] as const;

  it("no cookie, a forged token, or an inactive owner: 'Not signed in.', nothing changed", async () => {
    const p = await created();
    for (const [token, deactivate] of [
      [undefined, false],
      ["A".repeat(43), false],
      [ownerToken, true],
    ] as const) {
      state.token = token;
      if (deactivate)
        await userModel(conn).updateOne({ email: EMAIL }, { $set: { active: false } });
      for (const [name, fn, data] of cases(p.id)) {
        const { result, error } = await call(fn, data);
        expect(errorMessage(error), name).toBe("Not signed in.");
        expect(result, name).toBeUndefined();
        // safeErrors: the refusal carries no stack trace to the browser.
        expect(error instanceof Error && Object.hasOwn(error, "stack"), name).toBe(false);
      }
    }
    expect(await stored(p.id)).toMatchObject({ name: "Test Towel", active: true });
  });

  it("a signed-out session (after logout) is refused too", async () => {
    const p = await created();
    const auth = createAuthService(conn);
    const login = await auth.login({ email: EMAIL, password: PASSWORD }, "203.0.113.8");
    if (!login.ok) throw new Error(login.error);
    await auth.logout(login.token);
    state.token = login.token;
    const { error } = await call(archiveProductForOwner, p.id);
    expect(errorMessage(error)).toBe("Not signed in.");
    expect((await stored(p.id))?.active).toBe(true);
  });

  it("a database outage becomes the generic 'Database unavailable.'", async () => {
    state.down = true;
    const { error } = await call(updateProductForOwner, { id: "prd_x", update: {} });
    expect(errorMessage(error)).toBe("Database unavailable.");
    expect(new DatabaseUnavailableError("unavailable").message).not.toMatch(/mongodb/);
  });
});

describe("getProductForEditing", () => {
  it("returns the product without cost; unknown or malformed ids give null", async () => {
    const p = await created();
    const { result } = await call(getProductForEditing, p.id);
    expect(result).toMatchObject({ id: p.id, name: "Test Towel", price: 500 });
    expect(JSON.stringify(result)).not.toContain('"cost"');
    for (const id of ["prd_missing", "nope", { $ne: null }, 42])
      expect((await call(getProductForEditing, id)).result).toBeNull();
  });
});

describe("updateProductForOwner: the server re-validates everything", () => {
  it("saves allowed fields (whole baht) and never returns cost", async () => {
    const p = await created();
    const { result, error } = await call(updateProductForOwner, {
      id: p.id,
      update: {
        name: " Linen Towel ",
        category: "bags",
        description: "Soft",
        price: 650,
        minimumSellingPrice: 400,
        cost: 250,
        lowStockThreshold: 5,
      },
    });
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ ok: true, data: { name: "Linen Towel", price: 650 } });
    expect(JSON.stringify(result)).not.toContain('"cost"');
    expect(await stored(p.id)).toMatchObject({
      name: "Linen Towel",
      category: "bags",
      price: 650,
      minimumSellingPrice: 400,
      cost: 250,
      lowStockThreshold: 5,
    });
  });

  it("an omitted cost keeps the stored one; null removes it", async () => {
    const p = await created();
    await call(updateProductForOwner, { id: p.id, update: { name: "Kept" } });
    expect((await stored(p.id))?.cost).toBe(200);
    await call(updateProductForOwner, { id: p.id, update: { cost: null } });
    expect((await stored(p.id))?.cost).toBeUndefined();
  });

  it.each([
    [{ price: 300 }, "Minimum selling price cannot be higher than the selling price."],
    [{ price: 12.5 }, "Selling price must be a whole number of baht greater than zero."],
    [{ price: Number.NaN }, "price: Expected number, received nan"], // an empty form field
    [
      { minimumSellingPrice: -1 },
      "Minimum selling price must be a whole number of baht, 0 or more.",
    ],
    [{ cost: 1.5 }, "Cost must be a whole number of baht, 0 or more."],
    [{ name: "   " }, /^name: /],
    [{ category: "weapons" }, "category: Unknown category."],
    [{ lowStockThreshold: -2 }, /^lowStockThreshold: /],
  ])("rejects %o and saves nothing", async (update, message) => {
    const p = await created();
    const before = await stored(p.id);
    const { result } = await call(updateProductForOwner, { id: p.id, update });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expect(await stored(p.id)).toEqual(before);
  });

  it("server-controlled fields (SKU, stock, variants, active, id) are rejected", async () => {
    const p = await created();
    const before = await stored(p.id);
    for (const update of [
      { sku: "LX-OTHER" },
      { stock: 99 },
      { variants: [{ sku: "LX-FN-1", stock: 99 }] },
      { active: false },
      { id: "prd_other" },
      { _id: "prd_other" },
    ]) {
      const { result } = await call(updateProductForOwner, { id: p.id, update });
      expect(result, JSON.stringify(update)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/Unrecognized key/),
      });
    }
    expect(await stored(p.id)).toEqual(before);
  });

  it("malformed requests are refused without throwing", async () => {
    for (const data of [null, "prd_x", {}, { id: { $ne: null }, update: {} }, { update: {} }]) {
      const { result, error } = await call(updateProductForOwner, data);
      expect(error).toBeUndefined();
      expect(result).toMatchObject({ ok: false });
    }
  });

  it("simultaneous edits: overlapping saves are refused with the reload message, never merged", async () => {
    const p = await created();
    const results = await Promise.all(
      [600, 700, 800, 900, 1000].map(async (price) => {
        const { result } = await call(updateProductForOwner, { id: p.id, update: { price } });
        return result;
      }),
    );
    const ok = results.filter((r) => typeof r === "object" && r !== null && "ok" in r && r.ok);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of results)
      if (!ok.includes(r))
        expect(r).toEqual({
          ok: false,
          error: "This product was changed at the same time. Reload it and try again.",
        });
    const final = await stored(p.id);
    expect([600, 700, 800, 900, 1000]).toContain(final?.price);
  });
});

describe("archive and restore (no delete)", () => {
  it("archiving hides the product from the default list but keeps it; restore brings it back", async () => {
    const towelP = await created();
    const hat = await created({ name: "Sun Hat", sku: "LX-FN-2", variants: [{ sku: "LX-FN-2" }] });
    const names = async (data: unknown) => {
      const { result } = await call(listProductsForOwner, data);
      return Array.isArray(result) ? result.map((p: { name: string }) => p.name) : result;
    };

    const archived = await call(archiveProductForOwner, hat.id);
    expect(archived.result).toMatchObject({ ok: true, data: { id: hat.id, active: false } });
    expect(JSON.stringify(archived.result)).not.toContain('"cost"');
    expect(await names({})).toEqual([towelP.name]);
    // Anything other than exactly { includeArchived: true } means active only.
    for (const data of [undefined, null, { includeArchived: "true" }, { includeArchived: 1 }])
      expect(await names(data)).toEqual([towelP.name]);
    expect(await names({ includeArchived: true })).toEqual(["Sun Hat", "Test Towel"]);
    expect(await productModel(conn).countDocuments()).toBe(2);
    expect((await stored(hat.id))?.cost).toBe(200);

    const restored = await call(restoreProductForOwner, hat.id);
    expect(restored.result).toMatchObject({ ok: true, data: { active: true } });
    expect(await names({})).toEqual(["Sun Hat", "Test Towel"]);
  });

  it("unknown or malformed ids are 'Product not found.'", async () => {
    for (const fn of [archiveProductForOwner, restoreProductForOwner])
      for (const id of ["prd_missing", { $ne: null }, null, ["prd_x"]])
        expect((await call(fn, id)).result).toEqual({ ok: false, error: "Product not found." });
  });

  it("there is no delete server function", async () => {
    const exported = Object.keys(await import("@/lib/products"));
    expect(exported.filter((k) => /delete|remove|destroy/i.test(k))).toEqual([]);
  });
});
