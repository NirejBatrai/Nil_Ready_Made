import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { F } from "@/components/FilterSelect";
import {
  EmptyState,
  OwnerOnly,
  PageHeader,
  PAYMENT_STATUS,
  SampleTag,
  Stat,
  StatusBadge,
  useEmployeeName,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { repo } from "@/lib/repository";
import { fmtDateTime, fmtTHB } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Payment } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/payments")({
  head: pageHead(
    "Payments",
    "Cash and QR / bank transfer payment records with manual verification.",
  ),
  validateSearch: (s: Record<string, unknown>): { status?: string | undefined } => ({
    status: typeof s["status"] === "string" ? s["status"] : undefined,
  }),
  component: () => (
    <OwnerOnly>
      <Payments />
    </OwnerOnly>
  ),
});

function Payments() {
  const s = useDemoState();
  const search = Route.useSearch();
  const name = useEmployeeName();
  const [status, setStatus] = useState(search.status ?? "pending");
  const [method, setMethod] = useState("all");
  const [q, setQ] = useState("");
  const [verifying, setVerifying] = useState<Payment | null>(null);
  const saleById = useMemo(() => new Map(s.sales.map((x) => [x.id, x])), [s.sales]);

  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return s.payments
      .filter(
        (p) =>
          (status === "all" || p.status === status) && (method === "all" || p.method === method),
      )
      .filter(
        (p) =>
          !t ||
          saleById.get(p.saleId)?.receiptNo.toLowerCase().includes(t) ||
          p.reference?.toLowerCase().includes(t),
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, 200);
  }, [s.payments, saleById, status, method, q]);

  const count = (st: Payment["status"]) => s.payments.filter((p) => p.status === st);
  const sum = (ps: Payment[]) => fmtTHB(ps.reduce((a, p) => a + p.expected, 0));

  return (
    <>
      <PageHeader
        title="Payments"
        description="Recorded payments are not proof of funds. Verification here is manual."
        actions={<SampleTag />}
      />
      <div className="mb-4 flex gap-2 rounded-md bg-warning-soft p-3 text-xs text-warning">
        <ShieldAlert className="size-4 shrink-0" />
        <p>
          No bank, PromptPay or payment gateway is connected. “Verified” means the owner manually
          checked a bank statement or app and recorded it here — it is not a bank confirmation.
        </p>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button onClick={() => setStatus("pending")} className="text-left">
          <Stat
            label="Awaiting verification"
            value={String(count("pending").length)}
            hint={sum(count("pending"))}
            tone={count("pending").length ? "warning" : undefined}
          />
        </button>
        <button onClick={() => setStatus("failed")} className="text-left">
          <Stat
            label="Failed"
            value={String(count("failed").length)}
            hint={sum(count("failed"))}
            tone={count("failed").length ? "danger" : undefined}
          />
        </button>
        <button onClick={() => setStatus("exception")} className="text-left">
          <Stat
            label="Exceptions"
            value={String(count("exception").length)}
            hint="Amount mismatch"
            tone={count("exception").length ? "danger" : undefined}
          />
        </button>
        <button onClick={() => setStatus("verified")} className="text-left">
          <Stat
            label="Verified (manual)"
            value={String(count("verified").length)}
            hint={sum(count("verified"))}
          />
        </button>
      </div>
      <div className="surface mb-4 grid gap-2 p-3 sm:grid-cols-3">
        <Input
          placeholder="Receipt or reference"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
        />
        <F
          value={status}
          onChange={setStatus}
          label="Status"
          opts={[
            ["all", "All statuses"],
            ["pending", "Awaiting verification"],
            ["verified", "Verified (manual)"],
            ["failed", "Failed"],
            ["exception", "Exception"],
            ["recorded", "Cash recorded"],
          ]}
        />
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
      </div>
      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="Nothing here" body="No payments match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Receipt</th>
                  <th className="px-2 font-medium">Recorded</th>
                  <th className="px-2 font-medium">Method</th>
                  <th className="px-2 font-medium">Reference</th>
                  <th className="px-2 text-right font-medium">Expected</th>
                  <th className="px-2 text-right font-medium">Recorded amt</th>
                  <th className="px-2 font-medium">Status</th>
                  <th className="px-2 font-medium">Verifier</th>
                  <th className="px-4" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((p) => {
                  const sale = saleById.get(p.saleId);
                  return (
                    <tr key={p.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2 font-medium">
                        {sale && (
                          <Link
                            to="/sales"
                            search={{ receipt: sale.id }}
                            className="hover:underline"
                          >
                            {sale.receiptNo}
                          </Link>
                        )}
                      </td>
                      <td className="num px-2 text-xs text-muted-foreground">
                        {fmtDateTime(p.recordedAt)}
                      </td>
                      <td className="px-2">{p.method === "cash" ? "Cash" : "QR"}</td>
                      <td className="px-2 font-mono text-xs">{p.reference ?? "—"}</td>
                      <td className="num px-2 text-right">{fmtTHB(p.expected)}</td>
                      <td
                        className={cn(
                          "num px-2 text-right",
                          p.recorded !== p.expected && "font-semibold text-destructive",
                        )}
                      >
                        {fmtTHB(p.recorded)}
                      </td>
                      <td className="px-2">
                        <StatusBadge tone={PAYMENT_STATUS[p.status].tone}>
                          {PAYMENT_STATUS[p.status].label}
                        </StatusBadge>
                      </td>
                      <td className="px-2 text-xs text-muted-foreground">
                        {p.verifiedBy
                          ? `${name(p.verifiedBy)} · ${p.verifiedAt ? fmtDateTime(p.verifiedAt) : ""}`
                          : p.method === "cash"
                            ? "At drawer close"
                            : "—"}
                      </td>
                      <td className="px-4 text-right">
                        {p.method === "qr" && (
                          <Button
                            size="sm"
                            variant={p.status === "pending" ? "default" : "outline"}
                            onClick={() => setVerifying(p)}
                          >
                            {p.status === "pending" ? "Verify" : "Review"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <VerifyDialog
        key={verifying?.id ?? "none"}
        payment={verifying}
        onClose={() => setVerifying(null)}
      />
    </>
  );
}

function VerifyDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const s = useDemoState();
  const sale = payment ? s.sales.find((x) => x.id === payment.saleId) : undefined;
  const [ref, setRef] = useState(payment?.reference ?? "");
  const [actual, setActual] = useState(payment ? String(payment.expected) : "");
  const [note, setNote] = useState("");
  const [result, setResult] = useState("verified");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!payment) return;
    setBusy(true);
    const r = await repo.verifyPayment(
      payment.id,
      result === "failed" ? "failed" : "verified",
      Number(actual),
      note,
      ref || undefined,
    );
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(
      Number(actual) !== payment.expected && result !== "failed"
        ? "Amount mismatch — marked as exception"
        : "Payment updated (manual verification)",
    );
    onClose();
  };
  return (
    <Dialog
      open={!!payment}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual payment verification</DialogTitle>
          <DialogDescription className="num">
            {sale?.receiptNo} · expected {payment ? fmtTHB(payment.expected) : ""}. Check your bank
            app or statement, then record what you found.
          </DialogDescription>
        </DialogHeader>
        {payment?.verificationNote && (
          <p className="rounded-md bg-muted p-2 text-xs">
            Previous note: {payment.verificationNote}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="vr" className="text-xs">
              Reference number
            </Label>
            <Input id="vr" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="va" className="text-xs">
              Actual amount received ฿
            </Label>
            <Input
              id="va"
              inputMode="numeric"
              className="num"
              value={actual}
              onChange={(e) => setActual(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Result</Label>
          <F
            value={result}
            onChange={setResult}
            label="Result"
            opts={[
              ["verified", "Funds found in bank statement"],
              ["failed", "No matching funds found"],
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vn" className="text-xs">
            Verification source / notes
          </Label>
          <Textarea
            id="vn"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Matched in K PLUS app, 14:32 credit"
            rows={2}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          This will be recorded as a <b>manual</b> verification with your name and the current time.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !note.trim() || actual === ""}>
            Save verification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
