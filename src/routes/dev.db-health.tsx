/**
 * DEVELOPMENT-ONLY DIAGNOSTIC page (not linked from the app). Calls the database health-check
 * server function on request. In production builds the server function answers "disabled"
 * unless DB_HEALTHCHECK_ENABLED=true is set on the server. Not authenticated.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { getDatabaseHealth } from "@/lib/db-health";

export const Route = createFileRoute("/dev/db-health")({
  head: () => ({
    meta: [
      { title: "Database diagnostic · Luxe Retail OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DbHealth,
});

const MESSAGE: Record<string, string> = {
  ok: "The server reached the database.",
  not_configured: "The database connection string is not set on the server.",
  unavailable: "The server could not reach the database (network access, credentials or outage).",
  disabled: "This diagnostic is disabled on this server.",
};

function DbHealth() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setStatus((await getDatabaseHealth()).status);
    } catch {
      setStatus("unavailable");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-10 text-sm">
      <h1 className="text-xl font-semibold">Database diagnostic</h1>
      <p className="rounded-md bg-warning-soft p-3 text-xs text-warning">
        Development-only diagnostic. It is not authenticated and shows only a status word. The demo
        app does not use the database yet.
      </p>
      <Button onClick={check} disabled={busy}>
        {busy ? "Checking…" : "Check connection"}
      </Button>
      {status && (
        <p role="status">
          <span className="font-mono font-semibold">{status}</span> — {MESSAGE[status]}
        </p>
      )}
    </main>
  );
}
