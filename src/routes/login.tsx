/**
 * Real owner sign-in (backend authentication). Standalone: the demo screens still use their
 * simulated Owner/Employee roles, which this page does not change.
 *
 * - Sign-in state comes from the server (`getCurrentUser` in the loader), so the first
 *   server-rendered page already reflects the HttpOnly session cookie.
 * - The password lives only in this form's state and is cleared on every attempt. Nothing is
 *   written to localStorage/sessionStorage or logged.
 * - The form uses method="post" and its button stays disabled until React has hydrated, so a
 *   native submit can never put the password into a URL.
 * - "Sign out everywhere" ends every session of this account (other devices too), then shows the
 *   sign-in form again.
 * - INTERIM Quick Sales staff (decision 0004) sign in here too and always land on /quick-sales:
 *   after signing in, and whenever a signed-in staff user opens this page.
 */
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser, login, logout, signOutEverywhere } from "@/lib/auth";
import { SAFE_MESSAGES } from "@/lib/server-errors";

/** Server messages are already generic; database trouble gets a friendlier explanation. */
function friendlyAuthMessage(message: string): string {
  if (message === SAFE_MESSAGES.unavailable)
    return "Sign-in is temporarily unavailable because the database cannot be reached. Please try again later.";
  return message || SAFE_MESSAGES.generic;
}

/**
 * The only page /login may return to after sign-in. Anything else (other paths, absolute or
 * protocol-relative URLs) is dropped when the URL is parsed, so it can never be an open redirect.
 */
const ALLOWED_REDIRECT = "/owner/products";

type LoginSearch = { redirect?: typeof ALLOWED_REDIRECT | undefined };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    search["redirect"] === ALLOWED_REDIRECT ? { redirect: ALLOWED_REDIRECT } : {},
  head: () => ({
    meta: [
      { title: "Owner sign-in · Luxe Retail OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: async () => {
    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await getCurrentUser();
    } catch {
      return { user: null, unavailable: true };
    }
    // Staff have exactly one page.
    if (user?.role === "staff") throw redirect({ to: "/quick-sales" });
    return { user, unavailable: false };
  },
  component: LoginPage,
});

function LoginPage() {
  const { user, unavailable } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const { redirect: returnTo } = Route.useSearch();
  const [hydrated, setHydrated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setHydrated(true), []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const attempt = password;
    setPassword(""); // cleared on every attempt, whatever the outcome
    setBusy(true);
    setError("");
    try {
      const result = await login({ data: { email, password: attempt } });
      if (result.ok) {
        if (result.user.role === "staff") await navigate({ to: "/quick-sales" });
        else if (returnTo === ALLOWED_REDIRECT) await navigate({ to: ALLOWED_REDIRECT });
        else await router.invalidate();
      } else setError(friendlyAuthMessage(result.error));
    } catch (err) {
      setError(friendlyAuthMessage(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await logout();
    } catch (err) {
      setError(friendlyAuthMessage(err instanceof Error ? err.message : ""));
    } finally {
      await router.invalidate();
      setBusy(false);
    }
  };

  const signOutAll = async () => {
    setBusy(true);
    setError("");
    try {
      await signOutEverywhere();
      await navigate({ to: "/login" });
      await router.invalidate();
    } catch (err) {
      setError(friendlyAuthMessage(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <main className="w-full max-w-sm">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
          L
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Owner sign-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Real account · backend authentication</p>

        {unavailable && (
          <p
            role="alert"
            data-testid="login-unavailable"
            className="mt-4 rounded-md bg-warning-soft p-3 text-sm text-warning"
          >
            {friendlyAuthMessage(SAFE_MESSAGES.unavailable)}
          </p>
        )}

        {user ? (
          <div data-testid="signed-in" className="surface mt-6 space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-success" />
              <span>
                Signed in as <strong data-testid="signed-in-name">{user.name}</strong> · Owner
              </span>
            </div>
            <Button
              data-testid="logout-button"
              className="w-full"
              variant="outline"
              disabled={!hydrated || busy}
              onClick={signOut}
            >
              {busy ? "Signing out…" : "Log out"}
            </Button>
            <Button
              data-testid="logout-everywhere-button"
              className="w-full"
              variant="ghost"
              disabled={!hydrated || busy}
              onClick={signOutAll}
            >
              Sign out everywhere
            </Button>
            <Link
              to="/owner/products"
              data-testid="manage-products-link"
              className="block text-center text-sm font-medium text-primary hover:underline"
            >
              Manage products (real data)
            </Link>
            <Link
              to="/owner/today"
              data-testid="owner-today-link"
              className="block text-center text-sm font-medium text-primary hover:underline"
            >
              Quick sales by day
            </Link>
          </div>
        ) : (
          <form
            method="post"
            onSubmit={submit}
            data-testid="login-form"
            className="surface mt-6 space-y-4 p-5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                data-testid="login-email"
                type="email"
                name="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                data-testid="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p
                role="alert"
                data-testid="login-error"
                className="rounded-md bg-destructive-soft p-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              data-testid="login-submit"
              className="w-full"
              disabled={!hydrated || busy}
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        {error && user && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <p className="mt-6 rounded-md bg-muted p-3 text-xs text-muted-foreground">
          This signs in to the real backend. The demo screens still use simulated Owner/Employee
          roles; signing in here does not change them.
        </p>
        <Link to="/" className="mt-4 block text-sm font-medium text-primary hover:underline">
          ← Back to the demo
        </Link>
      </main>
    </div>
  );
}
