/**
 * INTERIM Quick Sales, owner view of one business day (decision 0004; retires when slice S9
 * lands). Owner only: `getDayForOwner` runs `requirePermission("quickSales.viewDay")`, which only
 * the owner role has. The `beforeLoad` redirect is only a convenience for signed-out visitors;
 * staff are refused by the server and sent to /login, which sends them to /quick-sales.
 *
 * Shows: a date picker (default today in Bangkok), opening change, total, Cash, QR, number of
 * sales, number cancelled, expected cash (opening + Cash sales) and every sale of the day.
 *
 * Owner actions (decision 0004, amended): Cancel any sale and Remove any sale or the opening
 * change, each with a reason and a confirmation dialog; "Show removed" lists removed entries
 * greyed out (who, when, why) with Restore. Remove is a soft delete; nothing is ever deleted.
 * The buttons are display only: the server functions run `requirePermission` with the owner-only
 * `quickSales.cancelAny` / `quickSales.remove` on every call.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
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
import { Switch } from "@/components/ui/switch";
import { getCurrentUser } from "@/lib/auth";
import { parseBusinessDay } from "@/lib/bangkok-time";
import { formatSatang } from "@/lib/money";
import {
  getDayForOwner,
  ownerCancelQuickSale,
  removeQuickSaleEntry,
  restoreQuickSaleEntry,
} from "@/lib/quick-sales";
import { SAFE_MESSAGES } from "@/lib/server-errors";

const REASON_MAX = 200;

/** What the confirmation dialog will do. */
type PendingAction =
  | { kind: "cancel"; saleId: string; label: string }
  | { kind: "remove-sale"; saleId: string; label: string }
  | { kind: "remove-opening"; date: string; label: string };

function friendly(message: string): string {
  if (message === SAFE_MESSAGES.unavailable)
    return "The database cannot be reached right now. Please try again.";
  return message || SAFE_MESSAGES.generic;
}

const toLogin = () => redirect({ to: "/login" });
const PAYMENT_LABEL = { cash: "Cash", qr: "QR" } as const;

type TodaySearch = { date?: string | undefined };

export const Route = createFileRoute("/owner/today")({
  validateSearch: (search: Record<string, unknown>): TodaySearch => {
    const date = parseBusinessDay(search["date"]);
    return date ? { date } : {};
  },
  head: () => ({
    meta: [
      { title: "Today's quick sales · Luxe Retail OS" },
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
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ context, deps }) => {
      if (context.authUnavailable) return { state: "unavailable" as const, day: null };
      try {
        return { state: "ok" as const, day: await getDayForOwner({ data: deps.date ?? null }) };
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
          throw toLogin();
        if (message === SAFE_MESSAGES.unavailable)
          return { state: "unavailable" as const, day: null };
        return { state: "error" as const, day: null };
      }
    },
  },
  pendingMs: 200,
  pendingComponent: () => (
    <Frame>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </p>
    </Frame>
  ),
  component: OwnerToday,
});

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Quick sales by day</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Owner only · interim notebook until the real sales system is ready.
      </p>
      <div className="mt-6">{children}</div>
      <div className="mt-8 flex gap-4 text-sm">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Account
        </Link>
        <Link to="/owner/products" className="font-medium text-primary hover:underline">
          Products
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-testid={testId} className="mt-1 text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function OwnerToday() {
  const { state, day } = Route.useLoaderData();
  const navigate = useNavigate({ from: "/owner/today" });
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  useEffect(() => setHydrated(true), []);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError("");
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

  const ask = (action: PendingAction) => {
    setReason("");
    setError("");
    setPending(action);
  };

  const confirm = async () => {
    const action = pending;
    if (!action) return;
    const ok = await run(() => {
      if (action.kind === "cancel")
        return ownerCancelQuickSale({ data: { saleId: action.saleId, reason } });
      if (action.kind === "remove-sale")
        return removeQuickSaleEntry({ data: { kind: "sale", id: action.saleId, reason } });
      return removeQuickSaleEntry({ data: { kind: "opening", id: action.date, reason } });
    });
    if (ok) setPending(null);
  };

  const restore = (data: { kind: "sale" | "opening"; id: string }) =>
    run(() => restoreQuickSaleEntry({ data }));

  const canAct = hydrated && !busy;
  const reasonOk = reason.trim().length >= 1 && reason.trim().length <= REASON_MAX;

  if (state !== "ok" || !day)
    return (
      <Frame>
        <p role="alert" data-testid="today-unavailable" className="surface p-5 text-sm">
          {state === "unavailable"
            ? "The database cannot be reached right now. Please try again later."
            : "Something went wrong. Please reload the page."}
        </p>
      </Frame>
    );

  return (
    <Frame>
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="today-date">Business day (Bangkok)</Label>
        <Input
          id="today-date"
          data-testid="today-date"
          type="date"
          value={day.date}
          onChange={(e) => {
            const date = parseBusinessDay(e.target.value);
            if (date) void navigate({ search: { date } });
          }}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Opening change"
          testId="today-opening"
          value={
            day.openingFloatSatang === null ? "Not recorded" : formatSatang(day.openingFloatSatang)
          }
        />
        <Stat label="Total" testId="today-total" value={formatSatang(day.totalSatang)} />
        <Stat label="Cash" testId="today-cash" value={formatSatang(day.cashSatang)} />
        <Stat label="QR" testId="today-qr" value={formatSatang(day.qrSatang)} />
        <Stat label="Sales" testId="today-count" value={String(day.count)} />
        <Stat label="Cancelled" testId="today-cancelled" value={String(day.cancelledCount)} />
        <Stat
          label="Expected cash (opening + Cash)"
          testId="today-expected-cash"
          value={formatSatang(day.expectedCashSatang)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {day.openingFloatSatang !== null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="today-remove-opening"
            disabled={!canAct}
            onClick={() =>
              ask({
                kind: "remove-opening",
                date: day.date,
                label: `the opening change of ${formatSatang(day.openingFloatSatang ?? 0)}`,
              })
            }
          >
            Remove opening change
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Switch
            id="today-show-removed"
            data-testid="today-show-removed"
            checked={showRemoved}
            disabled={!hydrated}
            onCheckedChange={setShowRemoved}
          />
          <Label htmlFor="today-show-removed">
            Show removed ({day.removed.sales.length + day.removed.openingFloats.length})
          </Label>
        </div>
      </div>

      {error && !pending && (
        <p
          role="alert"
          data-testid="today-error"
          className="mt-4 rounded-md bg-destructive-soft p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {day.sales.length === 0 ? (
        <p data-testid="today-empty" className="surface mt-6 p-5 text-sm text-muted-foreground">
          No sales recorded on this day.
        </p>
      ) : (
        <div className="surface mt-6 overflow-x-auto">
          <table data-testid="today-sales" className="w-full min-w-[560px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-2 font-medium">Item</th>
                <th className="px-2 text-right font-medium">Amount</th>
                <th className="px-2 font-medium">Payment</th>
                <th className="px-2 font-medium">Staff</th>
                <th className="px-2 font-medium">Status</th>
                <th className="px-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {day.sales.map((s) => (
                <tr
                  key={s.id}
                  data-testid="today-row"
                  className={`border-b last:border-0 ${s.cancelled ? "text-muted-foreground" : ""}`}
                >
                  <td className="px-4 py-2 tabular-nums">{s.time}</td>
                  <td className={`px-2 ${s.cancelled ? "line-through" : ""}`}>{s.itemText}</td>
                  <td className="px-2 text-right tabular-nums">{formatSatang(s.amountSatang)}</td>
                  <td className="px-2">{PAYMENT_LABEL[s.payment]}</td>
                  <td className="px-2">{s.staffName}</td>
                  <td className="px-2">
                    {s.cancelled ? "Cancelled" : "OK"}
                    {s.cancelReason && (
                      <span data-testid="today-cancel-reason" className="block text-xs">
                        {s.cancelReason}
                        {s.cancelledByName ? ` (${s.cancelledByName})` : ""}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {!s.cancelled && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="today-cancel"
                        disabled={!canAct}
                        onClick={() =>
                          ask({ kind: "cancel", saleId: s.id, label: `"${s.itemText}"` })
                        }
                      >
                        Cancel
                      </Button>
                    )}{" "}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="today-remove"
                      disabled={!canAct}
                      onClick={() =>
                        ask({ kind: "remove-sale", saleId: s.id, label: `"${s.itemText}"` })
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRemoved && (
        <section
          data-testid="today-removed"
          aria-labelledby="today-removed-title"
          className="mt-6 opacity-70"
        >
          <h2 id="today-removed-title" className="text-sm font-medium text-muted-foreground">
            Removed (not counted anywhere)
          </h2>
          {day.removed.sales.length + day.removed.openingFloats.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing removed on this day.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {day.removed.openingFloats.map((o, i) => (
                <li
                  key={`opening-${i}`}
                  data-testid="today-removed-row"
                  className="surface flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-through">
                      Opening change {formatSatang(o.amountSatang)} · {o.time} · {o.staffName}
                    </p>
                    <p className="text-xs">
                      Removed by {o.removedByName} at {o.removedAt}: {o.reason}
                      {!o.canRestore && " · replaced by a newer opening change"}
                    </p>
                  </div>
                  {o.canRestore && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="today-restore"
                      disabled={!canAct}
                      onClick={() => void restore({ kind: "opening", id: day.date })}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
              {day.removed.sales.map((s) => (
                <li
                  key={s.id}
                  data-testid="today-removed-row"
                  className="surface flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-through">
                      {s.time} · {s.itemText} · {formatSatang(s.amountSatang)} ·{" "}
                      {PAYMENT_LABEL[s.payment]} · {s.staffName}
                      {s.cancelled && " · Cancelled"}
                    </p>
                    <p className="text-xs">
                      Removed by {s.removedByName} at {s.removedAt}: {s.reason}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="today-restore"
                    disabled={!canAct}
                    onClick={() => void restore({ kind: "sale", id: s.id })}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "cancel" ? "Cancel this sale?" : "Remove this entry?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "cancel"
                ? `${pending.label} stays in the list, marked as cancelled, and no longer counts toward the totals.`
                : `${pending?.label ?? "It"} is hidden from every list and total. It is not deleted: you can show and restore it with "Show removed".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="today-reason">Reason (required)</Label>
            <Input
              id="today-reason"
              data-testid="today-reason"
              autoComplete="off"
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" data-testid="today-dialog-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="today-dialog-keep">Back</AlertDialogCancel>
            <Button
              type="button"
              data-testid="today-dialog-confirm"
              disabled={!canAct || !reasonOk}
              onClick={() => void confirm()}
            >
              {pending?.kind === "cancel" ? "Cancel sale" : "Remove"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  );
}
