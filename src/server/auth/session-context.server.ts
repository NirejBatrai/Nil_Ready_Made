/**
 * SERVER-ONLY bridge between HTTP (cookies, client IP) and the auth core. Only server function
 * handlers and middleware load this, through a server-side dynamic import.
 */
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestIP,
  setCookie,
} from "@tanstack/react-start/server";
import { database } from "@/server/db.server";
import { createAuthService, type AuthUser } from "./auth.server";
import { loginClientAddress } from "./client-address.server";
import { sessionCookieName, sessionCookieOptions } from "./cookie.server";

const PRODUCTION = import.meta.env.PROD;
const COOKIE = sessionCookieName(PRODUCTION);

export async function loginWithCookie(
  input: unknown,
): Promise<{ ok: true; user: Pick<AuthUser, "name" | "role"> } | { ok: false; error: string }> {
  // CF-Connecting-IP on Cloudflare Workers only, else the socket address (getRequestIP() without
  // options ignores X-Forwarded-For); undefined if neither is an IP address.
  const ip = loginClientAddress({
    socketIp: getRequestIP(),
    cfConnectingIp: getRequestHeader("cf-connecting-ip"),
  });
  // The old session cookie (if any) is ended after the new login; the User-Agent is stored on the
  // session (truncated) and never logged.
  const context = { previousToken: getCookie(COOKIE), userAgent: getRequestHeader("user-agent") };
  const result = await database.withDatabase((conn) =>
    createAuthService(conn).login(input, ip, context),
  );
  if (!result.ok) return result;
  setCookie(COOKIE, result.token, sessionCookieOptions(PRODUCTION, result.expiresAt));
  return { ok: true, user: { name: result.user.name, role: result.user.role } };
}

export async function logoutWithCookie(): Promise<void> {
  const token = getCookie(COOKIE);
  try {
    await database.withDatabase((conn) => createAuthService(conn).logout(token));
  } finally {
    // Clear the cookie even if the database is unreachable.
    deleteCookie(COOKIE, sessionCookieOptions(PRODUCTION));
  }
}

/**
 * Ends every session of the signed-in user (all devices, this one included), then clears the
 * cookie. Throws AuthError("Not signed in.") without a valid session; if the database fails,
 * nothing was revoked and the cookie is kept so the user can retry.
 */
export async function signOutEverywhereWithCookie(): Promise<void> {
  const token = getCookie(COOKIE);
  await database.withDatabase((conn) => createAuthService(conn).signOutEverywhere(token));
  deleteCookie(COOKIE, sessionCookieOptions(PRODUCTION));
}

export async function currentUserFromCookie(): Promise<AuthUser | undefined> {
  const token = getCookie(COOKIE);
  if (token === undefined) return undefined;
  const user = await database.withDatabase((conn) => createAuthService(conn).resolveSession(token));
  if (!user) deleteCookie(COOKIE, sessionCookieOptions(PRODUCTION));
  return user;
}

/** Throws AuthError("Not signed in." / "Not allowed.") unless an active owner is signed in. */
export async function requireOwnerFromCookie(): Promise<AuthUser> {
  const token = getCookie(COOKIE);
  return database.withDatabase((conn) => createAuthService(conn).requireOwner(token));
}
