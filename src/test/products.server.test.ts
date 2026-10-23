// @vitest-environment node
/**
 * Product model + service tests against an ISOLATED, throwaway MongoDB (mongodb-memory-server)
 * on 127.0.0.1. These tests never read MONGODB_URI or .env and never touch Atlas.
 */
import { readdirSync, readFileSync } from "node:fs";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectOptions, DatabaseUnavailableError } from "@/server/db.server";
import {
  ensureProductIndexes,
  productModel,
  verifyProductIndexes,
} from "@/server/models/product.server";
import { createProductService, SETUP_INCOMPLETE } from "@/server/products.server";

let server: MongoMemoryServer;
let conn: Connection;
let products: ReturnType<typeof createProductService>;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  // Safety: only ever a local, credential-free test database.
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_products_test" });
  await ensureProductIndexes(conn);
  products = createProductService(conn);
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await productModel(conn).collection.deleteMany({});
});

/** Spec example: normal ฿500, minimum ฿350, cost ฿200. */
const towel = (over: Record<string, unknown> = {}) => ({
  name: "Test Towel",
  sku: "LX-TST-1",
  category: "accessories" as const,
  price: 500,
  minimumSellingPrice: 350,
  cost: 200,
  lowStockThreshold: 2,
  variants: [{ sku: "LX-TST-1" }],
  ...over,
});

async function created(over: Record<string, unknown> = {}) {
  const r = await products.createProduct(towel(over));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe("create: per-product pricing rule enforced on the server", () => {
  it("creates a valid product, generates ids, and every variant starts with stock 0", async () => {
    const p = await created({ variants: [{ sku: "LX-TST-1" }, { sku: "LX-TST-2", size: "M" }] });
    expect(p.id).toMatch(/^prd_[0-9a-f-]{36}$/);
    expect(p).toMatchObject({ price: 500, minimumSellingPrice: 350, active: true });
    expect(p.variants).toEqual([
      expect.objectContaining({ productId: p.id, sku: "LX-TST-1", openingStock: 0, stock: 0 }),
      expect.objectContaining({ productId: p.id, sku: "LX-TST-2", openingStock: 0, stock: 0 }),
    ]);
    expect(p.variants[0]?.id).toMatch(/^var_/);
  });

  it("there is no universal ฿350 minimum: cheap products with their own minimum are valid", async () => {
    const pouch = await created({
      sku: "LX-OTH-1",
      price: 190,
      minimumSellingPrice: 150,
      variants: [{ sku: "LX-OTH-1" }],
    });
    expect(pouch.minimumSellingPrice).toBe(150);
    const fixed = await created({
      sku: "LX-OTH-2",
      price: 250,
      minimumSellingPrice: 250,
      variants: [{ sku: "LX-OTH-2" }],
    });
    expect(fixed.minimumSellingPrice).toBe(250);
    const noFloor = await created({
      sku: "LX-OTH-3",
      price: 99,
      minimumSellingPrice: 0,
      variants: [{ sku: "LX-OTH-3" }],
    });
    expect(noFloor.minimumSellingPrice).toBe(0);
  });

  it.each([
    [
      { minimumSellingPrice: 501 },
      "Minimum selling price cannot be higher than the selling price.",
    ],
    [{ price: 0 }, "Selling price must be a whole number of baht greater than zero."],
    [{ price: -5 }, "Selling price must be a whole number of baht greater than zero."],
    [{ price: 499.99 }, "Selling price must be a whole number of baht greater than zero."],
    [
      { price: Number.POSITIVE_INFINITY },
      "Selling price must be a whole number of baht greater than zero.",
    ],
    [
      { minimumSellingPrice: -1 },
      "Minimum selling price must be a whole number of baht, 0 or more.",
    ],
    [
      { minimumSellingPrice: 349.5 },
      "Minimum selling price must be a whole number of baht, 0 or more.",
    ],
    [{ cost: -1 }, "Cost must be a whole number of baht, 0 or more."],
    [{ cost: 12.5 }, "Cost must be a whole number of baht, 0 or more."],
  ])("rejects %o", async (over, error) => {
    expect(await products.createProduct(towel(over))).toEqual({ ok: false, error });
    expect(await productModel(conn).countDocuments()).toBe(0);
  });

  it("rejects wrong types, unknown fields and client-chosen ids or stock", async () => {
    for (const bad of [
      towel({ price: "500" }),
      towel({ price: Number.NaN }),
      towel({ category: "weapons" }),
      towel({ id: "prd_mine" }),
      towel({ active: false }),
      towel({ variants: [{ sku: "X", openingStock: 1, stock: 999 }] }),
      towel({ variants: [{ sku: "X", openingStock: 5 }] }), // stock can never be supplied
      towel({ variants: [{ sku: "X", stock: 5 }] }),
      towel({ variants: [{ sku: "X", openingStock: -1 }] }),
      towel({ variants: [] }),
      towel({ imageUrl: "javascript:alert(1)" }),
      null,
      "not an object",
    ])
      expect((await products.createProduct(bad)).ok).toBe(false);
    expect(await productModel(conn).countDocuments()).toBe(0);
  });

  it("rejects duplicate product SKUs, duplicate variant SKUs and duplicate barcodes", async () => {
    await created({ variants: [{ sku: "V-1", barcode: "885000" }] });
    const sameSku = await products.createProduct(towel({ variants: [{ sku: "V-2" }] }));
    expect(sameSku).toEqual({
      ok: false,
      error: "That SKU or barcode is already used by another product.",
    });
    const sameVariantSku = await products.createProduct(
      towel({ sku: "LX-NEW", variants: [{ sku: "V-1" }] }),
    );
    expect(sameVariantSku.ok).toBe(false);
    const sameBarcode = await products.createProduct(
      towel({ sku: "LX-NEW", variants: [{ sku: "V-3", barcode: "885000" }] }),
    );
    expect(sameBarcode.ok).toBe(false);
    const dupWithin = await products.createProduct(
      towel({
        sku: "LX-NEW",
        variants: [{ sku: "A" }, { sku: "A" }],
      }),
    );
    expect(dupWithin).toEqual({ ok: false, error: "Variant SKUs must be unique." });
    expect(await productModel(conn).countDocuments()).toBe(1);
  });
});

describe("SKU and barcode normalization (server-side policy)", () => {
  it("SKUs are trimmed and upper-cased before storing", async () => {
    const p = await created({ sku: "  lx-tst-1 ", variants: [{ sku: " lx-tst-1-s " }] });
    expect(p.sku).toBe("LX-TST-1");
    expect(p.variants[0]?.sku).toBe("LX-TST-1-S");
  });

  it("barcodes are trimmed and upper-cased; only letters and digits, 4–64 long", async () => {
    const p = await created({ variants: [{ sku: "LX-TST-1", barcode: "  abc12345 " }] });
    expect(p.variants[0]?.barcode).toBe("ABC12345");
    for (const barcode of ["123", "88 50 00", "88-5000", "885000!", "x".repeat(65), ""]) {
      const r = await products.createProduct(
        towel({ sku: "LX-B", variants: [{ sku: "LX-B", barcode }] }),
      );
      expect(r.ok).toBe(false);
    }
    expect(await productModel(conn).countDocuments()).toBe(1);
  });

  it("invalid SKUs are rejected rather than silently changed", async () => {
    for (const sku of ["", "   ", "LX TST", "LX/1", "LX#1", "ไทย-1", "x".repeat(65)])
      expect((await products.createProduct(towel({ sku, variants: [{ sku: "LX-OK" }] }))).ok).toBe(
        false,
      );
    expect(await productModel(conn).countDocuments()).toBe(0);
  });

  it("uniqueness is case-insensitive for product SKUs, variant SKUs and barcodes", async () => {
    await created({ variants: [{ sku: "LX-TST-1-A", barcode: "ABC12345" }] });
    const dup = "That SKU or barcode is already used by another product.";
    expect(
      await products.createProduct(towel({ sku: "lx-tst-1", variants: [{ sku: "Z1" }] })),
    ).toEqual({ ok: false, error: dup });
    expect(
      await products.createProduct(towel({ sku: "LX-NEW", variants: [{ sku: "lx-tst-1-a" }] })),
    ).toEqual({ ok: false, error: dup });
    expect(
      await products.createProduct(
        towel({ sku: "LX-NEW", variants: [{ sku: "Z2", barcode: "abc12345" }] }),
      ),
    ).toEqual({ ok: false, error: dup });
    expect(
      await products.createProduct(
        towel({
          sku: "LX-NEW",
          variants: [
            { sku: "Z3", barcode: "Q1W2" },
            { sku: "Z4", barcode: "q1w2" },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: "Variant barcodes must be unique." });
    expect(await productModel(conn).countDocuments()).toBe(1);
  });

  it("the database itself rejects case-variant duplicates, even from a write that skips the service", async () => {
    await created({ variants: [{ sku: "LX-TST-1-A", barcode: "ABC12345" }] });
    if (!conn.db) throw new Error("not connected");
    const raw = conn.db.collection<{ _id: string }>("products");
    const base = {
      name: "Raw",
      category: "other",
      price: 10,
      minimumSellingPrice: 0,
      lowStockThreshold: 0,
      active: true,
    };
    for (const doc of [
      {
        _id: "prd_raw1",
        sku: "lx-tst-1",
        variants: [{ id: "v", sku: "R1", openingStock: 0, stock: 0 }],
      },
      {
        _id: "prd_raw2",
        sku: "RAW-2",
        variants: [{ id: "v", sku: "lx-tst-1-a", openingStock: 0, stock: 0 }],
      },
      {
        _id: "prd_raw3",
        sku: "RAW-3",
        variants: [{ id: "v", sku: "R3", barcode: "abc12345", openingStock: 0, stock: 0 }],
      },
    ])
      await expect(raw.insertOne({ ...base, ...doc })).rejects.toThrow(/duplicate key/);
  });
});

describe("simultaneous duplicate creates", () => {
  it("10 concurrent creates of the same SKU (any letter case): exactly one succeeds", async () => {
    const spellings = ["lx-race", "LX-RACE", " Lx-Race ", "lX-rAcE"];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        products.createProduct(
          towel({ sku: spellings[i % spellings.length], variants: [{ sku: `LX-RACE-V${i}` }] }),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await productModel(conn).countDocuments({ sku: "LX-RACE" })).toBe(1);
    expect(await productModel(conn).countDocuments()).toBe(1);
  });

  it("10 concurrent creates sharing one barcode (any letter case): exactly one succeeds", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        products.createProduct(
          towel({
            sku: `LX-BC-${i}`,
            variants: [{ sku: `LX-BC-${i}`, barcode: i % 2 ? "racebc01" : "RACEBC01" }],
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await productModel(conn).countDocuments()).toBe(1);
  });
});

describe("required indexes (fail closed; never created by requests)", () => {
  const fresh = async (dbName: string) => {
    const c = mongoose.createConnection();
    await c.openUri(server.getUri(), { ...connectOptions(false), dbName });
    return c;
  };

  it("creation refuses while the unique indexes are missing, then works once they exist", async () => {
    const c = await fresh("luxe_products_noindex");
    try {
      const service = createProductService(c);
      expect(await verifyProductIndexes(c)).toBe(false);
      expect(await service.createProduct(towel())).toEqual({ ok: false, error: SETUP_INCOMPLETE });
      expect(await productModel(c).countDocuments()).toBe(0);
      // The refusal itself must not have created any index or collection.
      expect(await verifyProductIndexes(c)).toBe(false);
      await ensureProductIndexes(c); // what `bun run db:setup-indexes` does
      expect(await verifyProductIndexes(c)).toBe(true);
      expect((await service.createProduct(towel())).ok).toBe(true);
    } finally {
      await c.destroy();
    }
  });

  it("an index with the right name but the wrong definition does not count", async () => {
    const c = await fresh("luxe_products_wrongindex");
    try {
      if (!c.db) throw new Error("not connected");
      // Case-SENSITIVE unique index under the expected name: must be rejected by the check.
      await c.db
        .collection("products")
        .createIndex({ sku: 1 }, { unique: true, name: "product_sku_unique_ci" });
      expect(await verifyProductIndexes(c)).toBe(false);
      expect(await createProductService(c).createProduct(towel())).toEqual({
        ok: false,
        error: SETUP_INCOMPLETE,
      });
    } finally {
      await c.destroy();
    }
  });

  it("no application code outside the setup script creates indexes", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f}`)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (f === "src/server/models/product.server.ts" || f === "src/server/auth/auth.server.ts")
        continue; // these only DEFINE ensure*Indexes
      expect(src).not.toMatch(/ensure(Product|Auth)Indexes\(|createIndex(es)?\(|syncIndexes\(/);
    }
  });
});

describe("cost is owner-only and never in public reads", () => {
  it("public results never contain cost, even though it is stored", async () => {
    const p = await created();
    const listed = await products.listProducts();
    const one = await products.getProduct(p.id);
    for (const result of [p, ...listed, one]) {
      expect(result).toBeDefined();
      expect(Object.keys(result ?? {})).not.toContain("cost");
      expect(JSON.stringify(result)).not.toMatch(/"cost"/);
    }
    expect((await products.getProductForOwner(p.id))?.cost).toBe(200);
  });

  it("the model itself hides cost unless a query explicitly asks for it", async () => {
    const p = await created();
    const plain = await productModel(conn).findById(p.id).lean();
    expect(plain && "cost" in plain).toBe(false);
    const withCost = await productModel(conn).findById(p.id).select("+cost").lean();
    expect(withCost?.cost).toBe(200);
  });
});

describe("update: the price/minimum relationship holds after every change", () => {
  it("accepts valid changes, including clearing cost", async () => {
    const p = await created();
    const r = await products.updateProduct(p.id, {
      price: 600,
      minimumSellingPrice: 450,
      cost: null,
    });
    expect(r).toMatchObject({ ok: true, data: { price: 600, minimumSellingPrice: 450 } });
    expect((await products.getProductForOwner(p.id))?.cost).toBeUndefined();
  });

  it("rejects lowering the price below the existing minimum, or raising the minimum above the price", async () => {
    const p = await created();
    expect(await products.updateProduct(p.id, { price: 300 })).toEqual({
      ok: false,
      error: "Minimum selling price cannot be higher than the selling price.",
    });
    expect((await products.updateProduct(p.id, { minimumSellingPrice: 501 })).ok).toBe(false);
    expect(await products.getProduct(p.id)).toMatchObject({ price: 500, minimumSellingPrice: 350 });
  });

  it("cannot change SKU, variants, stock, active flag or id through update", async () => {
    const p = await created();
    for (const bad of [
      { sku: "NEW" },
      { variants: [] },
      { stock: 999 },
      { active: false },
      { _id: "prd_x" },
    ])
      expect((await products.updateProduct(p.id, bad)).ok).toBe(false);
    expect(await products.getProduct(p.id)).toMatchObject({ sku: "LX-TST-1", active: true });
    expect((await products.getProduct(p.id))?.variants[0]?.stock).toBe(0);
  });

  it("two simultaneous updates cannot combine into an invalid price/minimum pair", async () => {
    // Each update is valid against the stored ฿500 / min ฿350; together (฿400 price, ฿450 min)
    // they are not. Whether the two requests overlap depends on timing, so run several rounds:
    // without optimistic concurrency, most rounds end at 400/450.
    for (let round = 0; round < 10; round++) {
      const p = await created({
        sku: `LX-RACE-${round}`,
        variants: [{ sku: `LX-RACE-${round}` }],
      });
      const results = await Promise.all([
        products.updateProduct(p.id, { price: 400 }),
        products.updateProduct(p.id, { minimumSellingPrice: 450 }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const final = await products.getProduct(p.id);
      expect(final && final.minimumSellingPrice <= final.price).toBe(true);
    }
  });

  it("query-style updates cannot bypass pricing validation", async () => {
    const p = await created();
    const Product = productModel(conn);
    await expect(
      Product.updateOne({ _id: p.id }, { $set: { minimumSellingPrice: 9999 } }),
    ).rejects.toThrow("Product pricing can only be changed through the product service.");
    await expect(Product.findOneAndUpdate({ _id: p.id }, { price: 1 })).rejects.toThrow();
    await expect(Product.updateMany({}, { $inc: { cost: -500 } })).rejects.toThrow();
    await expect(Product.replaceOne({ _id: p.id }, towel())).rejects.toThrow();
    // Non-pricing query updates are still possible (later: inventory movements).
    await Product.updateOne({ _id: p.id }, { $set: { name: "Renamed" } });
    expect(await products.getProduct(p.id)).toMatchObject({
      name: "Renamed",
      price: 500,
      minimumSellingPrice: 350,
    });
  });

  it("document saves are validated even outside the service", async () => {
    const Product = productModel(conn);
    await expect(
      Product.create({
        ...towel(),
        _id: "prd_direct",
        minimumSellingPrice: 600,
        variants: [{ id: "v1", sku: "D", openingStock: 0, stock: 0 }],
      }),
    ).rejects.toThrow("Minimum selling price cannot be higher than the selling price.");
  });
});

describe("archive, ids and lookups", () => {
  it("archives instead of deleting; archived products are hidden by default", async () => {
    const p = await created();
    expect((await products.setProductActive(p.id, false)).ok).toBe(true);
    expect(await products.listProducts()).toEqual([]);
    expect(await products.listProducts({ includeArchived: true })).toHaveLength(1);
    expect((await products.setProductActive(p.id, true)).ok).toBe(true);
    expect(await products.listProducts()).toHaveLength(1);
  });

  it("rejects malformed ids, including query-operator objects", async () => {
    await created();
    for (const id of [{ $ne: null }, { $gt: "" }, "", "123", undefined])
      expect(await products.getProduct(id)).toBeUndefined();
    expect((await products.updateProduct({ $ne: null }, { name: "x" })).ok).toBe(false);
    expect((await products.setProductActive({ $ne: null }, false)).ok).toBe(false);
  });
});

describe("database failures", () => {
  it("surface as a generic DatabaseUnavailableError with no details", async () => {
    const dead = mongoose.createConnection();
    await dead.openUri(server.getUri(), { ...connectOptions(true), dbName: "luxe_products_test" });
    const service = createProductService(dead);
    await dead.destroy();
    for (const op of [
      () => service.listProducts(),
      () => service.getProduct("prd_x"),
      () => service.createProduct(towel()),
    ]) {
      const err = await op().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DatabaseUnavailableError);
      expect(String(err)).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
    }
  });
});

describe("browser boundary", () => {
  it("no browser-facing file statically imports the product model or service", () => {
    // Scans the working tree (including uncommitted files), not just what Git tracks.
    const browserFacing = readdirSync("src", { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f}`)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !f.startsWith("src/server/") && !f.startsWith("src/test/"));
    const staticImport =
      /^\s*(?:import|export)(?:\s+[^;(]*?\sfrom)?\s*["'][^"']*(?:products|models\/product)\.server["']/m;
    expect(browserFacing.filter((f) => staticImport.test(readFileSync(f, "utf8")))).toEqual([]);
    // Server functions may load it only with a dynamic import inside a handler, which the
    // framework strips from the browser bundle (verified by the e2e production-build scan).
    for (const f of browserFacing) {
      const src = readFileSync(f, "utf8");
      if (/products\.server/.test(src)) expect(src).toMatch(/createServerFn/);
    }
  });

  it("the service and model files carry the .server suffix (blocked from client imports)", () => {
    expect(readFileSync("src/server/products.server.ts", "utf8")).toContain("SERVER-ONLY");
    expect(readFileSync("src/server/models/product.server.ts", "utf8")).toContain("SERVER-ONLY");
  });
});
