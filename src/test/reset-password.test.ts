// @vitest-environment node
/**
 * `bun run auth:reset-password` (scripts/reset-password.ts → `resetPassword` in auth.server.ts),
 * against an ISOLATED throwaway MongoDB (mongodb-memory-server on 127.0.0.1). The script is also
 * run for real under Bun from a temporary folder with no .env. Never reads MONGODB_URI from the
 * environment of this process and never touches Atlas.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthService, ensureAuthIndexes } from "@/server/auth/auth.server";
import { connectOptions } from "@/server/db.server";
import { loginAttemptModel } from "@/server/models/login-attempt.server";
import { sessionModel } from "@/server/models/session.server";
import { userModel } from "@/server/models/user.server";

// Test-only values for a throwaway database.
const OLD_PASSWORD = "old-password-for-tests-1";
const NEW_PASSWORD = "new-password-for-tests-2";
const DB_NAME = "luxe_reset_password_test";
const SCRIPT = join(process.cwd(), "scripts/reset-password.ts");

let server: MongoMemoryServer;
let conn: Connection;
let cwd = "";
let auth: ReturnType<typeof createAuthService>;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) throw new Error("Refusing non-local test DB");
  conn = mongoose.createConnection();
  await conn.openUri(uri, { ...connectOptions(false), dbName: DB_NAME });
  await ensureAuthIndexes(conn);
  cwd = mkdtempSync(join(tmpdir(), "luxe-reset-")); // empty: no .env can be loaded
}, 120_000);

afterAll(async () => {
  await conn?.destroy();
  await server?.stop();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

beforeEach(async () => {
  await userModel(conn).collection.deleteMany({});
  await sessionModel(conn).collection.deleteMany({});
  await loginAttemptModel(conn).collection.deleteMany({});
  auth = createAuthService(conn);
  const owner = await auth.createFirstOwner({
    email: "owner@example.invalid",
    name: "Reset Owner",
    password: OLD_PASSWORD,
  });
  const staff = await auth.createStaff({
    email: "staff@example.invalid",
    name: "Reset Staff",
    password: OLD_PASSWORD,
  });
  if (!owner.ok || !staff.ok) throw new Error("setup");
});

async function signIn(email: string, password: string) {
  return auth.login({ email, password }, undefined);
}

async function tokens(email: string, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await signIn(email, OLD_PASSWORD);
    if (!r.ok) throw new Error(r.error);
    out.push(r.token);
  }
  return out;
}

function runScript(input: string) {
  const env = {
    PATH: process.env["PATH"] ?? "",
    HOME: tmpdir(),
    MONGODB_URI: `${server.getUri()}${DB_NAME}`,
  };
  const opts = { cwd, env, input, encoding: "utf8" as const, timeout: 60_000 };
  const direct = spawnSync("bun", [SCRIPT], opts);
  const r = direct.error ? spawnSync("npx", ["-y", "bun@1", SCRIPT], opts) : direct;
  const output = `${r.stdout}\n${r.stderr}`;
  // Never prints the connection string or either password.
  expect(output).not.toMatch(/mongodb:\/\/|127\.0\.0\.1/);
  expect(output).not.toContain(OLD_PASSWORD);
  expect(output).not.toContain(NEW_PASSWORD);
  return { status: r.status, output };
}

describe("resetPassword (service)", () => {
  it("works for the owner and for staff: the new password signs in, the old one fails", async () => {
    for (const email of ["owner@example.invalid", "staff@example.invalid"]) {
      expect(await auth.resetPassword({ email, password: NEW_PASSWORD })).toEqual({
        ok: true,
        sessionsRevoked: 0,
      });
      expect((await signIn(email, OLD_PASSWORD)).ok, email).toBe(false);
      expect((await signIn(email, NEW_PASSWORD)).ok, email).toBe(true);
    }
  });

  it("revokes ALL of that user's sessions, and only that user's", async () => {
    const ownerTokens = await tokens("owner@example.invalid", 3);
    const staffTokens = await tokens("staff@example.invalid", 2);
    for (const t of ownerTokens) expect(await auth.resolveSession(t)).toBeDefined();
    expect(
      await auth.resetPassword({ email: "owner@example.invalid", password: NEW_PASSWORD }),
    ).toEqual({ ok: true, sessionsRevoked: 3 });
    for (const t of ownerTokens) expect(await auth.resolveSession(t)).toBeUndefined();
    for (const t of staffTokens) expect(await auth.resolveSession(t)).toBeDefined();
    const owner = await userModel(conn).findOne({ email: "owner@example.invalid" }).lean();
    if (!owner) throw new Error("no owner");
    expect(await sessionModel(conn).countDocuments({ userId: owner._id })).toBe(0);
  });

  it("the email is matched case-insensitively and trimmed, like sign-in", async () => {
    expect(
      (await auth.resetPassword({ email: "  STAFF@Example.Invalid ", password: NEW_PASSWORD })).ok,
    ).toBe(true);
    expect((await signIn("staff@example.invalid", NEW_PASSWORD)).ok).toBe(true);
  });

  it("the one-owner rule is untouched: roles, emails and active flags never change", async () => {
    const before = await userModel(conn).find().sort({ email: 1 }).lean();
    await auth.resetPassword({ email: "staff@example.invalid", password: NEW_PASSWORD });
    await auth.resetPassword({ email: "owner@example.invalid", password: NEW_PASSWORD });
    const after = await userModel(conn).find().sort({ email: 1 }).lean();
    expect(after.map((u) => [u._id, u.email, u.role, u.active, u.name])).toEqual(
      before.map((u) => [u._id, u.email, u.role, u.active, u.name]),
    );
    expect(await userModel(conn).countDocuments({ role: "owner" })).toBe(1);
    // Still exactly one owner allowed.
    expect(
      await auth.createFirstOwner({
        email: "second@example.invalid",
        name: "Second",
        password: NEW_PASSWORD,
      }),
    ).toEqual({ ok: false, error: "An owner account already exists." });
    // Extra fields (a role, an id) are refused, not applied.
    for (const extra of [{ role: "owner" }, { _id: "usr_x" }, { active: true }])
      expect(
        (
          await auth.resetPassword({
            email: "staff@example.invalid",
            password: NEW_PASSWORD,
            ...extra,
          })
        ).ok,
      ).toBe(false);
    expect(await userModel(conn).countDocuments({ role: "owner" })).toBe(1);
  });

  it('an unknown email gets only "No such user."; weak passwords and bad input change nothing', async () => {
    const hashes = async () =>
      (await userModel(conn).find().select("+passwordHash").sort({ email: 1 }).lean()).map(
        (u) => u.passwordHash,
      );
    const before = await hashes();
    expect(
      await auth.resetPassword({ email: "nobody@example.invalid", password: NEW_PASSWORD }),
    ).toEqual({ ok: false, error: "No such user." });
    expect(
      (await auth.resetPassword({ email: "owner@example.invalid", password: "short" })).ok,
    ).toBe(false);
    for (const input of [
      null,
      "owner@example.invalid",
      { email: "not-an-email", password: NEW_PASSWORD },
      { email: { $ne: null }, password: NEW_PASSWORD },
      { email: "owner@example.invalid" },
    ])
      expect((await auth.resetPassword(input)).ok, JSON.stringify(input)).toBe(false);
    expect(await hashes()).toEqual(before);
  });
});

describe("bun run auth:reset-password (the real script)", () => {
  it("resets with piped input and signs out every device; prints no secrets", async () => {
    const before = await tokens("owner@example.invalid", 2);
    const r = runScript(`owner@example.invalid\n${NEW_PASSWORD}\n${NEW_PASSWORD}\n`);
    expect(r.status).toBe(0);
    expect(r.output).toContain("Password changed. Signed out on all devices (2 session(s) ended).");
    for (const t of before) expect(await auth.resolveSession(t)).toBeUndefined();
    expect((await signIn("owner@example.invalid", NEW_PASSWORD)).ok).toBe(true);
  }, 90_000);

  it('refuses mismatched passwords and unknown emails ("No such user." only)', async () => {
    const mismatch = runScript(`owner@example.invalid\n${NEW_PASSWORD}\n${NEW_PASSWORD}x\n`);
    expect(mismatch.status).toBe(1);
    expect(mismatch.output).toContain("Passwords do not match. Nothing was changed.");
    const unknown = runScript(`nobody@example.invalid\n${NEW_PASSWORD}\n${NEW_PASSWORD}\n`);
    expect(unknown.status).toBe(1);
    expect(unknown.output.trim()).toBe("No such user. Nothing was changed.");
    expect((await signIn("owner@example.invalid", OLD_PASSWORD)).ok).toBe(true);
  }, 90_000);

  it("a database that cannot be reached gets a generic message, nothing else", () => {
    const env = {
      PATH: process.env["PATH"] ?? "",
      HOME: tmpdir(),
      MONGODB_URI: "mongodb://127.0.0.1:1/luxe?serverSelectionTimeoutMS=500",
    };
    const opts = {
      cwd,
      env,
      input: `owner@example.invalid\n${NEW_PASSWORD}\n${NEW_PASSWORD}\n`,
      encoding: "utf8" as const,
      timeout: 60_000,
    };
    const direct = spawnSync("bun", [SCRIPT], opts);
    const r = direct.error ? spawnSync("npx", ["-y", "bun@1", SCRIPT], opts) : direct;
    const output = `${r.stdout}\n${r.stderr}`.trim();
    expect(r.status).toBe(1);
    expect(output).toMatch(/^Could not use the database \([a-z ]+\)\. Nothing was changed\.$/);
    expect(output).not.toMatch(/mongodb:\/\/|127\.0\.0\.1|ECONNREFUSED|MongoServerSelection/);
  }, 90_000);
});
