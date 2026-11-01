/**
 * INTERIM Quick Sales: the ONLY page for staff (decision 0004; retires when slice S9 lands).
 * Mobile-first, big buttons. Standalone: not part of the demo, and links nowhere.
 *
 * - Access is enforced on the server: every Quick Sales server function runs `requirePermission`
 *   on every call. The `beforeLoad` redirect is only a convenience for signed-out visitors.
 * - Until today's opening change money is recorded, only that form is shown. Then: item, amount,
 *   Cash / QR, Add, and the signed-in user's own entries of the last 10 minutes (at most 5), each
 *   with Cancel while it is less than 10 minutes old.
 * - No totals, no history, no other people's sales: the server never sends them here.
 * - Amounts are sent as typed and parsed on the server (integer satang); the browser never sends
 *   a date or a time.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser, logout } from "@/lib/auth";
import { formatSatang } from "@/lib/money";
import {
  addQuickSale,
  cancelQuickSale,
  getQuickSalesPage,
  recordOpeningFloat,
} from "@/lib/quick-sales";
import { SAFE_MESSAGES } from "@/lib/server-errors";

type Payment = "cash" | "qr";
const PAYMENT_LABEL: Record<Payment, string> = { cash: "Cash", qr: "QR" };

const toLogin = () => redirect({ to: "/login" });

function friendly(message: string): string {
  if (message === SAFE_MESSAGES.unavailable)
    return "The database cannot be reached right now. Please try again.";
  return message || SAFE_MESSAGES.generic;
}

export const Route = createFileRoute("/quick-sales")({
  head: () => ({
    meta: [
      { title: "Quick sales · Luxe Retail OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await getCurrentUser();
    } catch {
      return { authUnavailable: true };
    }
    if (!user) throw toLogin();
    return { authUnavailable: false };
  },
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ context }) => {
      if (context.authUnavailable) return { state: "unavailable" as const, page: null };
      try {
        return { state: "ok" as const, page: await getQuickSalesPage() };
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
          throw toLogin();
        if (message === SAFE_MESSAGES.unavailable)
          return { state: "unavailable" as const, page: null };
        return { state: "error" as const, page: null };
      }
    },
  },
  pendingMs: 200,
  pendingComponent: () => (
    <Frame>
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Loading…
      </p>
    </Frame>
  ),
  component: QuickSales,
});

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Quick sales</h1>
      <div className="mt-5 space-y-6">{children}</div>
    </div>
  );
}

function QuickSales() {
  const { state, page } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [opening, setOpening] = useState("");
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  useEffect(() => setHydrated(true), []);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await action();
      await router.invalidate();
      if (!result.ok) setError(friendly(result.error ?? ""));
      return result.ok;
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : ""));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveOpening = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await run(() => recordOpeningFloat({ data: { amountText: opening } }))) setOpening("");
  };

  const addSale = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!payment) {
      setError("Choose Cash or QR.");
      return;
    }
    const data = { itemText: item, amountText: amount, payment };
    if (await run(() => addQuickSale({ data }))) {
      setItem("");
      setAmount("");
      setPayment(null);
      setSaved(true);
    }
  };

  const confirmCancel = async () => {
    const id = cancelId;
    setCancelId(null);
    if (id) await run(() => cancelQuickSale({ data: id }));
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      await navigate({ to: "/login" });
      setBusy(false);
    }
  };

  const errorBox = error && (
    <p
      role="alert"
      data-testid="qs-error"
      className="rounded-md bg-destructive-soft p-3 text-base text-destructive"
    >
      {error}
    </p>
  );
  const big = "h-14 w-full text-lg";

  return (
    <Frame>
      {state !== "ok" || !page ? (
        <p role="alert" data-testid="qs-unavailable" className="surface p-5 text-base">
          {state === "unavailable"
            ? "The database cannot be reached right now. Please try again later."
            : "Something went wrong. Please reload the page."}
        </p>
      ) : !page.hasOpeningFloat ? (
        <form
          method="post"
          onSubmit={saveOpening}
          data-testid="qs-opening-form"
          className="surface space-y-4 p-5"
        >
          <div className="space-y-2">
            <Label htmlFor="qs-opening" className="text-base">
              Change money in bag (฿)
            </Label>
            <Input
              id="qs-opening"
              data-testid="qs-opening"
              inputMode="decimal"
              autoComplete="off"
              required
              maxLength={20}
              className="h-14 text-lg"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </div>
          {errorBox}
          <Button
            type="submit"
            data-testid="qs-opening-save"
            className={big}
            disabled={!hydrated || busy}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : (
        <>
          <form
            method="post"
            onSubmit={addSale}
            data-testid="qs-sale-form"
            className="surface space-y-4 p-5"
          >
            <div className="space-y-2">
              <Label htmlFor="qs-item" className="text-base">
                Item
              </Label>
              <Input
                id="qs-item"
                data-testid="qs-item"
                autoComplete="off"
                required
                maxLength={100}
                className="h-14 text-lg"
                value={item}
                onChange={(e) => {
                  setItem(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qs-amount" className="text-base">
                Amount (฿)
              </Label>
              <Input
                id="qs-amount"
                data-testid="qs-amount"
                inputMode="decimal"
                autoComplete="off"
                required
                maxLength={20}
                className="h-14 text-lg"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Payment">
              {(["cash", "qr"] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  data-testid={`qs-${p}`}
                  aria-pressed={payment === p}
                  variant={payment === p ? "default" : "outline"}
                  className="h-14 text-lg"
                  disabled={!hydrated || busy}
                  onClick={() => {
                    setPayment(p);
                    setSaved(false);
                  }}
                >
                  {PAYMENT_LABEL[p]}
                </Button>
              ))}
            </div>
            {errorBox}
            {saved && (
              <p
                role="status"
                data-testid="qs-saved"
                className="flex items-center gap-2 text-lg font-medium text-success"
              >
                <Check className="size-5" /> Saved ✓
              </p>
            )}
            <Button
              type="submit"
              data-testid="qs-add"
              className="h-16 w-full text-xl"
              disabled={!hydrated || busy}
            >
              {busy ? "Saving…" : "Add"}
            </Button>
          </form>

          <section aria-labelledby="qs-recent-title">
            <h2 id="qs-recent-title" className="text-sm font-medium text-muted-foreground">
              Your entries (last 10 minutes)
            </h2>
            {page.recent.length === 0 ? (
              <p data-testid="qs-recent-empty" className="mt-2 text-sm text-muted-foreground">
                None yet.
              </p>
            ) : (
              <ul data-testid="qs-recent" className="mt-2 space-y-2">
                {page.recent.map((s) => (
                  <li
                    key={s.id}
                    data-testid="qs-recent-row"
                    data-sale-id={s.id}
                    className="surface flex items-center gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-base ${s.cancelled ? "line-through" : ""}`}>
                        {s.itemText}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {s.time} · {PAYMENT_LABEL[s.payment]} · {formatSatang(s.amountSatang)}
                        {s.cancelled && " · Cancelled"}
                      </p>
                    </div>
                    {s.canCancel && (
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="qs-cancel"
                        className="h-12 px-4"
                        disabled={!hydrated || busy}
                        onClick={() => setCancelId(s.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Button
        type="button"
        variant="ghost"
        data-testid="qs-logout"
        className="w-full"
        disabled={!hydrated || busy}
        onClick={signOut}
      >
        Log out
      </Button>

      <AlertDialog open={cancelId !== null} onOpenChange={(open) => !open && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              It stays in the notebook, marked as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="qs-cancel-keep">Keep it</AlertDialogCancel>
            <AlertDialogAction data-testid="qs-cancel-confirm" onClick={confirmCancel}>
              Cancel sale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  );
}
