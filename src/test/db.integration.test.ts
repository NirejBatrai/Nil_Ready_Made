// @vitest-environment node
/**
 * OPT-IN live connectivity check: `bun run test:db`. Skipped in the normal test run.
 * Reads MONGODB_URI from the environment or .env and sends one read-only `ping`; it creates no
 * collections or documents. Point it at a NON-production database. Only a status word is
 * asserted or printed, never the connection string.
 */
import { loadEnv } from "vite";
import { describe, expect, it } from "vitest";
import { createDatabaseAccess, openMongoose } from "@/server/db.server";
import { createHealthCheck, pingMongo } from "@/server/health.server";

const enabled = process.env["RUN_DB_INTEGRATION"] === "1";

describe.skipIf(!enabled)("live MongoDB connectivity (opt-in)", () => {
  it("connects and answers a ping", async () => {
    const fromFile = loadEnv("development", process.cwd(), "MONGODB_");
    const env = { MONGODB_URI: process.env["MONGODB_URI"] ?? fromFile["MONGODB_URI"] };
    const access = createDatabaseAccess({ open: openMongoose, reuse: () => false, env: () => env });
    const { status } = await createHealthCheck(access, pingMongo)(true);
    expect(status).toBe("ok");
  }, 20_000);
});
