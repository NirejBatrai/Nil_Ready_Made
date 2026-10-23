import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Wallet } from "lucide-react";
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
import {
  EmptyState,
  PageHeader,
  Panel,
  SampleTag,
  StatusBadge,
  useEmployeeName,
  type Tone,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { repo, sessionFigures } from "@/lib/repository";
import { denominationTotal, THB_DENOMINATIONS } from "@/lib/calc";
import { dayKey, fmtDate, fmtDateTime, fmtTHB } from "@/lib/format";
import { periodMetrics } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { CashSession, CashSessionStatus } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/reconciliation")({
  head: pageHead(
    "Cash drawer",
    "Open and close the cash drawer, count cash by denomination and review discrepancies.",
  ),
  component: Reconciliation,
});

const STATUS: Record<CashSessionStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  balanced: { label: "Balanced", tone: "success" },
  pending_review: { label: "Difference — review", tone: "danger" },
  resolved: { label: "Difference resolved", tone: "neutral" },
};

function Reconciliation() {
  const s = useDemoState();
  const name = useEmployeeName();
  const open = s.cashSessions.find((c) => c.status === "open");
  const [selected, setSelected] = useState<string | null>(null);
  const history = [...s.cashSessions]
    .filter((c) => c.status !== "open")
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const sel = s.cashSessions.find((c) => c.id === selected);

  return (
    <>
      <PageHeader
        title="Cash drawer"
        description="Physical cash only. QR / bank transfers are never part of the drawer."
        actions={<SampleTag />}
      />
      {open ? <OpenSession session={open} /> : <OpenForm />}
      <DailyReport />
      <Panel title="Closed sessions" className="mt-4" bodyClass="p-0">
        <ul className="divide-y">
          {history.map((c) => {
            const f = sessionFigures(s, c);
            return (
              <li key={c.id}>
                <button
                  onClick={() => setSelected(c.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
                >
                  <span className="w-28 font-medium">{fmtDate(c.openedAt)}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{name(c.employeeId)}</span>
                  <span className="num w-28 text-right">Exp. {fmtTHB(f.expected)}</span>
                  <span className="num w-28 text-right">Cnt. {fmtTHB(c.countedCash ?? 0)}</span>
                  <span
                    className={cn(
                      "num w-20 text-right font-medium",
                      f.difference ? "text-destructive" : "text-success",
                    )}
                  >
                    {f.difference ? `${f.difference > 0 ? "+" : ""}${fmtTHB(f.difference)}` : "฿0"}
                  </span>
                  <StatusBadge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusBadge>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {sel && <SessionDetail session={sel} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpenForm() {
  const [float, setFloat] = useState("2000");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await repo.openCashSession(Number(float), notes || undefined);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Cash drawer opened");
  };
  return (
    <Panel title="Open the drawer">
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="fl" className="text-xs">
            Opening float ฿
          </Label>
          <Input
            id="fl"
            inputMode="numeric"
            className="num"
            value={float}
            onChange={(e) => setFloat(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on" className="text-xs">
            Opening notes
          </Label>
          <Input
            id="on"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <Button onClick={submit} disabled={busy || float === ""}>
          <Wallet /> Open drawer
        </Button>
      </div>
    </Panel>
  );
}

function OpenSession({ session }: { session: CashSession }) {
  const s = useDemoState();
  const name = useEmployeeName();
  const f = sessionFigures(s, session);
  const [move, setMove] = useState<"in" | "out" | null>(null);
  const [closing, setClosing] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Current session <StatusBadge tone="info">Open</StatusBadge>
          </span>
        }
        className="lg:col-span-2"
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Opened {fmtDateTime(session.openedAt)} by {name(session.employeeId)}
          {session.openingNotes ? ` · ${session.openingNotes}` : ""}
        </p>
        <div className="num space-y-1.5 text-sm">
          <Line k="Opening float" v={fmtTHB(session.openingFloat)} />
          <Line k="+ Cash sales" v={fmtTHB(f.cashSales)} />
          <Line k="− Cash refunds" v={fmtTHB(f.cashRefunds)} />
          <Line k="+ Other cash in" v={fmtTHB(f.inflows)} />
          <Line k="− Other cash out" v={fmtTHB(f.outflows)} />
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Expected cash in drawer</span>
            <span>{fmtTHB(f.expected)}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setMove("in")}>
            <ArrowDownLeft /> Cash in
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMove("out")}>
            <ArrowUpRight /> Cash out
          </Button>
          <Button size="sm" className="ml-auto" onClick={() => setClosing(true)}>
            Close drawer
          </Button>
        </div>
      </Panel>
      <Panel title="Documented cash movements" bodyClass="p-0">
        {session.cashMovements.length === 0 ? (
          <EmptyState title="None yet" body="Record any cash taken out or added, with a reason." />
        ) : (
          <ul className="divide-y text-sm">
            {session.cashMovements.map((m) => (
              <li key={m.id} className="flex justify-between gap-2 px-4 py-2">
                <span className="min-w-0 truncate">
                  {m.reason}
                  <span className="block text-xs text-muted-foreground">{fmtDateTime(m.at)}</span>
                </span>
                <span
                  className={cn(
                    "num font-medium",
                    m.direction === "out" ? "text-destructive" : "text-success",
                  )}
                >
                  {m.direction === "out" ? "−" : "+"}
                  {fmtTHB(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <MoveDialog sessionId={session.id} direction={move} onClose={() => setMove(null)} />
      <CloseDialog
        key={String(closing)}
        session={session}
        expected={f.expected}
        open={closing}
        onClose={() => setClosing(false)}
      />
    </div>
  );
}

function MoveDialog({
  sessionId,
  direction,
  onClose,
}: {
  sessionId: string;
  direction: "in" | "out" | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const submit = async () => {
    if (!direction) return;
    const r = await repo.addCashMovement(sessionId, direction, Number(amount), reason);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Cash movement recorded");
    setAmount("");
    setReason("");
    onClose();
  };
  return (
    <Dialog open={!!direction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {direction === "in" ? "Cash added to drawer" : "Cash taken from drawer"}
          </DialogTitle>
          <DialogDescription>
            Every movement needs a reason. It is logged in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ma" className="text-xs">
            Amount ฿
          </Label>
          <Input
            id="ma"
            inputMode="numeric"
            className="num"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mr" className="text-xs">
            Reason
          </Label>
          <Input
            id="mr"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Bought receipt paper (receipt kept)"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!amount || !reason.trim()}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  session,
  expected,
  open,
  onClose,
}: {
  session: CashSession;
  expected: number;
  open: boolean;
  onClose: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const counted = denominationTotal(counts);
  const diff = counted - expected;
  const submit = async () => {
    setBusy(true);
    const r = await repo.closeCashSession(session.id, counted, counts, explanation || undefined);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(
      diff === 0 ? "Drawer closed — balanced" : "Drawer closed — difference sent for owner review",
    );
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close drawer — count cash</DialogTitle>
          <DialogDescription>
            Count each note and coin. The expected amount is fixed and will not change to match your
            count.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {THB_DENOMINATIONS.map((d) => (
            <div key={d} className="space-y-1">
              <Label htmlFor={`d${d}`} className="num text-xs">
                ฿{d} {d >= 20 ? "note" : "coin"}
              </Label>
              <Input
                id={`d${d}`}
                inputMode="numeric"
                className="num h-9"
                value={counts[String(d)] ?? ""}
                onChange={(e) =>
                  setCounts((c) => ({
                    ...c,
                    [String(d)]: Number(e.target.value.replace(/\D/g, "")) || 0,
                  }))
                }
              />
            </div>
          ))}
        </div>
        <div className="num space-y-1 rounded-md bg-muted p-3 text-sm">
          <Line k="Expected" v={fmtTHB(expected)} />
          <Line k="Counted" v={fmtTHB(counted)} />
          <div
            className={cn(
              "flex justify-between font-semibold",
              diff !== 0 ? "text-destructive" : "text-success",
            )}
          >
            <span>Difference</span>
            <span>
              {diff > 0 ? "+" : ""}
              {fmtTHB(diff)}
            </span>
          </div>
        </div>
        {diff !== 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="ex" className="text-xs">
              Explanation (required)
            </Label>
            <Textarea
              id="ex"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              placeholder="What might explain the difference?"
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || (diff !== 0 && !explanation.trim())}>
            {busy ? "Closing…" : "Close drawer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionDetail({ session }: { session: CashSession }) {
  const s = useDemoState();
  const name = useEmployeeName();
  const f = sessionFigures(s, session);
  const req = s.approvals.find((a) => a.cashSessionId === session.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Session {fmtDate(session.openedAt)}</DialogTitle>
        <DialogDescription>
          {name(session.employeeId)} · {fmtDateTime(session.openedAt)} –{" "}
          {session.closedAt ? fmtDateTime(session.closedAt) : "open"}
        </DialogDescription>
      </DialogHeader>
      <div className="num space-y-1.5 text-sm">
        <Line k="Opening float" v={fmtTHB(session.openingFloat)} />
        <Line k="Cash sales" v={fmtTHB(f.cashSales)} />
        <Line k="Cash refunds" v={fmtTHB(f.cashRefunds)} />
        <Line k="Other in / out" v={`${fmtTHB(f.inflows)} / ${fmtTHB(f.outflows)}`} />
        <Line k="Expected (snapshot at close)" v={fmtTHB(f.expected)} />
        <Line k="Counted (original)" v={fmtTHB(session.countedCash ?? 0)} />
        <div
          className={cn(
            "flex justify-between font-semibold",
            f.difference ? "text-destructive" : "text-success",
          )}
        >
          <span>Difference</span>
          <span>{fmtTHB(f.difference ?? 0)}</span>
        </div>
      </div>
      {session.explanation && (
        <p className="rounded-md bg-muted p-2 text-xs">
          <b>Employee:</b> {session.explanation}
        </p>
      )}
      {session.ownerNote && (
        <p className="rounded-md bg-success-soft p-2 text-xs text-success">
          <b>Owner:</b> {session.ownerNote}
        </p>
      )}
      <div className="flex items-center gap-2 text-sm">
        {session.status === "pending_review" ? (
          <AlertTriangle className="size-4 text-destructive" />
        ) : (
          <CheckCircle2 className="size-4 text-success" />
        )}
        {STATUS[session.status].label}
        {req && session.status === "pending_review" ? ` — review in Approvals (${req.number})` : ""}
      </div>
    </>
  );
}

function DailyReport() {
  const s = useDemoState();
  const days = useMemo(
    () =>
      Array.from(new Set(s.cashSessions.map((c) => dayKey(c.openedAt))))
        .sort()
        .reverse()
        .slice(0, 7),
    [s.cashSessions],
  );
  return (
    <Panel title="Daily report — cash vs QR" className="mt-4" bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-2 text-right font-medium">Cash recorded</th>
              <th className="px-2 text-right font-medium">QR recorded</th>
              <th className="px-2 text-right font-medium">QR pending</th>
              <th className="px-4 text-right font-medium">Net sales</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {days.map((d) => {
              const m = periodMetrics(s, d, d);
              return (
                <tr key={d}>
                  <td className="px-4 py-2">{d}</td>
                  <td className="num px-2 text-right">{fmtTHB(m.cash)}</td>
                  <td className="num px-2 text-right">{fmtTHB(m.qr)}</td>
                  <td className={cn("num px-2 text-right", m.pendingQr && "text-warning")}>
                    {fmtTHB(m.pendingQr)}
                  </td>
                  <td className="num px-4 text-right font-medium">{fmtTHB(m.net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
