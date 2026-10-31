/**
 * SERVER-ONLY authentication core: login, session lookup, logout, owner authorization and
 * first-owner creation. Independent of HTTP and cookies (see session-context.server.ts) so it can
 * be tested against an isolated database. Uses relative imports so the local setup script can run
 * it outside Vite.
 *
 * - Every login failure returns the same message; unknown emails are checked against a dummy
 *   hash so timing does not reveal which emails exist.
 * - At most 5 failed attempts per email and address, 20 per address across all emails, and 50
 *   per email across all addresses, within 15 minutes. The counts live in MongoDB
 *   (login-limiter.server.ts), so they survive restarts and are shared by all server instances.
 *   An address is an IPv4 address or an IPv6 /64; without one, only the per-email limit applies.
 *   Each attempt is counted atomically BEFORE the password is checked, so simultaneous requests
 *   cannot all pass. If the counters cannot be reached, login fails CLOSED (no password check).
 * - Password hashing is bounded per process (see password.server.ts); when it is full, login
 *   answers "Too many attempts" without hashing.
 * - Sessions last 7 days from login. Only the SHA-256 hash of the token is stored.
 * - Login hygiene: a session cookie presented at login is deleted once the new session exists,
 *   and each user keeps at most 5 sessions (the oldest are deleted). The cap is soft under
 *   simultaneous logins: each login only trims what it can see, so the count settles at 5 once
 *   they finish, but may briefly be higher.
 * - Each session records its client address, User-Agent (truncated) and last use (written at
 *   most every 5 minutes). These are never logged. There is no idle timeout yet.
 * - The user record is re-read on every request: deactivation takes effect immediately.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import { z } from "zod";
import { DatabaseUnavailableError } from "../db.server";
import { loginAttemptModel } from "../models/login-attempt.server";
import { sessionModel } from "../models/session.server";
import { userModel, type UserRole } from "../models/user.server";
import { createLoginLimiter, type LoginLimiter } from "./login-limiter.server";
import {
  getDummyHash,
  hashPassword,
  PasswordHashingBusyError,
  passwordPolicyError,
  verifyPassword,
} from "./password.server";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 5;
/** `lastSeenAt` is written at most this often per session, not on every request. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
export const USER_AGENT_MAX_LENGTH = 256;
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

/** Request details recorded on a new session; none of them is required. */
export interface LoginContext {
  /** The session token from the request's cookie, if any: deleted after the new login. */
  previousToken?: unknown;
  userAgent?: unknown;
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
  // Stateless wrappers around the shared `login_attempts` collection on this connection.
  const limiter = deps.limiter ?? createLoginLimiter(conn, "email_address", LOGIN_LIMIT);
  const addressLimiter =
    deps.addressLimiter ?? createLoginLimiter(conn, "address", LOGIN_ADDRESS_LIMIT);
  const accountLimiter =
    deps.accountLimiter ?? createLoginLimiter(conn, "account", LOGIN_ACCOUNT_LIMIT);

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
    const at = now();
    // At most one write per session every 5 minutes. Sessions from before this field existed
    // get it on their first use. Two requests at the same moment may both write; harmless.
    if (!session.lastSeenAt || at.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS)
      await db(() => Sessions.updateOne({ _id: id }, { $set: { lastSeenAt: at } }));
    return { id: user._id, name: user.name, role: user.role };
  }

  /** Deletes every session of this user (all devices); returns how many were deleted. */
  async function revokeAllSessions(userId: string): Promise<number> {
    const result = await db(() => Sessions.deleteMany({ userId }));
    return result.deletedCount;
  }

  /** Keeps the new session and the newest others, up to MAX_SESSIONS_PER_USER in total. */
  async function trimSessions(userId: string, keepId: string): Promise<void> {
    const extra = await db(() =>
      Sessions.find({ userId, _id: { $ne: keepId } }, { _id: 1 })
        .sort({ expiresAt: -1, _id: -1 })
        .skip(MAX_SESSIONS_PER_USER - 1)
        .lean(),
    );
    if (extra.length > 0)
      await db(() => Sessions.deleteMany({ _id: { $in: extra.map((s) => s._id) } }));
  }

  return {
    /** `ip` is undefined when no client address is known: then only the per-email limit applies. */
    async login(
      input: unknown,
      ip: string | undefined,
      context: LoginContext = {},
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
      // Counted in every applicable limiter (each count is atomic) before the password is
      // checked, and kept only if all allow it; a wrong password leaves all counted. A refusal
      // un-counts the limiters already passed. Un-counting is best effort: if it fails, the
      // attempt stays counted (the safe direction).
      const counted: { limiter: LoginLimiter; key: string; attempt: string }[] = [];
      const undo = () =>
        Promise.all(counted.map((c) => c.limiter.cancel(c.key, c.attempt).catch(() => undefined)));
      const steps: [LoginLimiter, string | undefined][] = [
        [addressLimiter, address],
        [limiter, key],
        [accountLimiter, email],
      ];
      try {
        for (const [l, k] of steps) {
          if (k === undefined) continue;
          const attempt = await l.tryAttempt(k, at);
          if (attempt === undefined) {
            await undo();
            return { ok: false, error: LOGIN_THROTTLED };
          }
          counted.push({ limiter: l, key: k, attempt });
        }
      } catch (e) {
        // Fail closed: without a limiter answer there is no password check.
        await undo();
        throw e;
      }
      const attemptOf = (l: LoginLimiter) => counted.find((c) => c.limiter === l)?.attempt;

      let user: Awaited<ReturnType<typeof findUser>>;
      let valid: boolean;
      try {
        user = await findUser(email);
        valid = user
          ? await verifyPassword(password, user.passwordHash)
          : (await verifyPassword(password, await getDummyHash()), false);
      } catch (e) {
        // No verdict was reached, so this attempt does not count against the owner.
        await undo();
        if (e instanceof PasswordHashingBusyError) return { ok: false, error: LOGIN_THROTTLED };
        throw e;
      }
      if (!user || !valid || !user.active) return { ok: false, error: LOGIN_FAILED };

      if (key !== undefined) await limiter.reset(key);
      // A correct password does not use up the address's or the account's allowance (other
      // failures stay counted, so signing in does not clear an attacker's count).
      const addressAttempt = attemptOf(addressLimiter);
      if (address !== undefined && addressAttempt !== undefined)
        await addressLimiter.cancel(address, addressAttempt);
      const accountAttempt = attemptOf(accountLimiter);
      if (accountAttempt !== undefined) await accountLimiter.cancel(email, accountAttempt);
      const token = newToken();
      const id = hashToken(token);
      const expiresAt = new Date(at + SESSION_TTL_MS);
      const userAgent =
        typeof context.userAgent === "string" && context.userAgent
          ? context.userAgent.slice(0, USER_AGENT_MAX_LENGTH)
          : undefined;
      await db(() =>
        Sessions.create({
          _id: id,
          userId: user._id,
          expiresAt,
          createdIp: ip ?? null,
          userAgent,
          lastSeenAt: new Date(at),
        }),
      );
      // The browser's previous session (any user) is replaced by this one, so end it for good.
      const previous = context.previousToken;
      if (
        typeof previous === "string" &&
        TOKEN_PATTERN.test(previous) &&
        hashToken(previous) !== id
      )
        await db(() => Sessions.deleteOne({ _id: hashToken(previous) }));
      await trimSessions(user._id, id);
      return {
        ok: true,
        token,
        expiresAt,
        user: { id: user._id, name: user.name, role: user.role },
      };
    },

    resolveSession,

    revokeAllSessions,

    /**
     * "Sign out everywhere": ends every session of the token's user, this one included.
     * Throws AuthError("Not signed in.") without a valid session.
     */
    async signOutEverywhere(token: unknown): Promise<void> {
      const user = await resolveSession(token);
      if (!user) throw new AuthError(NOT_SIGNED_IN);
      await revokeAllSessions(user.id);
    },

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

/**
 * Unique email, session cleanup and login-attempt cleanup (TTL) indexes. Connections use
 * autoIndex: false, so call explicitly (setup scripts only).
 */
export async function ensureAuthIndexes(conn: Connection) {
  await userModel(conn).createIndexes();
  await sessionModel(conn).createIndexes();
  await loginAttemptModel(conn).createIndexes();
}
