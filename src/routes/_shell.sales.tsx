import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Printer, RotateCcw, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { F } from "@/components/FilterSelect";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  PageHeader,
  PAYMENT_STATUS,
  SALE_STATUS,
  SampleTag,
  StatusBadge,
  useEmployeeName,
} from "@/components/common";
import { Receipt } from "@/components/sales/Receipt";
import { useDemoState } from "@/lib/repository/demo-store";
import { repo } from "@/lib/repository";
import { dayKey, downloadCSV, fmtDateTime, fmtTHB } from "@/lib/format";
import { DEMO_TODAY } from "@/data/demo-seed";
import { pageHead } from "@/lib/seo";

type Search = {
  receipt?: string | undefined;
  method?: string | undefined;
  verification?: string | undefined;
};

export const Route = createFileRoute("/_shell/sales")({
  head: pageHead(
    "Sales",
    "Searchable transaction history with receipts, payments and refund history.",
  ),
  validateSearch: (s: Record<string, unknown>): Search => ({
    receipt: typeof s["receipt"] === "string" ? s["receipt"] : undefined,
    method: typeof s["method"] === "string" ? s["method"] : undefined,
    verification: typeof s["verification"] === "string" ? s["verification"] : undefined,
  }),
  component: Sales,
});

function Sales() {
  const s = useDemoState();
  const search = Route.useSearch();
  const nav = useNavigate({ from: "/sales" });
  const name = useEmployeeName();
  const isOwner = s.role === "owner";
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(isOwner ? "2026-10-09" : DEMO_TODAY);
  const [to, setTo] = useState(DEMO_TODAY);
  const [emp, setEmp] = useState("all");
  const [method, setMethod] = useState(search.method ?? "all");
  const [status, setStatus] = useState("all");
  const [ver, setVer] = useState(search.verification ?? "all");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const payBy = useMemo(() => new Map(s.payments.map((p) => [p.saleId, p])), [s.payments]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return s.sales
      .filter((x) => {
        const k = dayKey(x.createdAt);
        const p = payBy.get(x.id);
        if (!isOwner && x.employeeId !== s.currentUserId) return false;
        return (
          k >= from &&
          k <= to &&
          (emp === "all" || x.employeeId === emp) &&
          (method === "all" || x.paymentMethod === method) &&
          (status === "all" || x.status === status) &&
          (ver === "all" || p?.status === ver) &&
          (!min || x.total >= Number(min)) &&
          (!max || x.total <= Number(max)) &&
          (!t ||
            x.receiptNo.toLowerCase().includes(t) ||
            x.items.some((i) => i.name.toLowerCase().includes(t)))
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [s.sales, s.currentUserId, isOwner, payBy, q, from, to, emp, method, status, ver, min, max]);

  const selected = s.sales.find((x) => x.id === search.receipt);

  return (
    <>
      <PageHeader
        title="Sales"
        description={
          isOwner
            ? "Completed receipts are historical records and cannot be edited."
            : "Your recent sales. Older history is visible to the owner."
        }
        actions={
          <>
            <SampleTag />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCSV("sales-demo.csv", [
                  ["Receipt", "Date", "Employee", "Method", "Total", "Payment status", "Status"],
                  ...rows.map((r) => [
                    r.receiptNo,
                    r.createdAt,
                    name(r.employeeId),
                    r.paymentMethod,
                    r.total,
                    payBy.get(r.id)?.status ?? "",
                    r.status,
                  ]),
                ])
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      <div className="surface mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input
          placeholder="Receipt or product"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="lg:col-span-2"
          aria-label="Search"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
        />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <F
          value={method}
          onChange={setMethod}
          label="Method"
          opts={[
            ["all", "All methods"],
            ["cash", "Cash"],
            ["qr", "QR / transfer"],
          ]}
        />
        <F
          value={status}
          onChange={setStatus}
          label="Status"
          opts={[
            ["all", "All statuses"],
            ["completed", "Completed"],
            ["refunded", "Refunded"],
            ["voided", "Voided"],
          ]}
        />
        {isOwner && (
          <F
            value={emp}
            onChange={setEmp}
            label="Employee"
            opts={[
              ["all", "All staff"],
              ...s.employees.map((e) => [e.id, e.name] as [string, string]),
            ]}
          />
        )}
        <F
          value={ver}
          onChange={setVer}
          label="Verification"
          opts={[
            ["all", "Any verification"],
            ...Object.entries(PAYMENT_STATUS).map(([k, v]) => [k, v.label] as [string, string]),
          ]}
        />
        <Input
          placeholder="Min ฿"
          inputMode="numeric"
          value={min}
          onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
          aria-label="Minimum amount"
        />
        <Input
          placeholder="Max ฿"
          inputMode="numeric"
          value={max}
          onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))}
          aria-label="Maximum amount"
        />
      </div>

      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No transactions match" body="Adjust the filters or date range." />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Receipt</th>
                  <th className="px-2 font-medium">Date</th>
                  <th className="px-2 font-medium">Employee</th>
                  <th className="px-2 font-medium">Items</th>
                  <th className="px-2 font-medium">Method</th>
                  <th className="px-2 text-right font-medium">Total</th>
                  <th className="px-2 font-medium">Payment</th>
                  <th className="px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, 150).map((x) => {
                  const p = payBy.get(x.id);
                  return (
                    <tr
                      key={x.id}
                      className="cursor-pointer hover:bg-muted/60"
                      onClick={() => nav({ search: (o) => ({ ...o, receipt: x.id }) })}
                    >
                      <td className="px-4 py-2.5 font-medium">{x.receiptNo}</td>
                      <td className="num px-2 text-muted-foreground">{fmtDateTime(x.createdAt)}</td>
                      <td className="px-2">{name(x.employeeId)}</td>
                      <td className="num px-2">{x.items.reduce((a, i) => a + i.qty, 0)}</td>
                      <td className="px-2">{x.paymentMethod === "cash" ? "Cash" : "QR"}</td>
                      <td className="num px-2 text-right font-medium">{fmtTHB(x.total)}</td>
                      <td className="px-2">
                        {p && (
                          <StatusBadge tone={PAYMENT_STATUS[p.status].tone}>
                            {PAYMENT_STATUS[p.status].label}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="px-4">
                        <StatusBadge tone={SALE_STATUS[x.status].tone}>
                          {SALE_STATUS[x.status].label}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="divide-y md:hidden">
              {rows.slice(0, 100).map((x) => (
                <li key={x.id}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => nav({ search: (o) => ({ ...o, receipt: x.id }) })}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{x.receiptNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(x.createdAt)} · {x.paymentMethod === "cash" ? "Cash" : "QR"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-sm font-medium">{fmtTHB(x.total)}</div>
                      <StatusBadge tone={SALE_STATUS[x.status].tone}>
                        {SALE_STATUS[x.status].label}
                      </StatusBadge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {rows.length} transactions{rows.length > 150 ? " (showing latest 150)" : ""}
            </p>
          </>
        )}
      </div>

      <Sheet
        open={!!selected}
        onOpenChange={(o) => !o && nav({ search: (x) => ({ ...x, receipt: undefined }) })}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && <SaleDetail saleId={selected.id} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SaleDetail({ saleId }: { saleId: string }) {
  const s = useDemoState();
  const name = useEmployeeName();
  const sale = s.sales.find((x) => x.id === saleId)!;
  const pay = s.payments.find((p) => p.saleId === saleId);
  const refunds = s.refunds.filter((r) => r.saleId === saleId);
  const moves = s.movements.filter((m) => m.reference === sale.receiptNo);
  const events = s.audit.filter((a) => a.target === sale.receiptNo);
  const pendingRefund = s.approvals.find(
    (a) => a.saleId === saleId && a.type === "refund" && a.status === "pending",
  );
  const [layout, setLayout] = useState<"thermal" | "page">("thermal");
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setBusy(true);
    const r = await repo.requestRefund(saleId, reason);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`${r.data.number} submitted for owner approval`);
    setRefundOpen(false);
    setReason("");
  };

  return (
    <>
      <SheetHeader className="px-0">
        <SheetTitle className="flex items-center gap-2">
          {sale.receiptNo}{" "}
          <StatusBadge tone={SALE_STATUS[sale.status].tone}>
            {SALE_STATUS[sale.status].label}
          </StatusBadge>
        </SheetTitle>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sale.status !== "completed" || !!pendingRefund}
            onClick={() => setRefundOpen(true)}
          >
            <RotateCcw />{" "}
            {pendingRefund ? `Refund pending (${pendingRefund.number})` : "Request refund"}
          </Button>
          <Tabs value={layout} onValueChange={(v) => setLayout(v as "thermal" | "page")}>
            <TabsList className="h-8">
              <TabsTrigger value="thermal" className="text-xs">
                Thermal
              </TabsTrigger>
              <TabsTrigger value="page" className="text-xs">
                A4
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="rounded-md border bg-card p-4">
          <Receipt
            sale={sale}
            payment={pay}
            settings={s.settings}
            employee={name(sale.employeeId)}
            layout={layout}
          />
        </div>
        {pay && (
          <Section title="Payment record">
            <KV k="Method" v={pay.method === "cash" ? "Cash" : "QR / transfer"} />
            <KV k="Expected" v={fmtTHB(pay.expected)} />
            <KV k="Recorded" v={fmtTHB(pay.recorded)} />
            {pay.reference && <KV k="Reference" v={pay.reference} />}
            <KV k="Status" v={PAYMENT_STATUS[pay.status].label} />
            {pay.verifiedBy && (
              <KV k="Verified by" v={`${name(pay.verifiedBy)} · ${fmtDateTime(pay.verifiedAt!)}`} />
            )}
            {pay.verificationNote && (
              <p className="text-xs text-muted-foreground">{pay.verificationNote}</p>
            )}
          </Section>
        )}
        <Section title="Refund history">
          {refunds.length === 0 ? (
            <p className="text-xs text-muted-foreground">No refunds.</p>
          ) : (
            refunds.map((r) => (
              <KV key={r.id} k={fmtDateTime(r.at)} v={`${fmtTHB(r.amount)} · ${r.reason}`} />
            ))
          )}
        </Section>
        <Section title="Inventory movements">
          {moves.map((m) => (
            <KV
              key={m.id}
              k={`${m.type.replace("_", " ")} · ${fmtDateTime(m.at)}`}
              v={`${m.qty > 0 ? "+" : ""}${m.qty}`}
            />
          ))}
        </Section>
        <Section title="Audit events">
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">None.</p>
          ) : (
            events.map((e) => (
              <KV key={e.id} k={`${e.action} · ${name(e.actorId)}`} v={fmtDateTime(e.at)} />
            ))
          )}
          <p className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground">
            <ScrollText className="size-3" /> Read-only history
          </p>
        </Section>
      </div>
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request refund</DialogTitle>
            <DialogDescription className="num">
              {sale.receiptNo} · {fmtTHB(sale.total)}. The owner must approve before money or stock
              changes.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="rr">Reason</Label>
          <Textarea
            id="rr"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong size, item unworn with tags"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button onClick={request} disabled={busy || !reason.trim()}>
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="capitalize text-muted-foreground">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}
