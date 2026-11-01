// @vitest-environment node
/**
 * `bun run db:migrate-money-satang` (scripts/migrate-money-satang.ts), run for real under Bun
 * against an ISOLATED throwaway MongoDB on 127.0.0.1, from a temporary folder with no .env. Never
 * run against any real database by agents.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectOptions } from "@/server/db.server";
import { createProductService } from "@/server/products.server";

const SCRIPT = join(process.cwd(), "scripts/migrate-money-satang.ts");
/** Raw documents written straight to the collection, bypassing the app (test setup only). */
type RawProduct = { _id: string; [field: string]: unknown };
let server: MongoMemoryServer;
let cwd = "";
const conns: Connection[] = [];
let dbCount = 0;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(server.getUri()))
    throw new Error("Refusing non-local test DB");
  cwd = mkdtempSync(join(tmpdir(), "luxe-money-")); // empty: no .env can be loaded
}, 120_000);

afterAll(async () => {
  for (const c of conns) await c.destroy().catch(() => undefined);
  await server?.stop();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

/** Distinctive values, so any product data printed by the script would be noticed. */
const SECRET_NAME = "Zebra Silk Robe 7731";

function run(dbName: string, ...args: string[]) {
  const env = {
    PATH: process.env["PATH"] ?? "",
    HOME: tmpdir(),
    MONGODB_URI: `${server.getUri()}${dbName}`,
  };
  const direct = spawnSync("bun", [SCRIPT, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  const r = direct.error
    ? spawnSync("npx", ["-y", "bun@1", SCRIPT, ...args], {
        cwd,
        env,
        encoding: "utf8",
        timeout: 60_000,
      })
    : direct;
  const output = `${r.stdout}\n${r.stderr}`;
  // Never prints the connection string or any product data: counts only.
  expect(output).not.toMatch(/mongodb:\/\/|127\.0\.0\.1/);
  for (const leak of [SECRET_NAME, "LX-MIG", "prd_mig", "1234", "123400", "77700"])
    expect(output).not.toContain(leak);
  return { status: r.status, output };
}

async function freshDb() {
  const dbName = `luxe_money_${++dbCount}`;
  const c = mongoose.createConnection();
  await c.openUri(server.getUri(), { ...connectOptions(false), dbName });
  conns.push(c);
  if (!c.db) throw new Error("not connected");
  return { dbName, conn: c, products: c.db.collection<RawProduct>("products") };
}

/** A product as stored before the change: whole baht in price / minimumSellingPrice / cost. */
const legacy = (n: number, money: Record<string, unknown>) => ({
  _id: `prd_mig${n}`,
  name: `${SECRET_NAME} ${n}`,
  sku: `LX-MIG-${n}`,
  category: "other",
  description: "",
  active: true,
  lowStockThreshold: 0,
  variants: [{ id: `var_mig${n}`, sku: `LX-MIG-${n}`, openingStock: 0, stock: 0 }],
  ...money,
});
const sorted = async (products: Awaited<ReturnType<typeof freshDb>>["products"]) =>
  products.find({}, { sort: { _id: 1 } }).toArray();

describe("db:migrate-money-satang", () => {
  it("dry run by default: prints counts and changes nothing", async () => {
    const { dbName, products } = await freshDb();
    await products.insertMany([
      legacy(1, { price: 1234, minimumSellingPrice: 777, cost: 500 }),
      legacy(2, { price: 10, minimumSellingPrice: 0 }),
    ]);
    const before = await sorted(products);
    const r = run(dbName);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Products: 2");
    expect(r.output).toContain("To convert (whole baht → satang): 2");
    expect(r.output).toContain("Dry run: nothing was changed.");
    expect(await sorted(products)).toEqual(before);
  });

  it("--apply converts ×100 to the *Satang fields and removes the old fields", async () => {
    const { dbName, conn, products } = await freshDb();
    await products.insertMany([
      legacy(1, { price: 1234, minimumSellingPrice: 777, cost: 500 }),
      legacy(2, { price: 10, minimumSellingPrice: 0 }),
    ]);
    const r = run(dbName, "--apply");
    expect(r.status).toBe(0);
    expect(r.output).toContain("Converted: 2. Still to convert: 0.");
    const [a, b] = await sorted(products);
    expect(a).toMatchObject({
      priceSatang: 123_400,
      minimumSellingPriceSatang: 77_700,
      costSatang: 50_000,
    });
    expect(b).toMatchObject({ priceSatang: 1000, minimumSellingPriceSatang: 0 });
    for (const doc of [a, b])
      for (const old of ["price", "minimumSellingPrice", "cost"])
        expect(doc).not.toHaveProperty(old);
    expect(b).not.toHaveProperty("costSatang"); // no cost stays no cost
    // Other fields are untouched, and the app reads the result.
    expect(a).toMatchObject({ name: `${SECRET_NAME} 1`, sku: "LX-MIG-1", active: true });
    const viaApp = await createProductService(conn).getProductForOwner("prd_mig1");
    expect(viaApp).toMatchObject({ priceSatang: 123_400, costSatang: 50_000 });
  });

  it("is idempotent: a second --apply (and a dry run after it) changes nothing", async () => {
    const { dbName, products } = await freshDb();
    await products.insertMany([
      legacy(1, { price: 1234, minimumSellingPrice: 777, cost: 500 }),
      legacy(2, { price: 10, minimumSellingPrice: 0 }),
    ]);
    expect(run(dbName, "--apply").status).toBe(0);
    const once = await sorted(products);
    const again = run(dbName, "--apply");
    expect(again.status).toBe(0);
    expect(again.output).toContain("To convert (whole baht → satang): 0");
    expect(again.output).toContain("Converted: 0. Still to convert: 0.");
    expect(await sorted(products)).toEqual(once);
    expect(run(dbName).output).toContain("Already in satang: 2");
    expect(await sorted(products)).toEqual(once);
  });

  it("converts only what is left after an interruption (mixed old and already-new products)", async () => {
    const { dbName, products } = await freshDb();
    await products.insertMany([
      legacy(1, { priceSatang: 99_950, minimumSellingPriceSatang: 0 }), // already converted
      legacy(2, { price: 20, minimumSellingPrice: 5 }),
    ]);
    const r = run(dbName, "--apply");
    expect(r.output).toContain("Converted: 1.");
    const [a, b] = await sorted(products);
    expect(a).toMatchObject({ priceSatang: 99_950, minimumSellingPriceSatang: 0 });
    expect(b).toMatchObject({ priceSatang: 2000, minimumSellingPriceSatang: 500 });
  });

  it("refuses, changing nothing, when values cannot be converted safely", async () => {
    for (const bad of [
      { price: 12.5, minimumSellingPrice: 0 }, // not whole baht
      { price: "500", minimumSellingPrice: 0 }, // not a number
      { price: 0, minimumSellingPrice: 0 }, // price must be ≥ ฿1
      { price: 500, minimumSellingPrice: -1 },
      { price: 500, minimumSellingPrice: 600 }, // minimum above price
      { price: 500, minimumSellingPrice: 0, cost: null },
      { price: 10_000_001, minimumSellingPrice: 0 }, // above ฿10,000,000
      { minimumSellingPrice: 0 }, // price missing
      { price: 500, minimumSellingPrice: 0, priceSatang: 50_000 }, // old and new at once
    ]) {
      const { dbName, products } = await freshDb();
      await products.insertMany([legacy(1, bad), legacy(2, { price: 10, minimumSellingPrice: 0 })]);
      const before = await sorted(products);
      const r = run(dbName, "--apply");
      expect(r.status, JSON.stringify(bad)).toBe(1);
      expect(r.output).toContain("Nothing was changed.");
      expect(await sorted(products)).toEqual(before);
    }
  }, 120_000);

  it("rejects unknown arguments and reports an unreachable database without details", async () => {
    const { dbName } = await freshDb();
    const usage = run(dbName, "--aply");
    expect(usage.status).toBe(2);
    expect(usage.output).toContain("Usage: bun run db:migrate-money-satang [--apply]");
    const env = { PATH: process.env["PATH"] ?? "", HOME: tmpdir(), MONGODB_URI: "nonsense" };
    const r = spawnSync("bun", [SCRIPT], { cwd, env, encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("Nothing was changed.");
  });
});
