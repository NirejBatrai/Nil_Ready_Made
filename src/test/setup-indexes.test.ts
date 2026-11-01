// @vitest-environment node
/**
 * `bun run db:setup-indexes` (scripts/setup-indexes.ts), run for real under Bun against an
 * ISOLATED throwaway MongoDB on 127.0.0.1, from a temporary folder with no .env (Bun loads .env
 * only from the working directory). It must never modify existing product data.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectOptions } from "@/server/db.server";
import { verifyProductIndexes } from "@/server/models/product.server";

const SCRIPT = join(process.cwd(), "scripts/setup-indexes.ts");
/** Raw documents written straight to the collection, bypassing the app (test setup only). */
type RawProduct = { _id: string; sku: string; [field: string]: unknown };
let server: MongoMemoryServer;
let cwd = "";
const conns: Connection[] = [];

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(server.getUri()))
    throw new Error("Refusing non-local test DB");
  cwd = mkdtempSync(join(tmpdir(), "luxe-idx-")); // empty: no .env can be loaded
}, 120_000);

afterAll(async () => {
  for (const c of conns) await c.destroy().catch(() => undefined);
  await server?.stop();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

function runSetup(dbName: string) {
  const env = {
    PATH: process.env["PATH"] ?? "",
    HOME: tmpdir(),
    MONGODB_URI: `${server.getUri()}${dbName}`,
  };
  const direct = spawnSync("bun", [SCRIPT], { cwd, env, encoding: "utf8", timeout: 60_000 });
  const r = direct.error
    ? spawnSync("npx", ["-y", "bun@1", SCRIPT], { cwd, env, encoding: "utf8", timeout: 60_000 })
    : direct;
  const output = `${r.stdout}\n${r.stderr}`;
  expect(output).not.toMatch(/mongodb:\/\/|127\.0\.0\.1/); // never prints the connection string
  return { status: r.status, output };
}

async function db(dbName: string) {
  const c = mongoose.createConnection();
  await c.openUri(server.getUri(), { ...connectOptions(false), dbName });
  conns.push(c);
  if (!c.db) throw new Error("not connected");
  return { conn: c, products: c.db.collection<RawProduct>("products") };
}

const raw = (id: string, sku: string, variantSku: string, barcode?: string) => ({
  _id: id,
  name: id,
  sku,
  category: "other",
  priceSatang: 1000,
  minimumSellingPriceSatang: 0,
  lowStockThreshold: 0,
  active: true,
  variants: [
    { id: `${id}_v`, sku: variantSku, ...(barcode ? { barcode } : {}), openingStock: 0, stock: 0 },
  ],
});

describe("db:setup-indexes", () => {
  it("creates the required indexes on an empty database and is safe to run again", async () => {
    const first = runSetup("idx_empty");
    expect(first.status).toBe(0);
    expect(first.output).toContain("Database indexes are in place.");
    const { conn } = await db("idx_empty");
    expect(await verifyProductIndexes(conn)).toBe(true);
    const again = runSetup("idx_empty");
    expect(again.status).toBe(0);
    expect(await verifyProductIndexes(conn)).toBe(true);
  }, 120_000);

  it("refuses, without changing data, when existing SKUs/barcodes collide case-insensitively", async () => {
    const { conn, products } = await db("idx_conflict");
    const docs = [
      raw("prd_a", "ABC-1", "ABC-1-V", "BAR1"),
      raw("prd_b", "abc-1", "OTHER-V", "bar1"), // collides with prd_a, only by letter case
    ];
    await products.insertMany(docs);
    const before = JSON.stringify(await products.find().sort({ _id: 1 }).toArray());
    const r = runSetup("idx_conflict");
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/Product SKUs that collide.*ABC-1/);
    expect(r.output).toMatch(/Barcodes that collide.*BAR1/);
    expect(r.output).toContain("No indexes were created and no data was changed.");
    expect(JSON.stringify(await products.find().sort({ _id: 1 }).toArray())).toBe(before);
    expect(await verifyProductIndexes(conn)).toBe(false);
  }, 120_000);

  it("refuses when stored values are not normalized (never rewrites them)", async () => {
    const { conn, products } = await db("idx_unnormalized");
    await products.insertOne(raw("prd_c", "lower-1", "LOWER-1-V"));
    const r = runSetup("idx_unnormalized");
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/1 stored SKU\/barcode value\(s\) are not trimmed upper-case/);
    expect((await products.findOne({ _id: "prd_c" }))?.sku).toBe("lower-1");
    expect(await verifyProductIndexes(conn)).toBe(false);
  }, 120_000);

  it("stops safely when an existing index has the same name but a different definition", async () => {
    const { conn, products } = await db("idx_wrongdef");
    await products.createIndex({ sku: 1 }, { unique: true, name: "product_sku_unique_ci" });
    const r = runSetup("idx_wrongdef");
    expect(r.status).toBe(1);
    expect(r.output).toContain("Nothing was dropped or changed.");
    const index = (await products.indexes()).find((i) => i.name === "product_sku_unique_ci");
    expect(index?.collation).toBeUndefined(); // the existing index was left exactly as it was
    expect(await verifyProductIndexes(conn)).toBe(false);
  }, 120_000);
});
