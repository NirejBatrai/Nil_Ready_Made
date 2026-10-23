/**
 * DEVELOPMENT-ONLY DIAGNOSTIC: reports whether the server can reach MongoDB.
 *
 * Not authenticated (real authentication does not exist yet). It is safe to expose only because
 * it is disabled outside `vite dev` unless DB_HEALTHCHECK_ENABLED=true is set on the server, and it
 * returns a bare status word ("ok" | "not_configured" | "unavailable" | "disabled").
 *
 * Browser code may import this file: TanStack Start replaces the handler with an RPC call in the
 * client bundle, and the database modules are only loaded on the server via the dynamic import.
 */
import { createServerFn } from "@tanstack/react-start";
import { safeErrors } from "./server-errors";

export const getDatabaseHealth = createServerFn({ method: "GET" })
  .middleware([safeErrors])
  .handler(async () => {
    const { checkDatabaseHealth } = await import("@/server/health.server");
    return checkDatabaseHealth();
  });
