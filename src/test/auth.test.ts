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
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_ADDRESS_LIMIT,
  LOGIN_FAILED,
  LOGIN_THROTTLED,
  loginAddressKey,
  NOT_ALLOWED,
  NOT_SIGNED_IN,
  SESSION_TTL_MS,
} from "@/server/auth/auth.server";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/cookie.server";
import {
  createConcurrencyLimit,
  HASH_CONCURRENCY,
  hashPassword,
  passwordHashing,
  PasswordHashingBusyError,
  passwordPolicyError,
  verifyPassword,
} from "@/server/auth/password.server";
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
const freshLimiters = () => ({
  limiter: createLoginLimiter(),
  addressLimiter: createLoginLimiter(LOGIN_ADDRESS_LIMIT),
  accountLimiter: createLoginLimiter(LOGIN_ACCOUNT_LIMIT),
});
/** A fresh service + attempt counters per test, sharing the controllable clock. */
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
  auth = createAuthService(conn, { now, ...freshLimiters() });
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
    for (let i = 0; i < 10; i++) limiter.tryAttempt(`k${i}`, 0);
    expect(limiter.blocked("k0", 0)).toBe(false); // evicted, not retained forever
  });

  it("simultaneous wrong attempts: exactly 5 passwords are checked, the rest are refused", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, fail));
    expect(results.filter((r) => !r.ok && r.error === LOGIN_FAILED)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error === LOGIN_THROTTLED)).toHaveLength(25);
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, IP)).toEqual({
      ok: false,
      error: LOGIN_THROTTLED,
    });
    clock += 15 * 60 * 1000;
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
  });

  it("the owner can still sign in from another address during a simultaneous attack", async () => {
    const [own, ...attack] = await Promise.all([
      auth.login({ email: EMAIL, password: PASSWORD }, "198.51.100.9"),
      ...Array.from({ length: 20 }, fail),
    ]);
    expect(own?.ok).toBe(true);
    expect(attack.every((r) => !r.ok)).toBe(true);
  });
});

// Up to ~40 real scrypt checks per test, so allow more than the default 5 s.
describe(
  "per-address limit (20 per address across all emails per 15 minutes)",
  { timeout: 60_000 },
  () => {
    const OTHER_IP = "198.51.100.9";
    const unknown = (i: number, ip = IP) =>
      auth.login({ email: `rotate${i}@example.invalid`, password: PASSWORD }, ip);
    const owner = (ip = IP) => auth.login({ email: EMAIL, password: PASSWORD }, ip);
    const throttled = { ok: false, error: LOGIN_THROTTLED };

    it("is 20 attempts per 15 minutes", () => {
      expect(LOGIN_ADDRESS_LIMIT).toEqual({ maxFailures: 20, windowMs: 15 * 60 * 1000 });
    });

    it("rotating emails from one address: 20 checks, then refused even for the owner; the owner signs in elsewhere", async () => {
      for (let i = 0; i < 20; i++)
        expect(await unknown(i)).toEqual({ ok: false, error: LOGIN_FAILED });
      expect(await unknown(20)).toEqual(throttled);
      expect(await owner()).toEqual(throttled);
      expect((await owner(OTHER_IP)).ok).toBe(true);
      clock += 15 * 60 * 1000;
      expect((await owner()).ok).toBe(true);
    });

    it("simultaneous rotation is counted before hashing: only the remaining allowance is checked", async () => {
      await unknown(-1, OTHER_IP); // dummy hash ready, so each attempt below needs one hashing slot
      for (let i = 0; i < 15; i++) await unknown(i);
      // 10 at once fit the hashing limit (2 running + 8 waiting), so only the address limit refuses.
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => unknown(100 + i)));
      expect(results.filter((r) => !r.ok && r.error === LOGIN_FAILED)).toHaveLength(5);
      expect(results.filter((r) => !r.ok && r.error === LOGIN_THROTTLED)).toHaveLength(5);
    });

    it("attempts refused by the per-email limit do not use up the address's allowance", async () => {
      for (let i = 0; i < 5; i++)
        expect(await auth.login({ email: EMAIL, password: "wrong-password-1" }, IP)).toEqual({
          ok: false,
          error: LOGIN_FAILED,
        });
      for (let i = 0; i < 10; i++) expect(await owner()).toEqual(throttled);
      for (let i = 0; i < 15; i++)
        expect(await unknown(i)).toEqual({ ok: false, error: LOGIN_FAILED });
      expect(await unknown(15)).toEqual(throttled);
    });

    it("a correct password does not count against the address", async () => {
      for (let i = 0; i < 19; i++) await unknown(i);
      expect((await owner()).ok).toBe(true);
      expect(await unknown(19)).toEqual({ ok: false, error: LOGIN_FAILED });
      expect(await unknown(20)).toEqual(throttled);
    });

    it("IPv6 counts per /64; IPv4-mapped IPv6 counts as IPv4", async () => {
      expect(loginAddressKey("2001:db8:1:2::5")).toBe("2001:db8:1:2::/64");
      expect(loginAddressKey("2001:0DB8:0001:0002:ffff:1:2:3")).toBe("2001:db8:1:2::/64");
      expect(loginAddressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
      expect(loginAddressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
      expect(loginAddressKey("::1")).toBe("0:0:0:0::/64");
      expect(loginAddressKey("::ffff:203.0.113.7")).toBe(IP);
      expect(loginAddressKey(IP)).toBe(IP);
      for (const odd of ["unknown", "1::2::3", "1:2:3:4:5:6:7:8:9", "zz::1"])
        expect(loginAddressKey(odd)).toBe(odd);

      for (let i = 0; i < 20; i++) await unknown(i, `2001:db8:1:2::${i + 1}`);
      expect(await owner("2001:db8:1:2:ffff:ffff:ffff:ffff")).toEqual(throttled);
      expect((await owner("2001:db8:1:3::1")).ok).toBe(true);
    });
  },
);

// The behaviour tests use a small per-account limit (3) so they need few real scrypt checks.
describe("per-account limit (50 per email across all addresses per 15 minutes)", () => {
  const throttled = { ok: false, error: LOGIN_THROTTLED };
  const failed = { ok: false, error: LOGIN_FAILED };
  const small = (maxFailures = 3) => ({
    ...freshLimiters(),
    accountLimiter: createLoginLimiter({ maxFailures, windowMs: 15 * 60 * 1000 }),
  });
  const addr = (i: number) => `198.51.100.${i + 1}`;

  it("is 50 attempts per 15 minutes, above the per-address limit", () => {
    expect(LOGIN_ACCOUNT_LIMIT).toEqual({ maxFailures: 50, windowMs: 15 * 60 * 1000 });
    expect(LOGIN_ACCOUNT_LIMIT.maxFailures).toBeGreaterThan(LOGIN_ADDRESS_LIMIT.maxFailures);
  });

  it("blocks an account attacked from many addresses, even with the right password; other accounts are unaffected", async () => {
    auth = createAuthService(conn, { now, ...small() });
    for (let i = 0; i < 3; i++)
      expect(await auth.login({ email: EMAIL, password: "wrong-password-1" }, addr(i))).toEqual(
        failed,
      );
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, addr(9))).toEqual(throttled);
    expect(
      await auth.login({ email: "someone@example.invalid", password: PASSWORD }, addr(9)),
    ).toEqual(failed);
    clock += 15 * 60 * 1000;
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, addr(9))).ok).toBe(true);
  });

  it("applies identically to an email with no account (does not reveal which accounts exist)", async () => {
    const run = async (email: string) => {
      auth = createAuthService(conn, { now, ...small() });
      const out = [];
      for (let i = 0; i < 4; i++)
        out.push(await auth.login({ email, password: "wrong-password-1" }, addr(i)));
      return out;
    };
    const existing = await run(EMAIL);
    expect(existing).toEqual([failed, failed, failed, throttled]);
    expect(await run("nobody@example.invalid")).toEqual(existing);
  });

  it("counts the normalized email (case and spaces do not give more attempts)", async () => {
    auth = createAuthService(conn, { now, ...small() });
    for (const email of [
      "Owner@Example.INVALID",
      " owner@example.invalid ",
      "OWNER@example.invalid",
    ])
      expect(await auth.login({ email, password: "wrong-password-1" }, addr(0))).toEqual(failed);
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, addr(1))).toEqual(throttled);
  });

  it("simultaneous attempts from many addresses: exactly the limit is checked; refusals use no address allowance", async () => {
    const limiters = {
      ...small(),
      addressLimiter: createLoginLimiter({ maxFailures: 1, windowMs: 15 * 60 * 1000 }),
    };
    auth = createAuthService(conn, { now, ...limiters });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        auth.login({ email: EMAIL, password: "wrong-password-1" }, addr(i)),
      ),
    );
    expect(results.filter((r) => !r.ok && r.error === LOGIN_FAILED)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.error === LOGIN_THROTTLED)).toHaveLength(7);
    // Each address allows 1 attempt: only the 3 checked addresses have used theirs.
    const next = await Promise.all(
      results.map((_, i) =>
        auth.login({ email: `other${i}@example.invalid`, password: PASSWORD }, addr(i)),
      ),
    );
    results.forEach((r, i) =>
      expect(next[i]).toEqual(r.ok === false && r.error === LOGIN_FAILED ? throttled : failed),
    );
  });

  it("a correct password does not count against the account", async () => {
    auth = createAuthService(conn, { now, ...small(2) });
    expect(await auth.login({ email: EMAIL, password: "wrong-password-1" }, addr(0))).toEqual(
      failed,
    );
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, addr(1))).ok).toBe(true);
    expect(await auth.login({ email: EMAIL, password: "wrong-password-1" }, addr(2))).toEqual(
      failed,
    );
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, addr(3))).toEqual(throttled);
  });

  it("attempts that fail on a database error are not counted against the account", async () => {
    const limiters = small(1);
    const dead = mongoose.createConnection();
    await dead.openUri(server.getUri(), { ...connectOptions(true), dbName: "luxe_auth_test" });
    const down = createAuthService(dead, { now, ...limiters });
    await dead.destroy();
    for (let i = 0; i < 3; i++)
      await expect(
        down.login({ email: EMAIL, password: "wrong-password-1" }, addr(i)),
      ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    auth = createAuthService(conn, { now, ...limiters });
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, addr(5))).ok).toBe(true);
  });

  it("keeps its memory bounded like the other limits (same limiter, 10 000-key cap)", () => {
    const source = readFileSync("src/server/auth/auth.server.ts", "utf8");
    expect(source).toMatch(
      /export const accountLoginLimiter = createLoginLimiter\(LOGIN_ACCOUNT_LIMIT\);/,
    );
    expect(source).toMatch(/maxKeys = 10_000/);
  });
});

// Up to ~25 real scrypt checks per test.
describe("no client address: no shared bucket", { timeout: 60_000 }, () => {
  const throttled = { ok: false, error: LOGIN_THROTTLED };
  const failed = { ok: false, error: LOGIN_FAILED };

  it("unknown-address attempts never share an address limit; only the per-account limit applies", async () => {
    // More than the 20-per-address limit, from clients whose address is unknown.
    for (let i = 0; i < 25; i++)
      expect(
        await auth.login({ email: `rotate${i}@example.invalid`, password: PASSWORD }, undefined),
      ).toEqual(failed);
    // Another unknown-address client is not locked out by them, nor is a known address.
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, undefined)).ok).toBe(true);
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
  });

  it("the per-account limit still applies without an address", async () => {
    auth = createAuthService(conn, {
      now,
      ...freshLimiters(),
      accountLimiter: createLoginLimiter({ maxFailures: 3, windowMs: 15 * 60 * 1000 }),
    });
    for (let i = 0; i < 3; i++)
      expect(await auth.login({ email: EMAIL, password: "wrong-password-1" }, undefined)).toEqual(
        failed,
      );
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, undefined)).toEqual(throttled);
    expect(await auth.login({ email: EMAIL, password: PASSWORD }, IP)).toEqual(throttled);
    expect(
      await auth.login({ email: "someone@example.invalid", password: PASSWORD }, undefined),
    ).toEqual(failed);
  });

  it("the login bridge has no shared fallback such as 'unknown'", () => {
    const source = readFileSync("src/server/auth/session-context.server.ts", "utf8");
    expect(source).toMatch(/const ip = loginClientAddress\(\{/);
    expect(source).not.toMatch(/"unknown"|xForwardedFor/);
  });
});

describe("password hashing concurrency limit", () => {
  /** A task that stays running until `open()` is called. */
  const gate = () => {
    let open = () => {};
    const done = new Promise<void>((resolve) => (open = resolve));
    return { open, task: () => done };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs at most maxActive at once, queues maxQueued, refuses the rest without running them", async () => {
    const limit = createConcurrencyLimit({ maxActive: 2, maxQueued: 3 });
    const gates = Array.from({ length: 5 }, gate);
    const running = gates.map((g) => limit.run(g.task));
    await flush();
    expect(limit.stats()).toEqual({ active: 2, queued: 3 });
    let ran = false;
    await expect(limit.run(async () => void (ran = true))).rejects.toBeInstanceOf(
      PasswordHashingBusyError,
    );
    expect(ran).toBe(false);
    gates[0]?.open();
    await flush();
    expect(limit.stats()).toEqual({ active: 2, queued: 2 }); // slot handed to a waiter
    for (const g of gates) g.open();
    await Promise.all(running);
    expect(limit.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("releases its slot when a task fails", async () => {
    const limit = createConcurrencyLimit({ maxActive: 1, maxQueued: 0 });
    await expect(limit.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limit.run(() => Promise.resolve("ok"))).toBe("ok");
  });

  it("the server allows 2 hashes at once and 8 waiting", () => {
    expect(HASH_CONCURRENCY).toEqual({ maxActive: 2, maxQueued: 8 });
  });

  it("when hashing is full, login hashes nothing, answers 'Too many attempts', and does not count it", async () => {
    const fill = Array.from(
      { length: HASH_CONCURRENCY.maxActive + HASH_CONCURRENCY.maxQueued },
      gate,
    );
    const held = fill.map((g) => passwordHashing.run(g.task));
    await flush();
    try {
      for (let i = 0; i < 8; i++)
        expect(await auth.login({ email: EMAIL, password: PASSWORD }, IP)).toEqual({
          ok: false,
          error: LOGIN_THROTTLED,
        });
      expect(await auth.login({ email: "nobody@example.invalid", password: PASSWORD }, IP)).toEqual(
        { ok: false, error: LOGIN_THROTTLED },
      );
    } finally {
      for (const g of fill) g.open();
      await Promise.all(held);
    }
    // The busy refusals were not counted: all 5 failures are still available, then the limit.
    for (let i = 0; i < 5; i++)
      expect(await auth.login({ email: EMAIL, password: "wrong-password-1" }, IP)).toEqual({
        ok: false,
        error: LOGIN_FAILED,
      });
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(false);
    clock += 15 * 60 * 1000;
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
  });

  it("a flood of unknown emails never leaves hashing slots in use", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        auth.login({ email: `flood${i}@example.invalid`, password: PASSWORD }, IP),
      ),
    );
    for (const r of results)
      expect([LOGIN_FAILED, LOGIN_THROTTLED]).toContain(r.ok ? "signed in" : r.error);
    expect(passwordHashing.stats()).toEqual({ active: 0, queued: 0 });
    expect((await auth.login({ email: EMAIL, password: PASSWORD }, IP)).ok).toBe(true);
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
    const service = createAuthService(dead, { now, ...freshLimiters() });
    await dead.destroy();
    const err = await service
      .login({ email: EMAIL, password: PASSWORD }, IP)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(String(err)).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
  });

  it("attempts that fail on a database error are not counted by either limit", async () => {
    const limiters = freshLimiters();
    const dead = mongoose.createConnection();
    await dead.openUri(server.getUri(), { ...connectOptions(true), dbName: "luxe_auth_test" });
    const down = createAuthService(dead, { now, ...limiters });
    await dead.destroy();
    for (let i = 0; i < 25; i++)
      await expect(
        down.login({ email: EMAIL, password: "wrong-password-1" }, IP),
      ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(passwordHashing.stats()).toEqual({ active: 0, queued: 0 });
    // Same counters, working database: the full per-email allowance is still there.
    const up = createAuthService(conn, { now, ...limiters });
    for (let i = 0; i < 5; i++)
      expect(await up.login({ email: EMAIL, password: "wrong-password-1" }, IP)).toEqual({
        ok: false,
        error: LOGIN_FAILED,
      });
    expect(await up.login({ email: EMAIL, password: PASSWORD }, IP)).toEqual({
      ok: false,
      error: LOGIN_THROTTLED,
    });
    // ...and of the per-address allowance (5 used above, 15 left).
    for (let i = 0; i < 15; i++)
      expect(
        await up.login({ email: `other${i}@example.invalid`, password: PASSWORD }, IP),
      ).toEqual({ ok: false, error: LOGIN_FAILED });
    expect(await up.login({ email: "other99@example.invalid", password: PASSWORD }, IP)).toEqual({
      ok: false,
      error: LOGIN_THROTTLED,
    });
  }, 60_000);
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
