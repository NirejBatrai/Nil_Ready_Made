/**
 * SERVER-ONLY `GET /api/daily-summary?date=YYYY-MM-DD` for n8n (INTERIM Quick Sales, decision
 * 0004). The route file (src/routes/api.daily-summary.ts) only forwards the request here.
 *
 * - Authorization is ONLY `Authorization: Bearer <SUMMARY_API_TOKEN>`. Cookies and sessions are
 *   never read: a signed-in owner without the token is refused like anyone else.
 * - FAILS CLOSED: if `SUMMARY_API_TOKEN` is missing or shorter than 32 characters, every request
 *   gets 503 and nothing else happens (no database access, no comparison).
 * - Constant-time comparison: both values are hashed with SHA-256 and the digests compared with
 *   `timingSafeEqual`, so neither the content nor the length of the token leaks through timing.
 * - Rate limit: every attempt is counted BEFORE the comparison, atomically, in the existing
 *   MongoDB limiter (`login_attempts`, kind `summary_api`), per client address (IPv4, or IPv6
 *   /64; requests with no known address share one key). A correct token un-counts its attempt,
 *   so only failures accumulate: 10 per 15 minutes, then 429 for everyone at that address (the
 *   correct token too) until the window passes. Limiter errors fail closed (503).
 * - Responses are JSON with fixed error messages; the server entry adds `Cache-Control:
 *   no-store` and the security headers. The token is never logged or echoed.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Connection } from "mongoose";
import { parseBusinessDay } from "../lib/bangkok-time";
import { loginAddressKey } from "./auth/auth.server";
import { createLoginLimiter } from "./auth/login-limiter.server";
import { DatabaseUnavailableError } from "./db.server";
import { createQuickSalesService } from "./quick-sales.server";

export const SUMMARY_TOKEN_MIN_LENGTH = 32;
export const SUMMARY_API_LIMIT = { maxFailures: 10, windowMs: 15 * 60 * 1000 } as const;
const MAX_HEADER_TOKEN_LENGTH = 512;
const NO_ADDRESS_KEY = "none";

/** The configured token, or `undefined` when it is missing or too short (fail closed). */
export function configuredSummaryToken(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= SUMMARY_TOKEN_MIN_LENGTH ? value : undefined;
}

/** The token from `Authorization: Bearer <token>`, or `undefined`. */
export function bearerToken(header: string | null): string | undefined {
  if (header === null || header.length > MAX_HEADER_TOKEN_LENGTH + 7) return undefined;
  const match = /^Bearer ([\x21-\x7e]+)$/.exec(header);
  return match?.[1];
}

/** Constant-time: compares SHA-256 digests (always 32 bytes), whatever the lengths. */
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

export interface SummaryApiDeps {
  /** The raw `SUMMARY_API_TOKEN` value from the host environment. */
  token: unknown;
  /** The client address (as for login), or `undefined` when none is known. */
  clientAddress: string | undefined;
  withDatabase: <T>(fn: (conn: Connection) => Promise<T>) => Promise<T>;
  now?: () => Date;
}

export async function handleDailySummary(
  request: Request,
  deps: SummaryApiDeps,
): Promise<Response> {
  const expected = configuredSummaryToken(deps.token);
  if (expected === undefined) return json(503, { error: "Not configured." });
  const given = bearerToken(request.headers.get("authorization"));
  const now = deps.now ?? (() => new Date());
  const key =
    deps.clientAddress === undefined ? NO_ADDRESS_KEY : loginAddressKey(deps.clientAddress);
  try {
    return await deps.withDatabase(async (conn) => {
      const limiter = createLoginLimiter(conn, "summary_api", SUMMARY_API_LIMIT);
      const attempt = await limiter.tryAttempt(key, now().getTime());
      if (attempt === undefined) return json(429, { error: "Too many attempts. Try again later." });
      if (given === undefined || !tokensMatch(given, expected))
        return json(401, { error: "Not allowed." }, { "www-authenticate": "Bearer" });
      await limiter.cancel(key, attempt);
      const raw = new URL(request.url).searchParams.get("date");
      const service = createQuickSalesService(conn, { now });
      const day = raw === null ? service.today() : parseBusinessDay(raw);
      if (day === null) return json(400, { error: "Invalid date. Use YYYY-MM-DD." });
      return json(200, await service.daySummary(day));
    });
  } catch (e) {
    if (e instanceof DatabaseUnavailableError) return json(503, { error: "Database unavailable." });
    return json(500, { error: "Something went wrong." });
  }
}

/** Wires the real request context (environment, client address, database) to the handler. */
export async function dailySummaryFromRequest(request: Request): Promise<Response> {
  const [{ getRequestHeader, getRequestIP }, { loginClientAddress }, { database }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("./auth/client-address.server"),
      import("./db.server"),
    ]);
  return handleDailySummary(request, {
    token: process.env["SUMMARY_API_TOKEN"],
    clientAddress: loginClientAddress({
      socketIp: getRequestIP(),
      cfConnectingIp: getRequestHeader("cf-connecting-ip"),
      vercelForwardedFor: getRequestHeader("x-vercel-forwarded-for"),
    }),
    withDatabase: (fn) => database.withDatabase(fn),
  });
}
