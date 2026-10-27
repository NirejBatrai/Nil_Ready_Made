/**
 * SERVER-ONLY authentication core: login, session lookup, logout, owner authorization and
 * first-owner creation. Independent of HTTP and cookies (see session-context.server.ts) so it can
 * be tested against an isolated database. Uses relative imports so the local setup script can run
 * it outside Vite.
 *
 * - Every login failure returns the same message; unknown emails are checked against a dummy
 *   hash so timing does not reveal which emails exist.
 * - At most 5 failed attempts per email and address, 20 per address across all emails, and 50
 *   per email across all addresses, within 15 minutes (in memory, per process). An address is
 *   an IPv4 address or an IPv6 /64; without one, only the per-email limit applies. Each attempt
 *   is counted BEFORE the password is checked, so simultaneous requests cannot all pass.
 * - Password hashing is bounded per process (see password.server.ts); when it is full, login
 *   answers "Too many attempts" without hashing.
 * - Sessions last 7 days from login. Only the SHA-256 hash of the token is stored.
 * - The user record is re-read on every request: deactivation takes effect immediately.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import { z } from "zod";
import { DatabaseUnavailableError } from "../db.server";
import { sessionModel } from "../models/session.server";
import { userModel, type UserRole } from "../models/user.server";
import {
  getDummyHash,
  hashPassword,
  PasswordHashingBusyError,
  passwordPolicyError,
  verifyPassword,
} from "./password.server";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_LIMIT = { maxFailures: 5, windowMs: 15 * 60 * 1000 } as const;
/** Per address across all emails, so one address cannot rotate emails for more password checks. */
export const LOGIN_ADDRESS_LIMIT = { maxFailures: 20, windowMs: 15 * 60 * 1000 } as const;
/**
 * Per email across all addresses, counted for unknown emails too (reveals nothing). Higher than
 * the address limit because anyone can use it to block one account: one address can add only 5
 * per email, so blocking needs at least 10 different addresses (IPv6: /64s) within 15 minutes.
 */
export const LOGIN_ACCOUNT_LIMIT = { maxFailures: 50, windowMs: 15 * 60 * 1000 } as const;

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

/**
 * The address an attempt is counted against. One IPv6 user usually controls a whole /64 (2^64
 * addresses), so IPv6 counts per /64; IPv4-mapped IPv6 counts as its IPv4 address. Anything
 * unparseable is counted exactly as given.
 */
export function loginAddressKey(ip: string): string {
  const addr = ip.trim().toLowerCase().replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped?.[1]) return mapped[1];
  if (!addr.includes(":")) return addr;
  const [head = "", tail, ...rest] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = 8 - left.length - right.length;
  if (rest.length > 0 || zeros < 0) return addr;
  const groups = tail === undefined ? left : [...left, ...Array<string>(zeros).fill("0"), ...right];
  const prefix = groups.slice(0, 4);
  if (prefix.length < 4 || !prefix.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return addr;
  return `${prefix.map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * In-memory login-attempt counter. Resets on server restart and is per process: several server
 * instances would each keep their own count (a shared store would be needed for that; not built).
 */
export function createLoginLimiter(
  limit: { maxFailures: number; windowMs: number } = LOGIN_LIMIT,
  maxKeys = 10_000,
) {
  const attempts = new Map<string, number[]>();
  const recent = (key: string, now: number) =>
    (attempts.get(key) ?? []).filter((t) => now - t < limit.windowMs);
  return {
    blocked(key: string, now: number) {
      return recent(key, now).length >= limit.maxFailures;
    },
    /**
     * Checks the limit and counts this attempt in one synchronous step, so concurrent requests
     * cannot all pass before any is counted. Returns false (nothing counted) when blocked.
     */
    tryAttempt(key: string, now: number): boolean {
      const times = recent(key, now);
      if (times.length >= limit.maxFailures) return false;
      if (!attempts.has(key) && attempts.size >= maxKeys) {
        // Bound memory: drop entries whose window has passed, else the oldest key.
        for (const [k, t] of attempts)
          if (t.every((x) => now - x >= limit.windowMs)) attempts.delete(k);
        if (attempts.size >= maxKeys) attempts.delete(attempts.keys().next().value ?? "");
      }
      attempts.set(key, [...times, now]);
      return true;
    },
    /** Un-counts one attempt that never reached a verdict (hashing busy, database down). */
    cancel(key: string, at: number) {
      const times = attempts.get(key);
      const i = times?.indexOf(at) ?? -1;
      if (!times || i < 0) return;
      times.splice(i, 1);
      if (times.length === 0) attempts.delete(key);
    },
    reset(key: string) {
      attempts.delete(key);
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;

/** One limiter of each kind per server process: per email + address, per address, per email. */
export const loginLimiter = createLoginLimiter();
export const addressLoginLimiter = createLoginLimiter(LOGIN_ADDRESS_LIMIT);
export const accountLoginLimiter = createLoginLimiter(LOGIN_ACCOUNT_LIMIT);

async function db<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    throw new DatabaseUnavailableError("unavailable");
  }
}

export function createAuthService(
  conn: Connection,
  deps: {
    now?: () => Date;
    limiter?: LoginLimiter;
    addressLimiter?: LoginLimiter;
    accountLimiter?: LoginLimiter;
  } = {},
) {
  const Users = userModel(conn);
  const Sessions = sessionModel(conn);
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? loginLimiter;
  const addressLimiter = deps.addressLimiter ?? addressLoginLimiter;
  const accountLimiter = deps.accountLimiter ?? accountLoginLimiter;

  const findUser = (email: string) => db(() => Users.findOne({ email }).select("+passwordHash"));

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
    /** `ip` is undefined when no client address is known: then only the per-email limit applies. */
    async login(
      input: unknown,
      ip: string | undefined,
    ): Promise<
      { ok: true; token: string; expiresAt: Date; user: AuthUser } | { ok: false; error: string }
    > {
      const parsed = loginSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: LOGIN_FAILED };
      const { email, password } = parsed.data;
      // Never a shared fallback key: without an address the address limits are skipped.
      const address = ip === undefined ? undefined : loginAddressKey(ip);
      const key = address === undefined ? undefined : `${email}|${address}`;
      const at = now().getTime();
      // Counted in every applicable limiter now, before any await, and only if all allow it; a
      // wrong password leaves all counted. A refusal un-counts the limiters already passed.
      if (address !== undefined && !addressLimiter.tryAttempt(address, at))
        return { ok: false, error: LOGIN_THROTTLED };
      if (key !== undefined && !limiter.tryAttempt(key, at)) {
        if (address !== undefined) addressLimiter.cancel(address, at);
        return { ok: false, error: LOGIN_THROTTLED };
      }
      if (!accountLimiter.tryAttempt(email, at)) {
        if (key !== undefined) limiter.cancel(key, at);
        if (address !== undefined) addressLimiter.cancel(address, at);
        return { ok: false, error: LOGIN_THROTTLED };
      }

      let user: Awaited<ReturnType<typeof findUser>>;
      let valid: boolean;
      try {
        user = await findUser(email);
        valid = user
          ? await verifyPassword(password, user.passwordHash)
          : (await verifyPassword(password, await getDummyHash()), false);
      } catch (e) {
        // No verdict was reached, so this attempt does not count against the owner.
        if (key !== undefined) limiter.cancel(key, at);
        if (address !== undefined) addressLimiter.cancel(address, at);
        accountLimiter.cancel(email, at);
        if (e instanceof PasswordHashingBusyError) return { ok: false, error: LOGIN_THROTTLED };
        throw e;
      }
      if (!user || !valid || !user.active) return { ok: false, error: LOGIN_FAILED };

      if (key !== undefined) limiter.reset(key);
      // A correct password does not use up the address's or the account's allowance (other
      // failures stay counted, so signing in does not clear an attacker's count).
      if (address !== undefined) addressLimiter.cancel(address, at);
      accountLimiter.cancel(email, at);
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
