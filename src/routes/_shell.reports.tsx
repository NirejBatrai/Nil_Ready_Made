import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OwnerOnly,
  PageHeader,
  Panel,
  SampleTag,
  Stat,
  useEmployeeName,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { findVariant } from "@/lib/repository";
import { lastNDays, periodMetrics } from "@/lib/metrics";
import { CATEGORY_LABEL, dayKey, downloadCSV, fmtTHB, variantLabel } from "@/lib/format";
import { DEMO_TODAY } from "@/data/demo-seed";
import { nth } from "@/lib/assert";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/reports")({
  head: pageHead(
    "Reports",
    "Daily, weekly and monthly sales, refunds, discounts and stock discrepancy reports.",
  ),
  component: () => (
    <OwnerOnly>
      <Reports />
    </OwnerOnly>
  ),
});

type Row = { key: string; qty: number; sales: number; revenue: number };

function group(entries: { key: string; qty: number; revenue: number; saleId: string }[]): Row[] {
  const m = new Map<string, Row & { ids: Set<string> }>();
  for (const e of entries) {
    const r = m.get(e.key) ?? { key: e.key, qty: 0, sales: 0, revenue: 0, ids: new Set<string>() };
    r.qty += e.qty;
    r.revenue += e.revenue;
    r.ids.add(e.saleId);
    r.sales = r.ids.size;
    m.set(e.key, r);
  }
  return [...m.values()]
    .map(({ key, qty, sales, revenue }) => ({ key, qty, sales, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

function Reports() {
  const s = useDemoState();
  const name = useEmployeeName();
  const [period, setPeriod] = useState("week");
  const [end, setEnd] = useState(DEMO_TODAY);
  const days = period === "day" ? 1 : period === "week" ? 7 : 30;
  const from = nth(lastNDays(end, days), 0);
  const m = useMemo(() => periodMetrics(s, from, end), [s, from, end]);

  const lines = m.sales.flatMap((x) => {
    const share = x.subtotal ? 1 - x.discount / x.subtotal : 1;
    return x.items.map((i) => ({
      sale: x,
      item: i,
      revenue: Math.round(i.qty * i.unitPrice * share),
    }));
  });
  const product = group(
    lines.map((l) => ({
      key: l.item.name,
      qty: l.item.qty,
      revenue: l.revenue,
      saleId: l.sale.id,
    })),
  );
  const category = group(
    lines.map((l) => {
      const p = s.products.find((x) => x.id === l.item.productId);
      return {
        key: p ? CATEGORY_LABEL[p.category] : "Other",
        qty: l.item.qty,
        revenue: l.revenue,
        saleId: l.sale.id,
      };
    }),
  );
  const employee = group(
    m.sales.map((x) => ({
      key: name(x.employeeId),
      qty: x.items.reduce((a, i) => a + i.qty, 0),
      revenue: x.total,
      saleId: x.id,
    })),
  );
  const method = group(
    m.sales.map((x) => ({
      key: x.paymentMethod === "cash" ? "Cash" : "QR / transfer",
      qty: x.items.reduce((a, i) => a + i.qty, 0),
      revenue: x.total,
      saleId: x.id,
    })),
  );

  const inRange = (iso: string) => dayKey(iso) >= from && dayKey(iso) <= end;
  const discrepancies = s.movements.filter(
    (mv) => inRange(mv.at) && (mv.type === "approved_correction" || mv.type === "damaged"),
  );
  const cashDiffs = s.cashSessions.filter(
    (c) =>
      c.closedAt &&
      inRange(c.closedAt) &&
      c.countedCash !== undefined &&
      c.expectedAtClose !== undefined &&
      c.countedCash !== c.expectedAtClose,
  );

  const exportSummary = () =>
    downloadCSV(`summary-${from}-${end}.csv`, [
      ["Metric", "Value (THB)"],
      ["Gross sales", m.gross],
      ["Discounts", m.discounts],
      ["Price reductions (list − actual)", m.priceReductions],
      ["Refunds", m.refunds],
      ["Net sales", m.net],
      ["Recorded payments", m.recorded],
      ["Verified payments", m.verified],
      ["Estimated COGS", m.cogs],
      ["Gross profit (estimate)", m.grossProfit ?? "unavailable: incomplete cost data"],
    ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${from} to ${end} · Asia/Bangkok`}
        actions={
          <>
            <SampleTag />
            <Tabs value={period} onValueChange={setPeriod}>
              <TabsList>
                <TabsTrigger value="day">Daily</TabsTrigger>
                <TabsTrigger value="week">Weekly</TabsTrigger>
                <TabsTrigger value="month">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              type="date"
              value={end}
              onChange={(e) => e.target.value && setEnd(e.target.value)}
              className="h-9 w-auto"
              aria-label="Period end"
            />
            <Button variant="outline" size="sm" onClick={exportSummary}>
              Export summary
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross sales" value={fmtTHB(m.gross)} hint={`${m.count} transactions`} />
        <Stat label="Discounts" value={fmtTHB(m.discounts)} />
        <Stat label="Refunds" value={fmtTHB(m.refunds)} />
        <Stat label="Net sales" value={fmtTHB(m.net)} hint="Gross − discounts − refunds" />
        <Stat
          label="Recorded payments"
          value={fmtTHB(m.recorded)}
          hint={`Cash ${fmtTHB(m.cash)} · QR ${fmtTHB(m.qr)}`}
        />
        <Stat
          label="Verified payments"
          value={fmtTHB(m.verified)}
          hint="Manual QR checks + closed cash"
        />
        <Stat
          label="Estimated COGS"
          value={fmtTHB(m.cogs)}
          hint="From cost price at time of sale"
        />
        <Stat
          label="Gross profit (est.)"
          value={m.grossProfit !== undefined ? fmtTHB(m.grossProfit) : "Unavailable"}
          hint={m.grossProfit !== undefined ? "Net − COGS" : "Some items have no cost price"}
          tone={m.grossProfit !== undefined ? undefined : "warning"}
        />
        <Stat
          label="Price reductions"
          value={fmtTHB(m.priceReductions)}
          hint="Below list price, within each item's minimum"
          tone={m.priceReductions ? "warning" : undefined}
        />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        Breakdowns use revenue after discounts, before refunds. Voided sales are excluded.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Breakdown title="By product" rows={product.slice(0, 12)} file="by-product" />
        <Breakdown title="By category" rows={category} file="by-category" />
        <Breakdown title="By employee" rows={employee} file="by-employee" />
        <Breakdown title="By payment method" rows={method} file="by-method" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Stock discrepancies"
          bodyClass="p-0"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCSV("stock-discrepancies.csv", [
                  ["Date", "Item", "Type", "Qty", "Note"],
                  ...discrepancies.map((d) => {
                    const f = findVariant(s, d.variantId);
                    return [
                      d.at,
                      f ? `${f.product.name} ${variantLabel(f.variant)}` : d.variantId,
                      d.type,
                      d.qty,
                      d.note ?? "",
                    ];
                  }),
                ])
              }
            >
              CSV
            </Button>
          }
        >
          {discrepancies.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No approved corrections in this period.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {discrepancies.map((d) => {
                const f = findVariant(s, d.variantId);
                return (
                  <li key={d.id} className="flex justify-between gap-2 px-4 py-2">
                    <span className="truncate">
                      {f?.product.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {d.type.replace("_", " ")}
                      </span>
                    </span>
                    <span className="num font-medium text-destructive">{d.qty}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Cash differences" bodyClass="p-0">
          {cashDiffs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No cash differences in this period.</p>
          ) : (
            <ul className="divide-y text-sm">
              {cashDiffs.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 px-4 py-2">
                  <span>
                    {dayKey(c.openedAt)} · {name(c.employeeId)}
                  </span>
                  <span className="num font-medium text-destructive">
                    {fmtTHB((c.countedCash ?? 0) - (c.expectedAtClose ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function Breakdown({ title, rows, file }: { title: string; rows: Row[]; file: string }) {
  const total = rows.reduce((a, r) => a + r.revenue, 0) || 1;
  return (
    <Panel
      title={title}
      bodyClass="p-0"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            downloadCSV(`${file}.csv`, [
              ["Name", "Units", "Transactions", "Revenue THB"],
              ...rows.map((r) => [r.key, r.qty, r.sales, r.revenue]),
            ])
          }
        >
          CSV
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No sales in this period.</p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.key} className="px-4 py-2">
              <div className="flex justify-between gap-2">
                <span className="truncate">{r.key}</span>
                <span className="num font-medium">{fmtTHB(r.revenue)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(r.revenue / total) * 100}%` }}
                  />
                </div>
                <span className="num w-24 text-right text-[11px] text-muted-foreground">
                  {r.qty} units · {r.sales} tx
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
