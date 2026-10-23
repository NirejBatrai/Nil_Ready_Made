/**
 * SERVER-ONLY session cookie settings.
 * - Production: `__Host-luxe_session`, Secure (the browser then also enforces Path=/ and no Domain).
 * - Local http://localhost development: `luxe_session` without Secure.
 * Always HttpOnly (no JavaScript access) and SameSite=Lax (not sent on cross-site POSTs).
 */
export const sessionCookieName = (production: boolean) =>
  production ? "__Host-luxe_session" : "luxe_session";

export function sessionCookieOptions(production: boolean, expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}
