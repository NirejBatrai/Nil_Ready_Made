// @vitest-environment node
/**
 * MongoDB foundation tests. Fake connections for logic; real Mongoose only for its local
 * connection-list behaviour (localhost-only, no database, no credentials).
 */
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectOptions,
  createDatabaseAccess,
  DatabaseUnavailableError,
  isWorkersRuntime,
  openMongoose,
  readMongoUri,
  type ManagedConnection,
} from "@/server/db.server";
import { createHealthCheck, healthCheckEnabled } from "@/server/health.server";

// Obviously fake values, joined at runtime so no credential-shaped literal exists in the source.
// `.invalid` is a reserved top-level domain (RFC 2606) that can never resolve.
const FAKE_USER = "fake-test-user";
const FAKE_PASSWORD = "NOT-A-REAL-PASSWORD";
const FAKE_HOST = "db.example.invalid";
const FAKE_URI = [
  "mongodb",
  "://",
  FAKE_USER,
  ":",
  FAKE_PASSWORD,
  "@",
  FAKE_HOST,
  "/luxe-test",
].join("");
const SECRET_PARTS = [FAKE_PASSWORD, FAKE_USER, FAKE_HOST, FAKE_URI];

class FakeConnection implements ManagedConnection {
  readyState = 1;
  destroyed = 0;
  async destroy() {
    this.destroyed++;
    this.readyState = 0;
  }
}

function setup(opts: { reuse: boolean; env?: Record<string, string | undefined> }) {
  const opened: FakeConnection[] = [];
  let failWith: Error | undefined;
  const open = vi.fn(async () => {
    if (failWith) throw failWith;
    const c = new FakeConnection();
    opened.push(c);
    return c;
  });
  const access = createDatabaseAccess<FakeConnection>({
    open,
    reuse: () => opts.reuse,
    env: () => opts.env ?? { MONGODB_URI: FAKE_URI },
  });
  return {
    access,
    open,
    opened,
    fail: (e: Error | undefined) => {
      failWith = e;
    },
  };
}

const expectNoSecrets = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const s of SECRET_PARTS) expect(text).not.toContain(s);
};

afterEach(() => vi.restoreAllMocks());

describe("MONGODB_URI configuration", () => {
  it("reports missing or blank values as not configured", () => {
    expect(readMongoUri({})).toEqual({ ok: false, reason: "not_configured" });
    expect(readMongoUri({ MONGODB_URI: "   " })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("rejects values that are not MongoDB connection strings, without echoing them", () => {
    const r = readMongoUri({ MONGODB_URI: ["https://", FAKE_PASSWORD, "@", FAKE_HOST].join("") });
    expect(r).toEqual({ ok: false, reason: "invalid_config" });
    expectNoSecrets(r);
  });

  it("accepts mongodb:// and mongodb+srv:// strings", () => {
    expect(readMongoUri({ MONGODB_URI: ` ${FAKE_URI} ` })).toEqual({ ok: true, uri: FAKE_URI });
    expect(readMongoUri({ MONGODB_URI: `mongodb+srv://${FAKE_HOST}/luxe-test` }).ok).toBe(true);
  });
});

describe("connection options", () => {
  it("use a small pool, short timeouts, no buffering and no automatic index/collection creation", () => {
    for (const perRequest of [true, false]) {
      const o = connectOptions(perRequest);
      expect(o.maxPoolSize).toBeLessThanOrEqual(5);
      expect(o.serverSelectionTimeoutMS).toBe(5_000);
      expect(o.connectTimeoutMS).toBe(5_000);
      expect(o).toMatchObject({ bufferCommands: false, autoIndex: false, autoCreate: false });
    }
    expect(connectOptions(true).maxPoolSize).toBe(1);
  });

  it("detects Node.js as not a Workers runtime", () => {
    expect(isWorkersRuntime()).toBe(false);
  });
});

describe("connection reuse", () => {
  it("Node.js mode shares one connection across sequential and concurrent calls", async () => {
    const { access, open } = setup({ reuse: true });
    await access.withDatabase(async () => 1);
    await Promise.all([1, 2, 3].map(() => access.withDatabase(async () => 1)));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("Node.js mode replaces a dropped shared connection and destroys the old one", async () => {
    const { access, open, opened } = setup({ reuse: true });
    await access.withDatabase(async () => 1);
    const first = opened[0] as FakeConnection;
    first.readyState = 0; // the driver lost the connection
    await access.withDatabase(async () => 1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(first.destroyed).toBe(1);
  });

  it("shutdown destroys the shared connection", async () => {
    const { access, opened } = setup({ reuse: true });
    await access.withDatabase(async () => 1);
    await access.shutdown();
    expect((opened[0] as FakeConnection).destroyed).toBe(1);
  });

  it("Workers mode opens a separate connection per call and always destroys it", async () => {
    const { access, open, opened } = setup({ reuse: false });
    await access.withDatabase(async () => 1);
    await expect(
      access.withDatabase(async () => {
        throw new Error("query failed");
      }),
    ).rejects.toThrow("query failed");
    expect(open).toHaveBeenCalledTimes(2);
    expect(opened.map((c) => c.destroyed)).toEqual([1, 1]);
  });

  it("a failed connection is not cached; the next call retries", async () => {
    const { access, open, fail } = setup({ reuse: true });
    fail(new Error(`connect ECONNREFUSED ${FAKE_URI}`));
    await expect(access.withDatabase(async () => 1)).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    fail(undefined);
    await expect(access.withDatabase(async () => "ok")).resolves.toBe("ok");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("never opens a connection when MONGODB_URI is missing", async () => {
    const { access, open } = setup({ reuse: true, env: {} });
    await expect(access.withDatabase(async () => 1)).rejects.toMatchObject({
      reason: "not_configured",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("driver errors are replaced by a generic error with no URI, credentials or cause", async () => {
    const { access, fail } = setup({ reuse: false });
    fail(new Error(`bad auth for user ${FAKE_USER} on ${FAKE_URI}`));
    const err = await access.withDatabase(async () => 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(err).toMatchObject({ reason: "unavailable" });
    expect((err as Error).cause).toBeUndefined();
    expectNoSecrets(String(err));
    expectNoSecrets((err as Error).stack ?? "");
  });
});

describe("health check (development-only diagnostic)", () => {
  const ping = vi.fn(async (_c: FakeConnection) => {});

  it("is disabled outside development unless explicitly enabled on the server", () => {
    expect(healthCheckEnabled(true, {})).toBe(true);
    expect(healthCheckEnabled(false, {})).toBe(false);
    expect(healthCheckEnabled(false, { DB_HEALTHCHECK_ENABLED: "1" })).toBe(false);
    expect(healthCheckEnabled(false, { DB_HEALTHCHECK_ENABLED: "true" })).toBe(true);
  });

  it("does not touch the database when disabled", async () => {
    const { access, open } = setup({ reuse: true });
    expect(await createHealthCheck(access, ping)(false)).toEqual({ status: "disabled" });
    expect(open).not.toHaveBeenCalled();
  });

  it("reports ok, not_configured or unavailable — and nothing else", async () => {
    const good = setup({ reuse: false });
    expect(await createHealthCheck(good.access, ping)(true)).toEqual({ status: "ok" });

    const missing = setup({ reuse: false, env: {} });
    expect(await createHealthCheck(missing.access, ping)(true)).toEqual({
      status: "not_configured",
    });
    const invalid = setup({ reuse: false, env: { MONGODB_URI: "postgres://x" } });
    expect(await createHealthCheck(invalid.access, ping)(true)).toEqual({
      status: "not_configured",
    });

    const down = setup({ reuse: false });
    down.fail(new Error(`querySrv ENOTFOUND ${FAKE_URI}`));
    const result = await createHealthCheck(down.access, ping)(true);
    expect(result).toEqual({ status: "unavailable" });
    expectNoSecrets(result);

    const pingFails = setup({ reuse: false });
    const badPing = async () => {
      throw new Error(`not authorized on admin to execute command; user ${FAKE_USER}`);
    };
    expect(await createHealthCheck(pingFails.access, badPing)(true)).toEqual({
      status: "unavailable",
    });
  });

  it("never writes the URI or credentials to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const down = setup({ reuse: true });
    down.fail(new Error(`bad auth ${FAKE_URI}`));
    await createHealthCheck(down.access, ping)(true);
    for (const spy of spies) for (const call of spy.mock.calls) expectNoSecrets(call.map(String));
  });
});

describe("Mongoose connection lifecycle (real Mongoose, no database)", () => {
  it("close() keeps a connection in mongoose.connections; destroy() removes it", async () => {
    const kept = mongoose.createConnection();
    await kept.close();
    expect(mongoose.connections).toContain(kept);
    await kept.destroy(); // clean up this test's own connection

    const released = mongoose.createConnection();
    await released.destroy();
    expect(mongoose.connections).not.toContain(released);
  });

  it("a failed open leaves no connection behind and reports only a generic error", async () => {
    const before = mongoose.connections.length;
    // Port 1 on localhost: nothing listens there, so the connection is refused quickly.
    const err = await openMongoose("mongodb://127.0.0.1:1/luxe-test", {
      ...connectOptions(true),
      serverSelectionTimeoutMS: 300,
      connectTimeoutMS: 300,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(err).toMatchObject({ reason: "unavailable" });
    expect(mongoose.connections.length).toBe(before);
  });
});

describe("browser bundle boundary", () => {
  it("the client-importable server function loads database code only via a server-side dynamic import", () => {
    const src = readFileSync("src/lib/db-health.ts", "utf8");
    expect(src).not.toMatch(/^import .*(mongoose|mongodb|\.server)/m);
    expect(src).toMatch(/await import\("@\/server\/health\.server"\)/);
  });
});
