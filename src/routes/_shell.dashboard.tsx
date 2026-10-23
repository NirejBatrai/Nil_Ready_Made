import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  OwnerOnly,
  PageHeader,
  Panel,
  PAYMENT_STATUS,
  SampleTag,
  Stat,
  StatusBadge,
  useEmployeeName,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { sessionFigures } from "@/lib/repository";
import { dailySeries, lastNDays, lowStock, periodMetrics, topProducts } from "@/lib/metrics";
import { dayKey, fmtDateTime, fmtTHB, fmtTime, variantLabel } from "@/lib/format";
import { DEMO_TODAY } from "@/data/demo-seed";
import { pageHead } from "@/lib/seo";
import { nth } from "@/lib/assert";

export const Route = createFileRoute("/_shell/dashboard")({
  head: pageHead(
    "Dashboard",
    "Owner overview of sales, payments, stock, approvals and daily closing.",
  ),
  component: () => (
    <OwnerOnly>
      <Dashboard />
    </OwnerOnly>
  ),
});

const tip = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  },
};

function Dashboard() {
  const s = useDemoState();
  const nav = useNavigate();
  const name = useEmployeeName();
  const [day, setDay] = useState(DEMO_TODAY);
  const [range, setRange] = useState("14");
  const m = useMemo(() => periodMetrics(s, day, day), [s, day]);
  const series = useMemo(() => dailySeries(s, lastNDays(day, Number(range))), [s, day, range]);
  const top = useMemo(
    () => topProducts(periodMetrics(s, nth(lastNDays(day, Number(range)), 0), day).sales),
    [s, day, range],
  );
  const low = lowStock(s);
  const pending = s.approvals.filter((a) => a.status === "pending");
  const unresolved = s.cashSessions.filter((c) => c.status === "pending_review");
  const recent = [...m.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const session = s.cashSessions.find((c) => dayKey(c.openedAt) === day);
  const payBy = new Map(s.payments.map((p) => [p.saleId, p]));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Recorded sales are not the same as verified money received."
        actions={
          <>
            <SampleTag />
            <Input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="h-9 w-auto"
              aria-label="Date"
            />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Net sales"
          value={fmtTHB(m.net)}
          hint={`Gross ${fmtTHB(m.gross)} · disc. ${fmtTHB(m.discounts)}`}
          to="/sales"
        />
        <Stat
          label="Transactions"
          value={String(m.count)}
          hint={`Avg ${fmtTHB(m.avg)}`}
          to="/sales"
        />
        <Stat
          label="Cash recorded"
          value={fmtTHB(m.cash)}
          hint="Confirmed at drawer close"
          to="/reconciliation"
        />
        <Stat
          label="QR / transfer recorded"
          value={fmtTHB(m.qr)}
          hint={m.pendingQr ? `${fmtTHB(m.pendingQr)} awaiting verification` : "All verified"}
          to="/payments"
          tone={m.pendingQr ? "warning" : undefined}
        />
        <Stat
          label="Verified payments"
          value={fmtTHB(m.verified)}
          hint="Manually verified QR + closed cash"
          to="/payments"
        />
        <Stat label="Refunds" value={fmtTHB(m.refunds)} to="/approvals" />
        <Stat
          label="Low-stock variants"
          value={String(low.length)}
          to="/inventory"
          tone={low.length ? "warning" : undefined}
        />
        <Stat
          label="Unresolved cash differences"
          value={String(unresolved.length)}
          to="/reconciliation"
          tone={unresolved.length ? "danger" : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Net sales"
          action={
            <Tabs value={range} onValueChange={setRange}>
              <TabsList className="h-8">
                <TabsTrigger value="7" className="text-xs">
                  7d
                </TabsTrigger>
                <TabsTrigger value="14" className="text-xs">
                  14d
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        >
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart
                data={series}
                margin={{ left: -10, right: 8 }}
                onClick={(e) => {
                  const d = (e?.activePayload?.[0]?.payload as { date?: string })?.date;
                  if (d) setDay(d);
                }}
              >
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip {...tip} formatter={(v: number) => fmtTHB(v)} />
                <Area
                  dataKey="net"
                  name="Net sales"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#g)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Click a day to inspect it.</p>
        </Panel>

        <Panel title="Payment methods">
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={series.slice(-7)} margin={{ left: -10 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip {...tip} formatter={(v: number) => fmtTHB(v)} />
                <Bar dataKey="cash" name="Cash" stackId="a" fill="var(--chart-1)" />
                <Bar
                  dataKey="qr"
                  name="QR / transfer"
                  stackId="a"
                  fill="var(--chart-2)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="mr-1.5 inline-block size-2 rounded-full bg-chart-1" />
              Cash <span className="num float-right">{fmtTHB(m.cash)}</span>
            </div>
            <div>
              <span className="mr-1.5 inline-block size-2 rounded-full bg-chart-2" />
              QR <span className="num float-right">{fmtTHB(m.qr)}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel
          title="Recent transactions"
          className="lg:col-span-2"
          bodyClass="p-0"
          action={
            <Link to="/sales" className="text-xs font-medium text-primary">
              View all
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState
              title="No sales on this date"
              body="Pick another date or record a sale at checkout."
            />
          ) : (
            <ul className="divide-y">
              {recent.map((x) => {
                const p = payBy.get(x.id);
                return (
                  <li key={x.id}>
                    <button
                      onClick={() => nav({ to: "/sales", search: { receipt: x.id } })}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="num w-12 text-xs text-muted-foreground">
                        {fmtTime(x.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{x.receiptNo}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {x.items.map((i) => i.name).join(", ")}
                        </span>
                      </span>
                      {p && (
                        <StatusBadge
                          tone={PAYMENT_STATUS[p.status].tone}
                          className="hidden sm:inline-flex"
                        >
                          {PAYMENT_STATUS[p.status].label}
                        </StatusBadge>
                      )}
                      <span className="num w-20 text-right font-medium">{fmtTHB(x.total)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Daily closing">
          {!session ? (
            <EmptyState
              icon={Clock}
              title="No cash session"
              body="No drawer was opened on this date."
            />
          ) : (
            (() => {
              const f = sessionFigures(s, session);
              return (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    {session.status === "open" ? (
                      <Clock className="size-4 text-warning" />
                    ) : session.status === "pending_review" ? (
                      <AlertTriangle className="size-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="size-4 text-success" />
                    )}
                    <span className="font-medium">
                      {session.status === "open"
                        ? "Drawer still open"
                        : session.status === "pending_review"
                          ? "Closed — difference to review"
                          : "Closed"}
                    </span>
                  </div>
                  <Row k="Opened by" v={name(session.employeeId)} />
                  <Row k="Expected cash" v={fmtTHB(f.expected)} />
                  {f.difference !== undefined && <Row k="Difference" v={fmtTHB(f.difference)} />}
                  <Link
                    to="/reconciliation"
                    className="block pt-2 text-xs font-medium text-primary"
                  >
                    Open cash drawer
                  </Link>
                </div>
              );
            })()
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Top sellers" bodyClass="p-0">
          <ul className="divide-y text-sm">
            {top.map((t, i) => (
              <li key={t.name} className="flex items-center gap-2 px-4 py-2">
                <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate">{t.name}</span>
                <span className="num text-xs text-muted-foreground">{t.qty}×</span>
                <span className="num w-20 text-right">{fmtTHB(t.revenue)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Low stock"
          bodyClass="p-0"
          action={
            <Link to="/inventory" className="text-xs font-medium text-primary">
              Inventory
            </Link>
          }
        >
          <ul className="max-h-64 divide-y overflow-y-auto text-sm">
            {low.map(({ product, variant }) => (
              <li key={variant.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0 truncate">
                  {product.name}{" "}
                  <span className="text-xs text-muted-foreground">{variantLabel(variant)}</span>
                </span>
                <StatusBadge tone={variant.stock === 0 ? "danger" : "warning"}>
                  {variant.stock} left
                </StatusBadge>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Pending approvals"
          bodyClass="p-0"
          action={
            <Link to="/approvals" className="text-xs font-medium text-primary">
              Inbox
            </Link>
          }
        >
          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting" />
          ) : (
            <ul className="divide-y text-sm">
              {pending.map((a) => (
                <li key={a.id}>
                  <Link to="/approvals" className="block px-4 py-2 hover:bg-muted">
                    <span className="font-medium">{a.number}</span>{" "}
                    <span className="capitalize text-muted-foreground">
                      {a.type.replace("_", " ")}
                    </span>
                    <div className="truncate text-xs text-muted-foreground">{a.reason}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Recent audit events"
          bodyClass="p-0"
          action={
            <Link to="/audit" className="text-xs font-medium text-primary">
              Audit
            </Link>
          }
        >
          <ul className="divide-y text-sm">
            {s.audit
              .filter((a) => a.action !== "sale.completed")
              .slice(0, 6)
              .map((a) => (
                <li key={a.id} className="px-4 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-mono text-xs">{a.action}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {fmtDateTime(a.at)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {name(a.actorId)} · {a.summary}
                  </div>
                </li>
              ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="num font-medium">{v}</span>
    </div>
  );
}
