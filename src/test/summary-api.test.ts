// @vitest-environment node
/**
 * INTERIM Quick Sales API for n8n (decision 0004): `GET /api/daily-summary`, through
 * `handleDailySummary` with real Request objects, against an ISOLATED, throwaway MongoDB
 * (mongodb-memory-server on 127.0.0.1). Never reads MONGODB_URI, SUMMARY_API_TOKEN or .env.
 * The test token below is a throwaway value, not a real token.
 */
import { readFileSync } from "node:fs";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthService, ensureAuthIndexes } from "@/server/auth/auth.server";
import { connectOptions, DatabaseUnavailableError } from "@/server/db.server";
import { loginAttemptModel } from "@/server/models/login-attempt.server";
import { openingFloatModel, quickSaleModel } from "@/server/models/quick-sale.server";
import { userModel } from "@/server/models/user.server";
import { createQuickSalesService } from "@/server/quick-sales.server";
import {
  bearerToken,
  configuredSummaryToken,
  handleDailySummary,
  SUMMARY_API_LIMIT,
  tokensMatch,
} from "@/server/summary-api.server";

const TOKEN = "test-only-token-0123456789-abcdefghij"; // 36 characters, throwaway
const IP = "203.0.113.9";
/** 2026-11-01 10:00 in Bangkok. */
const MORNING = Date.UTC(2026, 10, 1, 3, 0, 0);

let server: MongoMemoryServer;
let conn: Connection;
let clock: number;
const now = () => new Date(clock);

const request = (headers: Record<string, string> = {}, query = "") =>
  new Request(`http://127.0.0.1/api/daily-summary${query}`, { headers });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function deps(over: Partial<Parameters<typeof handleDailySummary>[1]> = {}) {
  const calls = { database: 0 };
  const withDatabase = <T>(fn: (c: Connection) => Promise<T>): Promise<T> => {
    calls.database++;
    return fn(conn);
  };
  return { calls, deps: { token: TOKEN, clientAddress: IP, withDatabase, now, ...over } };
}

async function get(
  headers: Record<string, string> = {},
  query = "",
  over: Partial<Parameters<typeof handleDailySummary>[1]> = {},
) {
  const res = await handleDailySummary(request(headers, query), deps(over).deps);
  return { status: res.status, body: (await res.json()) as unknown, headers: res.headers };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_summary_api_test" });
  await ensureAuthIndexes(conn);
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await openingFloatModel(conn).collection.deleteMany({});
  await quickSaleModel(conn).collection.deleteMany({});
  await loginAttemptModel(conn).collection.deleteMany({});
  await userModel(conn).collection.deleteMany({});
  // Real time, so the login_attempts TTL index never deletes test records early.
  clock = Date.now();
});

describe("token configuration fails closed", () => {
  it("missing, empty, non-string or shorter than 32 characters: 503 for everyone, no database", async () => {
    for (const token of [undefined, "", "x".repeat(31), 1234567890]) {
      const { deps: d, calls } = deps({ token });
      const res = await handleDailySummary(request(bearer(String(token))), d);
      expect(res.status, String(token)).toBe(503);
      expect(await res.json()).toEqual({ error: "Not configured." });
      expect(calls.database).toBe(0);
    }
    expect(configuredSummaryToken("x".repeat(32))).toBe("x".repeat(32));
  });
});

describe("the bearer token is required", () => {
  it("missing, other schemes, short, wrong or nearly-right tokens: 401; the correct one: 200", async () => {
    for (const headers of [
      {},
      { authorization: "" },
      { authorization: `Basic ${TOKEN}` },
      { authorization: `bearer ${TOKEN}` },
      { authorization: `Bearer  ${TOKEN}` },
      // (A trailing space never arrives: the Fetch Headers API trims header values.)
      bearer("short"),
      bearer(TOKEN.slice(0, -1)),
      bearer(`${TOKEN}x`),
      bearer(TOKEN.replace(/.$/, "X")),
      { "x-api-key": TOKEN },
    ]) {
      const r = await get(headers);
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.body).toEqual({ error: "Not allowed." });
      expect(r.headers.get("www-authenticate")).toBe("Bearer");
      await loginAttemptModel(conn).collection.deleteMany({}); // stay under the rate limit
    }
    expect((await get(bearer(TOKEN))).status).toBe(200);
  });

  it("cookies and sessions are never accepted: a valid owner session without the token is refused", async () => {
    const auth = createAuthService(conn);
    await auth.createFirstOwner({
      email: "o@example.invalid",
      name: "O",
      password: "correct-horse-battery-1",
    });
    const login = await auth.login(
      { email: "o@example.invalid", password: "correct-horse-battery-1" },
      undefined,
    );
    if (!login.ok) throw new Error(login.error);
    const r = await get({
      cookie: `luxe_session=${login.token}; __Host-luxe_session=${login.token}`,
    });
    expect(r.status).toBe(401);
    // The module never touches cookies or sessions at all.
    const source = readFileSync("src/server/summary-api.server.ts", "utf8");
    expect(source).not.toMatch(/getCookie|session-context|resolveSession|requireOwner/);
  });

  it("tokensMatch compares SHA-256 digests with timingSafeEqual (any lengths, no throw)", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch("", TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN.repeat(10), TOKEN)).toBe(false);
    const source = readFileSync("src/server/summary-api.server.ts", "utf8");
    expect(source).toMatch(/timingSafeEqual\(a, b\)/);
    expect(source).not.toMatch(/given\s*===\s*expected|expected\s*===\s*given/);
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`Bearer ${"x".repeat(600)}`)).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});

describe("failed attempts are rate-limited per client address (MongoDB limiter)", () => {
  it(`after ${SUMMARY_API_LIMIT.maxFailures} failures: 429, even with the correct token; other addresses unaffected`, async () => {
    for (let i = 0; i < SUMMARY_API_LIMIT.maxFailures; i++)
      expect((await get(bearer(`wrong-${i}`))).status).toBe(401);
    const blocked = await get(bearer(TOKEN));
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "Too many attempts. Try again later." });
    expect((await get(bearer(TOKEN), "", { clientAddress: "198.51.100.4" })).status).toBe(200);
    // The failures are stored in the shared MongoDB limiter, under their own kind.
    expect(
      await loginAttemptModel(conn).countDocuments({ _id: { $regex: /^summary_api\|/ } }),
    ).toBe(1);
    // The window passes: allowed again.
    clock += SUMMARY_API_LIMIT.windowMs + 1;
    expect((await get(bearer(TOKEN))).status).toBe(200);
  });

  it("successful calls do not use up the allowance", async () => {
    for (let i = 0; i < SUMMARY_API_LIMIT.maxFailures * 2; i++)
      expect((await get(bearer(TOKEN))).status).toBe(200);
    for (let i = 0; i < SUMMARY_API_LIMIT.maxFailures - 1; i++)
      expect((await get(bearer("wrong"))).status).toBe(401);
    expect((await get(bearer(TOKEN))).status).toBe(200);
  });

  it("requests without a known address share one bucket; IPv6 counts per /64", async () => {
    for (let i = 0; i < SUMMARY_API_LIMIT.maxFailures; i++)
      await get(bearer("wrong"), "", { clientAddress: undefined });
    expect((await get(bearer(TOKEN), "", { clientAddress: undefined })).status).toBe(429);
    for (let i = 0; i < SUMMARY_API_LIMIT.maxFailures; i++)
      await get(bearer("wrong"), "", { clientAddress: `2001:db8:1:2::${i + 1}` });
    expect((await get(bearer(TOKEN), "", { clientAddress: "2001:db8:1:2::ffff" })).status).toBe(
      429,
    );
  });

  it("a limiter or database failure fails closed: 503, no data", async () => {
    const down = <T>(): Promise<T> => Promise.reject(new DatabaseUnavailableError("unavailable"));
    const r = await get(bearer(TOKEN), "", { withDatabase: down });
    expect(r).toMatchObject({ status: 503, body: { error: "Database unavailable." } });
  });
});

describe("the summary", () => {
  it("returns exactly the documented JSON shape (non-cancelled sales, oldest first, HH:mm Bangkok)", async () => {
    clock = MORNING;
    const q = createQuickSalesService(conn, { now });
    await q.recordOpeningFloat({ id: "usr_a" }, { amountText: "500" });
    await q.addSale(
      { id: "usr_a" },
      { itemText: "Scarf", amountText: "1,800.50", payment: "cash" },
    );
    clock += 5 * 60 * 1000;
    await q.addSale({ id: "usr_b" }, { itemText: "Bag", amountText: "2500", payment: "qr" });
    const c = await q.addSale(
      { id: "usr_a" },
      { itemText: "Belt", amountText: "99", payment: "cash" },
    );
    if (!c.ok) throw new Error(c.error);
    await q.cancelOwnSale({ id: "usr_a" }, c.sale.id);
    clock = Date.now();
    const r = await get(bearer(TOKEN), "?date=2026-11-01");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(r.body).toEqual({
      date: "2026-11-01",
      openingFloatSatang: 50000,
      totalSatang: 430050,
      cashSatang: 180050,
      qrSatang: 250000,
      count: 2,
      cancelledCount: 1,
      sales: [
        { time: "10:00", itemText: "Scarf", amountSatang: 180050, payment: "cash" },
        { time: "10:05", itemText: "Bag", amountSatang: 250000, payment: "qr" },
      ],
    });
    expect(JSON.stringify(r.body)).not.toMatch(/usr_|userId|qs_|Belt/);
  });

  it("defaults to today in Bangkok; a bad date is 400 (after the token check)", async () => {
    clock = Date.UTC(2026, 10, 1, 17, 0, 0); // midnight in Bangkok: already 2026-11-02
    expect((await get(bearer(TOKEN))).body).toMatchObject({ date: "2026-11-02", count: 0 });
    expect((await get(bearer(TOKEN), "?date=2026-02-30")).status).toBe(400);
    expect((await get(bearer(TOKEN), "?date=yesterday")).body).toEqual({
      error: "Invalid date. Use YYYY-MM-DD.",
    });
    expect((await get({}, "?date=yesterday")).status).toBe(401);
    expect((await get(bearer(TOKEN), "?date=2026-11-01")).body).toMatchObject({
      date: "2026-11-01",
      openingFloatSatang: null,
      sales: [],
    });
  });
});
