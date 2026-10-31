// @vitest-environment node
/**
 * MongoDB-backed login limiter (src/server/auth/login-limiter.server.ts) against an ISOLATED,
 * throwaway MongoDB (mongodb-memory-server on 127.0.0.1) whose TTL monitor runs every second
 * instead of every minute. Never reads MONGODB_URI or .env and never touches Atlas.
 */
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAuthIndexes } from "@/server/auth/auth.server";
import { createLoginLimiter, type LoginLimit } from "@/server/auth/login-limiter.server";
import { connectOptions, DatabaseUnavailableError } from "@/server/db.server";
import {
  LOGIN_ATTEMPT_TTL_INDEX,
  loginAttemptModel,
  type LoginAttemptDoc,
} from "@/server/models/login-attempt.server";

const WINDOW = 15 * 60 * 1000;
const limit = (maxFailures: number, windowMs = WINDOW): LoginLimit => ({ maxFailures, windowMs });

let server: MongoMemoryServer;
/** Two connections to one database stand for two server instances (e.g. Vercel functions). */
let conn: Connection;
let other: Connection;

const open = async () => {
  const c = mongoose.createConnection();
  await c.openUri(server.getUri(), { ...connectOptions(false), dbName: "luxe_limiter_test" });
  return c;
};
const stored = () => {
  if (!conn.db) throw new Error("not connected");
  return conn.db.collection<LoginAttemptDoc>("login_attempts").find().toArray();
};

beforeAll(async () => {
  server = await MongoMemoryServer.create({
    instance: { ip: "127.0.0.1", args: ["--setParameter", "ttlMonitorSleepSecs=1"] },
  });
  // Safety: only ever a local, credential-free test database.
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(server.getUri()))
    throw new Error("Refusing non-local test DB");
  conn = await open();
  other = await open();
  await ensureAuthIndexes(conn);
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await other?.destroy();
  await server?.stop();
});

beforeEach(async () => {
  await loginAttemptModel(conn).collection.deleteMany({});
});

describe("counting", () => {
  it("counts up to the limit, then refuses without recording the refused attempt", async () => {
    const l = createLoginLimiter(conn, "address", limit(3));
    const now = Date.now();
    for (let i = 0; i < 3; i++) expect(await l.tryAttempt("k", now + i)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await l.tryAttempt("k", now + 3)).toBeUndefined();
    expect(await l.tryAttempt("k", now + 4)).toBeUndefined();
    expect(await l.count("k", now + 5)).toBe(3);
    const [doc] = await stored();
    expect(doc?._id).toBe("address|k");
    expect(doc?.entries).toHaveLength(3);
  });

  it("is a sliding window: attempts older than the window stop counting and are dropped", async () => {
    const l = createLoginLimiter(conn, "address", limit(2));
    const t = Date.now();
    await l.tryAttempt("k", t);
    await l.tryAttempt("k", t + 60_000);
    expect(await l.tryAttempt("k", t + WINDOW - 1)).toBeUndefined();
    // The first attempt has left the window; the second still counts.
    expect(await l.tryAttempt("k", t + WINDOW)).toBeDefined();
    expect(await l.tryAttempt("k", t + WINDOW + 1)).toBeUndefined();
    const [doc] = await stored();
    expect(doc?.entries.map((e) => e.at.getTime())).toEqual([t + 60_000, t + WINDOW]);
    // expiresAt = newest attempt + window (when the TTL index may delete the document).
    expect(doc?.expiresAt.getTime()).toBe(t + 2 * WINDOW);
  });

  it("limit kinds and keys are independent; keys are literal strings, never query operators", async () => {
    const now = Date.now();
    const a = createLoginLimiter(conn, "address", limit(1));
    const b = createLoginLimiter(conn, "account", limit(1));
    expect(await a.tryAttempt("same", now)).toBeDefined();
    expect(await b.tryAttempt("same", now)).toBeDefined();
    expect(await a.tryAttempt("other", now)).toBeDefined();
    for (const odd of ['{"$ne":null}', "$where", "a.b", "x|y"])
      expect(await a.tryAttempt(odd, now), odd).toBeDefined();
    expect(await a.tryAttempt('{"$ne":null}', now)).toBeUndefined();
    expect(await a.tryAttempt("same", now)).toBeUndefined();
  });
});

describe("race safety", () => {
  it("50 simultaneous attempts on a new key: exactly the limit is counted", async () => {
    const l = createLoginLimiter(conn, "email_address", limit(5));
    const now = Date.now();
    const ids = await Promise.all(Array.from({ length: 50 }, () => l.tryAttempt("race", now)));
    expect(ids.filter(Boolean)).toHaveLength(5);
    expect(new Set(ids.filter(Boolean)).size).toBe(5);
    expect(await l.count("race", now)).toBe(5);
  });

  it("counts are shared across instances: two limiters on two connections, one database", async () => {
    const a = createLoginLimiter(conn, "account", limit(5));
    const b = createLoginLimiter(other, "account", limit(5));
    const now = Date.now();
    for (let i = 0; i < 3; i++)
      expect(await a.tryAttempt("owner@example.invalid", now)).toBeDefined();
    expect(await b.tryAttempt("owner@example.invalid", now)).toBeDefined();
    expect(await b.tryAttempt("owner@example.invalid", now)).toBeDefined();
    expect(await a.tryAttempt("owner@example.invalid", now)).toBeUndefined();
    expect(await b.tryAttempt("owner@example.invalid", now)).toBeUndefined();
    // Simultaneously on both instances: still exactly the limit in total.
    const ids = await Promise.all(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).tryAttempt("split", now)),
    );
    expect(ids.filter(Boolean)).toHaveLength(5);
  });
});

describe("undo path", () => {
  it("cancel removes exactly one attempt, even among simultaneous ones with the same time", async () => {
    const l = createLoginLimiter(conn, "address", limit(3));
    const now = Date.now();
    const [first, second] = await Promise.all([l.tryAttempt("k", now), l.tryAttempt("k", now)]);
    if (!first || !second) throw new Error("not counted");
    await l.cancel("k", first);
    expect(await l.count("k", now)).toBe(1);
    expect((await stored())[0]?.entries.map((e) => e.id)).toEqual([second]);
    await l.cancel("k", first); // already cancelled: no effect
    await l.cancel("k", "not-an-attempt");
    expect(await l.count("k", now)).toBe(1);
    // A cancelled attempt frees its place.
    expect(await l.tryAttempt("k", now)).toBeDefined();
    expect(await l.tryAttempt("k", now)).toBeDefined();
    expect(await l.tryAttempt("k", now)).toBeUndefined();
  });

  it("cancelling the last attempt deletes the key's document; reset clears a key", async () => {
    const l = createLoginLimiter(conn, "address", limit(3));
    const now = Date.now();
    const id = await l.tryAttempt("k", now);
    if (!id) throw new Error("not counted");
    await l.cancel("k", id);
    expect(await stored()).toEqual([]);
    await l.tryAttempt("k", now);
    await l.tryAttempt("k", now);
    await l.reset("k");
    expect(await l.count("k", now)).toBe(0);
    expect(await stored()).toEqual([]);
  });
});

describe("TTL cleanup", () => {
  it("db:setup-indexes' auth indexes include the TTL index on expiresAt", async () => {
    const index = (await loginAttemptModel(conn).collection.indexes()).find(
      (i) => i.name === LOGIN_ATTEMPT_TTL_INDEX,
    );
    expect(index).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 0 });
  });

  it(
    "MongoDB deletes a key's document once its window has passed",
    { timeout: 30_000 },
    async () => {
      const l = createLoginLimiter(conn, "address", limit(5, 500));
      const kept = createLoginLimiter(conn, "address", limit(5));
      await l.tryAttempt("short", Date.now());
      await kept.tryAttempt("long", Date.now());
      expect((await stored()).map((d) => d._id).sort()).toEqual(["address|long", "address|short"]);
      const deadline = Date.now() + 25_000;
      while ((await stored()).some((d) => d._id === "address|short") && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 250));
      // The expired key is gone; the one still inside its window is kept.
      expect((await stored()).map((d) => d._id)).toEqual(["address|long"]);
    },
  );
});

describe("database failures", () => {
  it("surface as DatabaseUnavailableError with no details (the caller fails closed)", async () => {
    const dead = await open();
    const l = createLoginLimiter(dead, "address", limit(5));
    await dead.destroy();
    for (const op of [
      () => l.tryAttempt("k", Date.now()),
      () => l.cancel("k", "x"),
      () => l.reset("k"),
    ]) {
      const err = await op().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DatabaseUnavailableError);
      expect(String(err)).not.toMatch(/127\.0\.0\.1|mongodb:\/\//);
    }
  });
});
