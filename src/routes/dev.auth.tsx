/**
 * DEVELOPMENT-ONLY test page for owner login (not linked from the app, not part of the demo).
 * Production builds render nothing here. Used by the opt-in end-to-end test (src/test/auth.e2e.test.ts).
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getCurrentUser, login, logout } from "@/lib/auth";
import { getProductForOwner } from "@/lib/products";

export const Route = createFileRoute("/dev/auth")({
  head: () => ({
    meta: [
      { title: "Auth diagnostic · Luxe Retail OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DevAuth,
});

function DevAuth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [productId, setProductId] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState(0);
  if (!import.meta.env.DEV) return <main className="p-6 text-sm">Not available.</main>;

  const run = (action: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      setOut(JSON.stringify(await action()));
    } catch (e) {
      setOut(`error: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
      setRuns((n) => n + 1);
    }
  };

  const field = "w-full rounded-md border bg-background px-3 py-2";
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 py-10 text-sm">
      <h1 className="text-xl font-semibold">Auth diagnostic</h1>
      <p className="rounded-md bg-warning-soft p-3 text-xs text-warning">
        Development-only. Not connected to the demo.
      </p>
      <input
        data-testid="email"
        className={field}
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        data-testid="password"
        className={field}
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        data-testid="product-id"
        className={field}
        placeholder="Product id (prd_…)"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["login", () => login({ data: { email, password } })],
            ["whoami", () => getCurrentUser()],
            ["owner-product", () => getProductForOwner({ data: productId })],
            ["logout", () => logout()],
          ] as const
        ).map(([id, action]) => (
          <button
            key={id}
            data-testid={id}
            disabled={busy}
            onClick={run(action)}
            className="rounded-md border px-3 py-2"
          >
            {id}
          </button>
        ))}
      </div>
      <pre
        data-testid="out"
        data-busy={busy}
        data-runs={runs}
        className="whitespace-pre-wrap rounded-md bg-muted p-3"
      >
        {out}
      </pre>
    </main>
  );
}
