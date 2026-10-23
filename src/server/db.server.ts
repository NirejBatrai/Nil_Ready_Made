/**
 * SERVER-ONLY MongoDB connection. The `.server.ts` suffix makes TanStack Start's import
 * protection reject any import of this file from browser code.
 *
 * - MONGODB_URI is read at call time, never at module load or build time.
 * - The URI, credentials and driver error messages are never logged or returned: driver errors
 *   can contain host names and usernames, so callers only ever see DatabaseUnavailableError.
 * - Connection reuse depends on the runtime:
 *   - Node.js (local `vite dev`): one shared connection per process.
 *   - Cloudflare Workers: I/O objects cannot be reused across requests, so every call opens a
 *     connection and destroys it afterwards. Pooling there needs a Durable Object (later phase).
 * - Connections are released with `destroy()`, not `close()`: both close the driver client the
 *   same way, but only `destroy()` also removes the connection from Mongoose's global
 *   `mongoose.connections` list. With `close()`, every per-request connection would stay in that
 *   list (with its connection string) for the life of the Worker isolate.
 */
import mongoose, { type Connection, type ConnectOptions } from "mongoose";

export type DatabaseFailure = "not_configured" | "invalid_config" | "unavailable";

/** Safe to show or log: carries only a failure category, never connection details. */
export class DatabaseUnavailableError extends Error {
  constructor(readonly reason: DatabaseFailure) {
    super(`Database ${reason.replace("_", " ")}.`);
    this.name = "DatabaseUnavailableError";
  }
}

/** Validates MONGODB_URI without ever echoing it. */
export function readMongoUri(
  env: Record<string, string | undefined>,
): { ok: true; uri: string } | { ok: false; reason: "not_configured" | "invalid_config" } {
  const uri = env["MONGODB_URI"]?.trim();
  if (!uri) return { ok: false, reason: "not_configured" };
  if (!/^mongodb(\+srv)?:\/\/\S+$/.test(uri)) return { ok: false, reason: "invalid_config" };
  return { ok: true, uri };
}

/** Workers report this fixed user agent; Node.js reports "Node.js/<version>". */
export const isWorkersRuntime = () =>
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * Small pool and short timeouts so a misconfigured or unreachable database fails fast.
 * bufferCommands=false makes queries fail immediately instead of queueing while disconnected;
 * autoIndex/autoCreate=false keep this module from creating collections or indexes.
 */
export function connectOptions(perRequest: boolean): ConnectOptions {
  return {
    maxPoolSize: perRequest ? 1 : 5,
    minPoolSize: 0,
    maxIdleTimeMS: 20_000,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    bufferCommands: false,
    autoIndex: false,
    autoCreate: false,
  };
}

/** The part of a connection this module manages; lets tests use fakes without casts. */
export interface ManagedConnection {
  readonly readyState: number;
  /** Close the client and release the connection for good (Mongoose: `Connection#destroy`). */
  destroy(): Promise<unknown>;
}

export type Opener<C extends ManagedConnection> = (
  uri: string,
  options: ConnectOptions,
) => Promise<C>;

/**
 * Opens a dedicated Mongoose connection (never the global default) and destroys it on failure.
 * The connection is created without a URI and then opened with an awaited `openUri()`, so every
 * failure (including argument validation) lands in the catch below instead of becoming an
 * unhandled rejection inside `createConnection(uri)`.
 */
export const openMongoose: Opener<Connection> = async (uri, options) => {
  const conn = mongoose.createConnection();
  try {
    await conn.openUri(uri, options);
    return conn;
  } catch {
    // A failed open leaves readyState "disconnected", so destroy() completes immediately.
    await conn.destroy().catch(() => undefined);
    throw new DatabaseUnavailableError("unavailable");
  }
};

const CONNECTED = 1;
const CONNECTING = 2;

export function createDatabaseAccess<C extends ManagedConnection>(deps: {
  open: Opener<C>;
  /** Share one connection across calls (Node.js) or open one per call (Workers). */
  reuse: () => boolean;
  env: () => Record<string, string | undefined>;
}) {
  let shared: Promise<C> | undefined;

  const openSafely = (uri: string, perRequest: boolean) =>
    deps.open(uri, connectOptions(perRequest)).catch(() => {
      throw new DatabaseUnavailableError("unavailable");
    });

  async function sharedConnection(uri: string): Promise<C> {
    const existing = shared;
    if (existing) {
      const conn = await existing.catch(() => undefined);
      if (conn && (conn.readyState === CONNECTED || conn.readyState === CONNECTING)) return conn;
      // Failed or dropped: forget it (unless another caller already replaced it) and reopen once.
      if (shared === existing) shared = undefined;
      // Release a dropped connection so it does not linger in mongoose.connections.
      if (conn) await conn.destroy().catch(() => undefined);
      if (shared) return shared;
    }
    const p = openSafely(uri, false);
    shared = p;
    p.catch(() => {
      if (shared === p) shared = undefined;
    });
    return p;
  }

  return {
    async withDatabase<T>(fn: (conn: C) => Promise<T>): Promise<T> {
      const config = readMongoUri(deps.env());
      if (!config.ok) throw new DatabaseUnavailableError(config.reason);
      if (deps.reuse()) return fn(await sharedConnection(config.uri));
      const conn = await openSafely(config.uri, true);
      try {
        return await fn(conn);
      } finally {
        await conn.destroy().catch(() => undefined);
      }
    },
    /** Destroys the shared connection, if any (tests and graceful shutdown). */
    async shutdown() {
      const current = shared;
      shared = undefined;
      const conn = await current?.catch(() => undefined);
      await conn?.destroy().catch(() => undefined);
    },
  };
}

/** The app's database access. Import only from `*.server.ts` files or server function handlers. */
export const database = createDatabaseAccess<Connection>({
  open: openMongoose,
  reuse: () => !isWorkersRuntime(),
  env: () => process.env,
});
