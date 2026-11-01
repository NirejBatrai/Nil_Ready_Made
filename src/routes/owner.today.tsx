/**
 * INTERIM Quick Sales, owner view of one business day (decision 0004; retires when slice S9
 * lands). Owner only: `getDayForOwner` runs `requirePermission("quickSales.viewDay")`, which only
 * the owner role has. The `beforeLoad` redirect is only a convenience for signed-out visitors;
 * staff are refused by the server and sent to /login, which sends them to /quick-sales.
 *
 * Shows: a date picker (default today in Bangkok), opening change, total, Cash, QR, number of
 * sales, number cancelled, expected cash (opening + Cash sales) and every sale of the day.
 */
import type { ReactNode } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser } from "@/lib/auth";
import { parseBusinessDay } from "@/lib/bangkok-time";
import { formatSatang } from "@/lib/money";
import { getDayForOwner } from "@/lib/quick-sales";
import { SAFE_MESSAGES } from "@/lib/server-errors";

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
                <th className="px-4 font-medium">Status</th>
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
                  <td className="px-4">{s.cancelled ? "Cancelled" : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  );
}
