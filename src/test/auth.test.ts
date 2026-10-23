// @vitest-environment node
/**
 * Owner authentication tests against an ISOLATED throwaway MongoDB (mongodb-memory-server) on
 * 127.0.0.1. They never read MONGODB_URI or .env and never touch Atlas.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuthError,
  createAuthService,
  createLoginLimiter,
  ensureAuthIndexes,
  LOGIN_FAILED,
  LOGIN_THROTTLED,
  NOT_ALLOWED,
  NOT_SIGNED_IN,
  SESSION_TTL_MS,
} from "@/server/auth/auth.server";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/cookie.server";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password.server";
import { connectOptions, DatabaseUnavailableError } from "@/server/db.server";
import { sessionModel } from "@/server/models/session.server";
import { userModel } from "@/server/models/user.server";
import { ensureProductIndexes } from "@/server/models/product.server";
import { createProductService } from "@/server/products.server";

const PASSWORD = "correct-horse-battery-1"; // test-only value for a throwaway database
const EMAIL = "owner@example.invalid";
const IP = "203.0.113.7"; // documentation range

let server: MongoMemoryServer;
let conn: Connection;
let clock: number;
const now = () => new Date(clock);
/** A fresh service + attempt counter per test, sharing the controllable clock. */
let auth: ReturnType<typeof createAuthService>;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_auth_test" });
  await ensureAuthIndexes(conn);
  await ensureProductIndexes(conn);
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await userModel(conn).collection.deleteMany({});
  await sessionModel(conn).collection.deleteMany({});
  clock = Date.parse("2026-10-23T03:00:00Z");
  auth = createAuthService(conn, { now, limiter: createLoginLimiter() });
  const r = await auth.createFirstOwner({ email: EMAIL, name: "Test Owner", password: PASSWORD });
  if (!r.ok) throw new Error(r.error);
});

async function signIn() {
  const r = await auth.login({ email: EMAIL, password: PASSWORD }, IP);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("password hashing (scrypt)", () => {
  it("verifies the right password only, with a random salt each time", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });

  it("treats malformed or out-of-bounds stored hashes as non-matching", async () => {
    const good = await hashPassword(PASSWORD);
    const [, , r, p, salt, key] = good.split("$");
    for (const bad of [
      "",
      "plain",
      good.replace("scrypt$", "bcrypt$"),
      `scrypt$30000$${r}$${p}$${salt}$${key}`, // N not a power of two
      `scrypt$${2 ** 20}$${r}$${p}$${salt}$${key}`, // N too large (memory)
      `scrypt$32768$64$${p}$${salt}$${key}`, // r out of bounds
      `scrypt$32768$${r}$${p}$${salt}$c2hvcnQ`, // wrong key length
    ])
      expect(await verifyPassword(PASSWORD, bad)).toBe(false);
  });

  it("enforces 10–128 characters for new passwords", () => {
    expect(passwordPolicyError("123456789")).toMatch(/at least 10/);
    expect(passwordPolicyError("x".repeat(129))).toMatch(/at most 128/);
    expect(passwordPolicyError("x".repeat(10))).toBeUndefined();
  });
});

describe("login", () => {
  it("signs in with the right password (email is case-insensitive)", async () => {
    const r = await auth.login({ email: " Owner@Example.INVALID ", password: PASSWORD }, IP);
    expect(r).toMatchObject({ ok: true, user: { name: "Test Owner", role: "owner" } });
    if (!r.ok) return;
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt.getTime()).toBe(clock + SESSION_TTL_MS);
  });

  it("wrong password and unknown email give the identical generic error", async () => {
    const wrong = await auth.login({ email: EMAIL, password: "wrong-password-1" }, IP);
    const unknown = await auth.login({ email: "nobody@example.invalid", password: PASSWORD }, IP);
    expect(wrong).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(unknown).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(await sessionModel(conn).countDocuments()).toBe(0);
  });

  it("rejects malformed input and extra fields with the same generic error", async () => {
    for (const bad of [
      null,
      "x",
      {},
      { email: EMAIL },
      { email: EMAIL, password: 123 },
      { email: { $ne: null }, password: PASSWORD },
      { email: EMAIL, password: PASSWORD, role: "owner" },
    ])
      expect(await auth.login(bad, IP)).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(await sessionModel(conn).countDocuments()).toBe(0);
  });

  it("an inactive account cannot sign in", async () => {
    await userModel(conn).updateOne({ email: EMAIL }, { $set: { active: false } });
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, IP)).toEqual({
      ok: false,
      error: LOGIN_FAILED,
    });
  });

  it("stores only the SHA-256 hash of the session token", async () => {
    const { token } = await signIn();
    const sessions = await sessionModel(conn).collection.find().toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?._id).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(sessions)).not.toContain(token);
  });

  it("the password hash is never returned by ordinary user queries", async () => {
    const plain = await userModel(conn).findOne({ email: EMAIL }).lean();
    expect(plain && "passwordHash" in plain).toBe(false);
  });
});

describe("failed-login limit (5 per email + IP per 15 minutes, in memory)", () => {
  const fail = () => auth.login({ email: EMAIL, password: "wrong-password-1" }, IP);

  it("blocks the 6th attempt, even with the right password, then allows again after 15 minutes", async () => {
    for (let i = 0; i < 5; i++) expect(await fail()).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, IP)).toEqual({
      ok: false,
      error: LOGIN_THROTTLED,
    });
    clock += 15 * 60 * 1000;
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
  });

  it("counts per email and IP, and a successful login resets the count", async () => {
    for (let i = 0; i < 5; i++) await fail();
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, "198.51.100.9")).ok).toBe(true);
    clock += 15 * 60 * 1000;
    for (let i = 0; i < 4; i++) await fail();
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await fail();
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
  });

  it("keeps its memory bounded", () => {
    const limiter = createLoginLimiter({ maxFailures: 5, windowMs: 1000 }, 3);
    for (let i = 0; i < 10; i++) limiter.fail(`k${i}`, 0);
    expect(limiter.blocked("k0", 0)).toBe(false); // evicted, not retained forever
  });
});

describe("sessions: lookup, expiry, logout", () => {
  it("resolves to the user's id, name and role only", async () => {
    const { token } = await signIn();
    const user = await auth.resolveSession(token);
    expect(user).toEqual({ id: expect.stringMatching(/^usr_/), name: "Test Owner", role: "owner" });
  });

  it("is valid just before 7 days and rejected (and deleted) at 7 days", async () => {
    const { token } = await signIn();
    clock += SESSION_TTL_MS - 1;
    expect(await auth.resolveSession(token)).toBeDefined();
    clock += 1;
    expect(await auth.resolveSession(token)).toBeUndefined();
    expect(await sessionModel(conn).countDocuments()).toBe(0);
  });

  it("logout ends that session only; logging out twice or with junk is harmless", async () => {
    const a = await signIn();
    const b = await signIn();
    await auth.logout(a.token);
    expect(await auth.resolveSession(a.token)).toBeUndefined();
    expect(await auth.resolveSession(b.token)).toBeDefined();
    await auth.logout(a.token);
    await auth.logout({ $ne: null });
    await auth.logout(undefined);
    expect(await auth.resolveSession(b.token)).toBeDefined();
  });

  it("deactivating the account ends access immediately", async () => {
    const { token } = await signIn();
    await userModel(conn).updateOne({ email: EMAIL }, { $set: { active: false } });
    expect(await auth.resolveSession(token)).toBeUndefined();
  });

  it("rejects missing, malformed, forged and query-object tokens", async () => {
    await signIn();
    for (const t of [undefined, "", "short", "A".repeat(43), { $ne: null }, ["x"]])
      expect(await auth.resolveSession(t)).toBeUndefined();
  });
});

describe("authorization: owner-only operations", () => {
  it("requireOwner refuses without a valid session", async () => {
    const { token } = await signIn();
    for (const t of [undefined, "A".repeat(43), { $ne: null }])
      await expect(auth.requireOwner(t)).rejects.toThrow(new AuthError(NOT_SIGNED_IN));
    clock += SESSION_TTL_MS;
    await expect(auth.requireOwner(token)).rejects.toThrow(NOT_SIGNED_IN);
  });

  it("a non-owner role (e.g. a future employee) is refused with 'Not allowed.'", async () => {
    // Simulates a later employee account, written directly because the schema only allows owners.
    // The raw driver collection accepts any document shape, so no type assertion is needed.
    if (!conn.db) throw new Error("not connected");
    type RawUser = {
      _id: string;
      email: string;
      name: string;
      role: string;
      passwordHash: string;
      active: boolean;
    };
    await conn.db.collection<RawUser>("users").insertOne({
      _id: "usr_employee",
      email: "staff@example.invalid",
      name: "Staff",
      role: "employee",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
    });
    const r = await auth.login({ email: "staff@example.invalid", password: PASSWORD }, IP);
    if (!r.ok) throw new Error(r.error);
    await expect(auth.requireOwner(r.token)).rejects.toThrow(new AuthError(NOT_ALLOWED));
  });

  it("owner-only product cost is reachable only after requireOwner succeeds", async () => {
    const products = createProductService(conn);
    const created = await products.createProduct({
      name: "Towel",
      sku: "LX-AUTH-1",
      category: "accessories",
      price: 500,
      minimumSellingPrice: 350,
      cost: 200,
      lowStockThreshold: 1,
      variants: [{ sku: "LX-AUTH-1" }],
    });
    if (!created.ok) throw new Error(created.error);
    const costFor = async (token: unknown) => {
      await auth.requireOwner(token); // the gate every owner-only server function uses
      return (await products.getProductForOwner(created.data.id))?.cost;
    };
    await expect(costFor(undefined)).rejects.toThrow(NOT_SIGNED_IN);
    const { token } = await signIn();
    expect(await costFor(token)).toBe(200);
    expect(JSON.stringify(await products.getProduct(created.data.id))).not.toContain("cost");
  });
});

describe("no public owner creation, no role escalation", () => {
  it("first-owner setup refuses when an owner exists", async () => {
    expect(
      await auth.createFirstOwner({ email: "x@example.invalid", name: "X", password: PASSWORD }),
    ).toEqual({ ok: false, error: "An owner account already exists." });
  });

  it("the database itself allows only one owner, even bypassing the service", async () => {
    await expect(
      userModel(conn).create({
        _id: "usr_second",
        email: "second@example.invalid",
        name: "Second",
        role: "owner",
        passwordHash: await hashPassword(PASSWORD),
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("concurrent first-owner setups create exactly one owner", async () => {
    await userModel(conn).collection.deleteMany({});
    const results = await Promise.all(
      ["a", "b", "c"].map((n) =>
        auth.createFirstOwner({ email: `${n}@example.invalid`, name: n, password: PASSWORD }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await userModel(conn).countDocuments({ role: "owner" })).toBe(1);
  });

  it("setup input cannot carry a role or other extra fields; weak passwords are refused", async () => {
    await userModel(conn).collection.deleteMany({});
    expect(
      (
        await auth.createFirstOwner({
          email: EMAIL,
          name: "X",
          password: PASSWORD,
          role: "employee",
        })
      ).ok,
    ).toBe(false);
    expect(
      await auth.createFirstOwner({ email: EMAIL, name: "X", password: "short" }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/at least 10/) });
    expect(await userModel(conn).countDocuments()).toBe(0);
  });

  it("no browser-reachable code can create accounts", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f}`)
      .filter(
        (f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/server/") && !f.startsWith("src/test/"),
      );
    for (const f of files)
      expect(readFileSync(f, "utf8")).not.toMatch(/createFirstOwner|userModel/);
  });
});

describe("database failures", () => {
  it("login surfaces only a generic DatabaseUnavailableError", async () => {
    const dead = mongoose.createConnection();
    await dead.openUri(server.getUri(), { ...connectOptions(true), dbName: "luxe_auth_test" });
    const service = createAuthService(dead, { now, limiter: createLoginLimiter() });
    await dead.destroy();
    const err = await service
      .login({ email: EMAIL, password: PASSWORD }, IP)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(String(err)).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
  });
});

describe("cookie and configuration", () => {
  it("production cookie: __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/", () => {
    const expires = new Date(clock + SESSION_TTL_MS);
    expect(sessionCookieName(true)).toBe("__Host-luxe_session");
    expect(sessionCookieOptions(true, expires)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
  });

  it("local development cookie works on http://localhost (not Secure), still HttpOnly", () => {
    expect(sessionCookieName(false)).toBe("luxe_session");
    expect(sessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });
  });

  it("the dev server is bound to 127.0.0.1", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toMatch(/server:\s*\{\s*host:\s*"127\.0\.0\.1"/);
  });

  it("the framework CSRF check stays on for server functions, with no bypass", () => {
    const start = readFileSync("src/start.ts", "utf8");
    expect(start).toMatch(/createCsrfMiddleware\(/);
    expect(start).toMatch(/handlerType === "serverFn"/);
    expect(start).not.toMatch(/allowRequestsWithoutOriginCheck/);
  });

  it("login and logout change state, so they are POST-only; auth code loads server-side only", () => {
    const src = readFileSync("src/lib/auth.ts", "utf8");
    expect(src).toMatch(/export const login = createServerFn\(\{ method: "POST" \}\)/);
    expect(src).toMatch(/export const logout = createServerFn\(\{ method: "POST" \}\)/);
    expect(src).not.toMatch(/^import .*\.server/m);
  });
});
