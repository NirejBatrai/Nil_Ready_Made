/**
 * SERVER-ONLY database health check — a DEVELOPMENT DIAGNOSTIC, not an authenticated endpoint.
 *
 * - Disabled unless running under `vite dev` or DB_HEALTHCHECK_ENABLED=true is set on the server.
 * - Sends a read-only `ping`; never creates or changes data.
 * - Returns only a status word: no host, database name, user, version, latency or error text.
 */
import type { Connection } from "mongoose";
import {
  createDatabaseAccess,
  database,
  DatabaseUnavailableError,
  type ManagedConnection,
} from "./db.server";

export type DatabaseHealthStatus = "ok" | "not_configured" | "unavailable" | "disabled";

export interface DatabaseHealth {
  status: DatabaseHealthStatus;
}

export function healthCheckEnabled(isDev: boolean, env: Record<string, string | undefined>) {
  return isDev || env["DB_HEALTHCHECK_ENABLED"] === "true";
}

export const pingMongo = async (conn: Connection) => {
  if (!conn.db) throw new DatabaseUnavailableError("unavailable");
  await conn.db.admin().command({ ping: 1 });
};

export function createHealthCheck<C extends ManagedConnection>(
  access: Pick<ReturnType<typeof createDatabaseAccess<C>>, "withDatabase">,
  ping: (conn: C) => Promise<void>,
) {
  return async (enabled: boolean): Promise<DatabaseHealth> => {
    if (!enabled) return { status: "disabled" };
    try {
      await access.withDatabase(ping);
      return { status: "ok" };
    } catch (err) {
      // Collapse every failure to a category; invalid config is reported as not configured.
      return {
        status:
          err instanceof DatabaseUnavailableError && err.reason !== "unavailable"
            ? "not_configured"
            : "unavailable",
      };
    }
  };
}

const check = createHealthCheck(database, pingMongo);

export const checkDatabaseHealth = () =>
  check(healthCheckEnabled(import.meta.env.DEV, process.env));
