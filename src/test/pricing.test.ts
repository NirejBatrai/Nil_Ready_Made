/**
 * Minimum selling price rule, exercised through the repository layer (the demo's central
 * business-logic layer). Browser-only: not secure against a user who edits local data.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createSeed } from "@/data/demo-seed";
import { must, nth } from "@/lib/assert";
import { lineGrossProfit, productPricingError, unitPriceError } from "@/lib/calc";
import { periodMetrics } from "@/lib/metrics";
import { findVariant, repo } from "@/lib/repository";
import {
  getState,
  migrateDemoState,
  resetDemoState,
  type DemoState,
} from "@/lib/repository/demo-store";
import type { CartLine, Product } from "@/types/domain";

const MIN_MSG =
  "This item's minimum selling price is ฿350. Sales below the minimum are not permitted.";

const ok = <T>(r: { ok: true; data: T } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

/** Owner creates the spec's example product: normal ฿500, minimum ฿350, cost ฿200. */
async function createTowel(): Promise<{ product: Product; variantId: string }> {
  repo.setDemoRole("owner");
  const product = ok(
    await repo.saveProduct({
      id: "prd_test",
      name: "Test Towel",
      sku: "LX-TST-1",
      category: "accessories",
      description: "",
      price: 500,
      minimumSellingPrice: 350,
      cost: 200,
      active: true,
      lowStockThreshold: 1,
      variants: [
        {
          id: "var_test",
          productId: "prd_test",
          sku: "LX-TST-1",
          openingStock: 20,
          stock: 20,
        },
      ],
    }),
  );
  repo.setDemoRole("employee");
  return { product, variantId: "var_test" };
}

/** Leather Slide Sandal 38 · Tan: normal ฿1,290, sample minimum ฿990. */
const SANDAL = "prd_001_v2";

let n = 0;
const sell = (lines: CartLine[], extra: { discountPct?: number; key?: string } = {}) =>
  repo.createSale({
    lines,
    discountPct: extra.discountPct ?? 0,
    paymentMethod: "qr",
    idempotencyKey: extra.key ?? `k${++n}`,
  });

function snapshot() {
  const s = getState();
  return {
    sales: s.sales.length,
    payments: s.payments.length,
    movements: s.movements.length,
    receipt: s.counters.receipt,
    completed: s.audit.filter((a) => a.action === "sale.completed").length,
    stock: must(findVariant(s, "var_test")).variant.stock,
  };
}

beforeEach(() => resetDemoState());

describe("checkout price rule", () => {
  it("1. sells at the normal price (default and explicit)", async () => {
    const { variantId } = await createTowel();
    const a = ok(await sell([{ variantId, qty: 1 }]));
    const b = ok(await sell([{ variantId, qty: 1, unitPrice: 500 }]));
    for (const sale of [a, b]) {
      expect(nth(sale.items, 0)).toMatchObject({ unitPrice: 500, listPrice: 500, lineDiscount: 0 });
      expect(sale.total).toBe(500);
    }
  });

  it("2. sells above the minimum and below normal, keeping all snapshots", async () => {
    const { variantId } = await createTowel();
    const sale = ok(await sell([{ variantId, qty: 2, unitPrice: 400 }]));
    expect(nth(sale.items, 0)).toMatchObject({
      unitPrice: 400,
      listPrice: 500,
      minimumPrice: 350,
      lineDiscount: 200,
      unitCost: 200,
      qty: 2,
    });
    expect(sale).toMatchObject({ subtotal: 800, discount: 0, total: 800 });
  });

  it("3. sells at exactly the minimum (inclusive)", async () => {
    const { variantId } = await createTowel();
    const sale = ok(await sell([{ variantId, qty: 1, unitPrice: 350 }]));
    expect(sale.total).toBe(350);
  });

  it("4. blocks one satang below the minimum and records nothing but a failure audit", async () => {
    const { variantId } = await createTowel();
    const before = snapshot();
    for (const unitPrice of [349.99, 349, 0]) {
      expect(await sell([{ variantId, qty: 1, unitPrice }])).toEqual({ ok: false, error: MIN_MSG });
    }
    expect(snapshot()).toEqual(before);
    const blocked = getState().audit.filter((a) => a.action === "sale.blocked_below_minimum");
    expect(blocked).toHaveLength(3);
    expect(blocked.every((a) => a.result === "failure" && a.actorId === "emp_mali")).toBe(true);
  });

  it("5. rejects invalid, negative, fractional and above-normal prices", async () => {
    const { variantId } = await createTowel();
    const before = snapshot();
    const cases: [number, string][] = [
      [NaN, "Enter a valid price."],
      [Infinity, "Enter a valid price."],
      [-1, "Enter a valid price."],
      [350.5, "Prices must be in whole baht."],
      [501, "Price cannot be above the normal price of ฿500."],
    ];
    for (const [unitPrice, error] of cases)
      expect(await sell([{ variantId, qty: 1, unitPrice }])).toEqual({ ok: false, error });
    expect(snapshot()).toEqual(before);
  });

  it("6. rejects zero, negative and non-integer quantities", async () => {
    const { variantId } = await createTowel();
    const before = snapshot();
    for (const qty of [0, -1, 1.5])
      expect(await sell([{ variantId, qty, unitPrice: 400 }])).toEqual({
        ok: false,
        error: "Invalid quantity.",
      });
    expect(snapshot()).toEqual(before);
  });

  it("7. applies each item's own minimum in a multi-item cart", async () => {
    const { variantId } = await createTowel();
    const sale = ok(
      await sell([
        { variantId, qty: 1, unitPrice: 350 },
        { variantId: SANDAL, qty: 1, unitPrice: 990 },
      ]),
    );
    expect(sale.items.map((i) => [i.unitPrice, i.minimumPrice])).toEqual([
      [350, 350],
      [990, 990],
    ]);
    // A towel price that is fine for the towel cannot hide a sandal below its own minimum.
    const r = await sell([
      { variantId, qty: 1, unitPrice: 400 },
      { variantId: SANDAL, qty: 1, unitPrice: 989 },
    ]);
    expect(r).toEqual({
      ok: false,
      error:
        "This item's minimum selling price is ฿990. Sales below the minimum are not permitted.",
    });
  });

  it("an owner's cart discount cannot take any line below its minimum (no owner override)", async () => {
    const { variantId } = await createTowel();
    repo.setDemoRole("owner");
    const before = snapshot();
    const r = await sell([{ variantId, qty: 1, unitPrice: 350 }], { discountPct: 5 });
    expect(r.ok).toBe(false);
    expect(snapshot()).toEqual(before);
    // 10% off ฿400 = ฿360 effective, still at or above ฿350: allowed.
    expect((await sell([{ variantId, qty: 1, unitPrice: 400 }], { discountPct: 10 })).ok).toBe(
      true,
    );
    // The owner is bound by the same minimum on the line price itself.
    expect(await sell([{ variantId, qty: 1, unitPrice: 300 }])).toEqual({
      ok: false,
      error: MIN_MSG,
    });
  });

  it("rejects invalid discount values", async () => {
    const { variantId } = await createTowel();
    repo.setDemoRole("owner");
    for (const discountPct of [NaN, -5, 101])
      expect(await sell([{ variantId, qty: 1 }], { discountPct })).toEqual({
        ok: false,
        error: "Invalid discount.",
      });
  });

  it("checks stock against all lines for the same variant combined", async () => {
    const { variantId } = await createTowel();
    const r = await sell([
      { variantId, qty: 15, unitPrice: 400 },
      { variantId, qty: 10, unitPrice: 500 },
    ]);
    expect(r.ok).toBe(false);
    expect(snapshot().stock).toBe(20);
  });

  it("10. repeated submission of one checkout creates one sale", async () => {
    const { variantId } = await createTowel();
    const before = snapshot();
    const line = [{ variantId, qty: 1, unitPrice: 400 }];
    const results = await Promise.all([
      sell(line, { key: "same" }),
      sell(line, { key: "same" }),
      sell(line, { key: "same" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = snapshot();
    expect(after.sales - before.sales).toBe(1);
    expect(after.payments - before.payments).toBe(1);
    expect(after.stock).toBe(before.stock - 1);
  });
});

describe("product pricing configuration", () => {
  it("validates minimum against the selling price", () => {
    expect(productPricingError({ price: 500, minimumSellingPrice: 350 })).toBeUndefined();
    expect(productPricingError({ price: 500, minimumSellingPrice: 500 })).toBeUndefined();
    expect(productPricingError({ price: 500, minimumSellingPrice: 0 })).toBeUndefined();
    expect(productPricingError({ price: 500, minimumSellingPrice: 501 })).toBe(
      "Minimum selling price cannot be higher than the selling price.",
    );
    expect(productPricingError({ price: 500, minimumSellingPrice: -1 })).toMatch(/Minimum/);
    expect(productPricingError({ price: 500, minimumSellingPrice: 349.5 })).toMatch(/Minimum/);
    expect(productPricingError({ price: 0, minimumSellingPrice: 0 })).toMatch(/Selling price/);
    expect(productPricingError({ price: 500, minimumSellingPrice: 350, cost: -1 })).toMatch(/Cost/);
  });

  it("the repository refuses a minimum above the selling price", async () => {
    const { product } = await createTowel();
    repo.setDemoRole("owner");
    const r = await repo.saveProduct({ ...product, minimumSellingPrice: 600 });
    expect(r.ok).toBe(false);
    expect(must(getState().products.find((p) => p.id === product.id)).minimumSellingPrice).toBe(
      350,
    );
  });

  it("9. an employee cannot change pricing rules or archive products", async () => {
    const { product } = await createTowel(); // leaves the employee role active
    expect(
      await repo.saveProduct({ ...product, minimumSellingPrice: 1, price: 1, cost: 0 }),
    ).toEqual({ ok: false, error: "Only the owner can edit products." });
    expect((await repo.archiveProduct(product.id, false)).ok).toBe(false);
    expect(getState().products.find((p) => p.id === product.id)).toMatchObject({
      price: 500,
      minimumSellingPrice: 350,
      cost: 200,
      active: true,
    });
  });

  it("a saved product cannot be changed afterwards through the caller's object", async () => {
    const { product } = await createTowel();
    product.minimumSellingPrice = 1;
    expect(must(getState().products.find((p) => p.id === product.id)).minimumSellingPrice).toBe(
      350,
    );
  });

  it("8. editing price or minimum later does not change historical sales", async () => {
    const { product, variantId } = await createTowel();
    const sale = ok(await sell([{ variantId, qty: 1, unitPrice: 350 }]));
    repo.setDemoRole("owner");
    ok(await repo.saveProduct({ ...product, price: 900, minimumSellingPrice: 800, cost: 300 }));
    const stored = must(getState().sales.find((x) => x.id === sale.id));
    expect(stored).toEqual(sale);
    expect(nth(stored.items, 0)).toMatchObject({
      unitPrice: 350,
      listPrice: 500,
      minimumPrice: 350,
      unitCost: 200,
    });
    expect(
      getState().audit.some(
        (a) => a.action === "product.minimum_price_changed" && a.target === product.sku,
      ),
    ).toBe(true);
    // The new minimum now applies to new sales.
    repo.setDemoRole("employee");
    expect((await sell([{ variantId, qty: 1, unitPrice: 500 }])).ok).toBe(false);
  });
});

describe("profit", () => {
  it("a sale at the minimum price earns actual price minus cost, not zero", () => {
    expect(lineGrossProfit({ unitPrice: 350, qty: 2, unitCost: 200 })).toBe(300);
    expect(lineGrossProfit({ unitPrice: 350, qty: 1, unitCost: 400 })).toBe(-50);
  });

  it("profit is unavailable rather than estimated when cost is missing", async () => {
    expect(lineGrossProfit({ unitPrice: 350, qty: 1 })).toBeUndefined();
    const s = getState();
    const noCost = must(s.products.find((p) => p.cost === undefined));
    const day = "2030-01-01";
    const sale = {
      ...nth(s.sales, 0),
      id: "x",
      createdAt: `${day}T05:00:00.000Z`,
      status: "completed" as const,
      items: [{ ...nth(nth(s.sales, 0).items, 0), productId: noCost.id, unitCost: undefined }],
    };
    expect(periodMetrics({ ...s, sales: [sale] }, day, day).grossProfit).toBeUndefined();
  });

  it("reports price reductions separately", async () => {
    const { variantId } = await createTowel();
    ok(await sell([{ variantId, qty: 3, unitPrice: 400 }]));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    expect(periodMetrics(getState(), day, day).priceReductions).toBe(300);
  });
});

describe("11. demo data, reset and migration", () => {
  it("every sample product has a valid pricing rule and sample sales carry snapshots", () => {
    const seed = createSeed();
    for (const p of seed.products) expect(productPricingError(p)).toBeUndefined();
    expect(seed.products.some((p) => p.minimumSellingPrice < p.price)).toBe(true);
    for (const i of seed.sales.flatMap((x) => x.items)) {
      expect(i.listPrice).toBe(i.unitPrice);
      expect(i.lineDiscount).toBe(0);
      expect(
        unitPriceError(i.unitPrice, {
          listPrice: i.listPrice,
          minimumSellingPrice: must(i.minimumPrice),
        }),
      ).toBeUndefined();
    }
  });

  it("reset restores the sample products and their minimums after edits", async () => {
    await createTowel();
    resetDemoState();
    const { role: _r, currentUserId: _u, ...data } = getState();
    expect(data).toEqual(createSeed());
  });

  it("migrates browser data saved before the rule: minimum = normal price, no invented price", () => {
    const legacy = structuredClone({
      ...createSeed(),
      role: "owner",
      currentUserId: "emp_owner",
    }) as DemoState;
    const p = nth(legacy.products, 0);
    const item = nth(nth(legacy.sales, 0).items, 0);
    // Simulate records written by the previous version.
    Reflect.deleteProperty(p, "minimumSellingPrice");
    Reflect.deleteProperty(item, "listPrice");
    Reflect.deleteProperty(item, "lineDiscount");
    Reflect.deleteProperty(item, "minimumPrice");
    const migrated = migrateDemoState(legacy);
    expect(nth(migrated.products, 0).minimumSellingPrice).toBe(p.price);
    const migratedItem = nth(nth(migrated.sales, 0).items, 0);
    expect(migratedItem).toMatchObject({ listPrice: item.unitPrice, lineDiscount: 0 });
    expect(migratedItem.minimumPrice).toBeUndefined();
  });
});
