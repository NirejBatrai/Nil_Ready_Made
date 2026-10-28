/**
 * Authentication server functions and middleware. NOT connected to any screen yet: the browser
 * demo keeps its role switch, which is not authentication.
 *
 * Browser code may import this file: TanStack Start replaces handler and middleware bodies with
 * RPC stubs in the client bundle, and server-only modules load only via server-side dynamic
 * imports. All server functions are also covered by the CSRF middleware in src/start.ts.
 */
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { safeErrors } from "./server-errors";

const LOGIN_FAILED = "Email or password is incorrect.";

/**
 * Use on every sensitive server function, AFTER `safeErrors`:
 * `.middleware([safeErrors, requireOwner])`. Throws "Not signed in." / "Not allowed." unless an
 * active owner session cookie is present; passes `{ user }` to the handler's context.
 */
export const requireOwner = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { requireOwnerFromCookie } = await import("@/server/auth/session-context.server");
  const user = await requireOwnerFromCookie();
  return next({ context: { user } });
});

/**
 * Never throws: input validators may run outside the middleware chain, where a thrown error
 * would reach the browser with its stack. Bad input becomes `null` and a generic failure.
 */
const credentials = (data: unknown): { email: string; password: string } | null => {
  if (
    typeof data !== "object" ||
    data === null ||
    !("email" in data) ||
    !("password" in data) ||
    typeof data.email !== "string" ||
    typeof data.password !== "string"
  )
    return null;
  // Only these two fields are passed on; the auth core validates them again.
  return { email: data.email, password: data.password };
};

export const login = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .inputValidator(credentials)
  .handler(async ({ data }) => {
    if (!data) return { ok: false as const, error: LOGIN_FAILED };
    const { loginWithCookie } = await import("@/server/auth/session-context.server");
    return loginWithCookie(data);
  });

export const logout = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async () => {
    const { logoutWithCookie } = await import("@/server/auth/session-context.server");
    await logoutWithCookie();
    return { ok: true as const };
  });

/** Ends every session of the signed-in user, on all devices (this one included). */
export const signOutEverywhere = createServerFn({ method: "POST" })
  .middleware([safeErrors])
  .handler(async () => {
    const { signOutEverywhereWithCookie } = await import("@/server/auth/session-context.server");
    await signOutEverywhereWithCookie();
    return { ok: true as const };
  });

/** Name and role only; never ids, emails, hashes or session data. */
export const getCurrentUser = createServerFn({ method: "GET" })
  .middleware([safeErrors])
  .handler(async () => {
    const { currentUserFromCookie } = await import("@/server/auth/session-context.server");
    const user = await currentUserFromCookie();
    return user ? { name: user.name, role: user.role } : null;
  });
