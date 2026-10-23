/**
 * SERVER-ONLY authentication core: login, session lookup, logout, owner authorization and
 * first-owner creation. Independent of HTTP and cookies (see session-context.server.ts) so it can
 * be tested against an isolated database. Uses relative imports so the local setup script can run
 * it outside Vite.
 *
 * - Every login failure returns the same message; unknown emails are checked against a dummy
 *   hash so timing does not reveal which emails exist.
 * - At most 5 failed attempts per email and IP within 15 minutes (in memory, per process).
 * - Sessions last 7 days from login. Only the SHA-256 hash of the token is stored.
 * - The user record is re-read on every request: deactivation takes effect immediately.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import { z } from "zod";
import { DatabaseUnavailableError } from "../db.server";
import { sessionModel } from "../models/session.server";
import { userModel, type UserRole } from "../models/user.server";
import { getDummyHash, hashPassword, passwordPolicyError, verifyPassword } from "./password.server";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_LIMIT = { maxFailures: 5, windowMs: 15 * 60 * 1000 } as const;

export const LOGIN_FAILED = "Email or password is incorrect.";
export const LOGIN_THROTTLED = "Too many attempts. Try again later.";
export const NOT_SIGNED_IN = "Not signed in.";
export const NOT_ALLOWED = "Not allowed.";

/** Safe to show: carries only one of the fixed messages above. */
export class AuthError extends Error {
  constructor(message: typeof NOT_SIGNED_IN | typeof NOT_ALLOWED) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

// 32 random bytes in base64url is exactly 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(512) }).strict();
const ownerSchema = z
  .object({ email: emailSchema, name: z.string().trim().min(1).max(120), password: z.string() })
  .strict();

/** In-memory failed-login counter keyed by email + IP. Resets on server restart. */
export function createLoginLimiter(limit = LOGIN_LIMIT, maxKeys = 10_000) {
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: number) =>
    (failures.get(key) ?? []).filter((t) => now - t < limit.windowMs);
  return {
    blocked(key: string, now: number) {
      return recent(key, now).length >= limit.maxFailures;
    },
    fail(key: string, now: number) {
      if (!failures.has(key) && failures.size >= maxKeys) {
        // Bound memory: drop entries whose window has passed, else the oldest key.
        for (const [k, times] of failures)
          if (times.every((t) => now - t >= limit.windowMs)) failures.delete(k);
        if (failures.size >= maxKeys) failures.delete(failures.keys().next().value ?? "");
      }
      failures.set(key, [...recent(key, now), now]);
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;

/** One limiter per server process. */
export const loginLimiter = createLoginLimiter();

async function db<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    throw new DatabaseUnavailableError("unavailable");
  }
}

export function createAuthService(
  conn: Connection,
  deps: { now?: () => Date; limiter?: LoginLimiter } = {},
) {
  const Users = userModel(conn);
  const Sessions = sessionModel(conn);
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? loginLimiter;

  async function resolveSession(token: unknown): Promise<AuthUser | undefined> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return undefined;
    const id = hashToken(token);
    const session = await db(() => Sessions.findById(id));
    if (!session) return undefined;
    if (session.expiresAt.getTime() <= now().getTime()) {
      await db(() => Sessions.deleteOne({ _id: id }));
      return undefined;
    }
    const user = await db(() => Users.findById(session.userId));
    if (!user?.active) return undefined;
    return { id: user._id, name: user.name, role: user.role };
  }

  return {
    async login(
      input: unknown,
      ip: string,
    ): Promise<
      { ok: true; token: string; expiresAt: Date; user: AuthUser } | { ok: false; error: string }
    > {
      const parsed = loginSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: LOGIN_FAILED };
      const { email, password } = parsed.data;
      const key = `${email}|${ip}`;
      const at = now().getTime();
      if (limiter.blocked(key, at)) return { ok: false, error: LOGIN_THROTTLED };

      const user = await db(() => Users.findOne({ email }).select("+passwordHash"));
      const valid = user
        ? await verifyPassword(password, user.passwordHash)
        : (await verifyPassword(password, await getDummyHash()), false);
      if (!user || !valid || !user.active) {
        limiter.fail(key, at);
        return { ok: false, error: LOGIN_FAILED };
      }

      limiter.reset(key);
      const token = newToken();
      const expiresAt = new Date(at + SESSION_TTL_MS);
      await db(() => Sessions.create({ _id: hashToken(token), userId: user._id, expiresAt }));
      return {
        ok: true,
        token,
        expiresAt,
        user: { id: user._id, name: user.name, role: user.role },
      };
    },

    resolveSession,

    /** Deletes the session if it exists. Safe to call with any value. */
    async logout(token: unknown): Promise<void> {
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return;
      await db(() => Sessions.deleteOne({ _id: hashToken(token) }));
    },

    /** The signed-in owner, or AuthError("Not signed in." / "Not allowed."). */
    async requireOwner(token: unknown): Promise<AuthUser> {
      const user = await resolveSession(token);
      if (!user) throw new AuthError(NOT_SIGNED_IN);
      if (user.role !== "owner") throw new AuthError(NOT_ALLOWED);
      return user;
    },

    /**
     * LOCAL SETUP ONLY (scripts/create-owner.ts). Never exposed as a server function.
     * Refuses if any owner already exists.
     */
    async createFirstOwner(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
      const parsed = ownerSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Enter a valid email and name." };
      const policy = passwordPolicyError(parsed.data.password);
      if (policy) return { ok: false, error: policy };
      if (await db(() => Users.exists({ role: "owner" })))
        return { ok: false, error: "An owner account already exists." };
      const passwordHash = await hashPassword(parsed.data.password);
      try {
        await Users.create({
          _id: `usr_${randomUUID()}`,
          email: parsed.data.email,
          name: parsed.data.name,
          role: "owner",
          passwordHash,
          active: true,
        });
        return { ok: true };
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === 11000)
          return { ok: false, error: "An owner or an account with that email already exists." };
        throw new DatabaseUnavailableError("unavailable");
      }
    },
  };
}

/** Unique email + session cleanup indexes. Connections use autoIndex: false, so call explicitly. */
export async function ensureAuthIndexes(conn: Connection) {
  await userModel(conn).createIndexes();
  await sessionModel(conn).createIndexes();
}
