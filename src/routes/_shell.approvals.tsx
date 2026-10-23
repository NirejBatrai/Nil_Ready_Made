import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { F } from "@/components/FilterSelect";
import {
  APPROVAL_STATUS,
  EmptyState,
  PageHeader,
  SampleTag,
  StatusBadge,
  useEmployeeName,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { findVariant, repo } from "@/lib/repository";
import { fmtDateTime, fmtTHB, variantLabel } from "@/lib/format";
import type { ApprovalRequest, ApprovalType } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/approvals")({
  head: pageHead(
    "Approvals",
    "Refund, discount, price override, stock adjustment and cash discrepancy requests.",
  ),
  component: Approvals,
});

const TYPE_LABEL: Record<ApprovalType, string> = {
  refund: "Refund",
  discount: "Exceptional discount",
  price_override: "Price override",
  stock_adjustment: "Stock adjustment",
  cash_discrepancy: "Cash discrepancy",
  other: "Other",
};

function useSubject() {
  const s = useDemoState();
  return (a: ApprovalRequest) => {
    if (a.saleId) return s.sales.find((x) => x.id === a.saleId)?.receiptNo ?? a.saleId;
    if (a.variantId) {
      const f = findVariant(s, a.variantId);
      return f ? `${f.product.name} · ${variantLabel(f.variant)}` : a.variantId;
    }
    if (a.cashSessionId)
      return `Cash session ${s.cashSessions.find((c) => c.id === a.cashSessionId)?.openedAt.slice(0, 10) ?? ""}`;
    return "—";
  };
}

function amountText(a: ApprovalRequest) {
  if (a.type === "stock_adjustment")
    return `${(a.stockDiff ?? 0) > 0 ? "+" : ""}${a.stockDiff ?? 0} pcs`;
  if (a.type === "discount") return `${a.amount ?? 0}%`;
  if (a.amount === undefined) return "—";
  return fmtTHB(a.amount);
}

function Approvals() {
  const s = useDemoState();
  const name = useEmployeeName();
  const subject = useSubject();
  const isOwner = s.role === "owner";
  const [tab, setTab] = useState("pending");
  const [type, setType] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const rows = s.approvals
    .filter(
      (a) =>
        (isOwner || a.requesterId === s.currentUserId) &&
        (tab === "all" || a.status === tab) &&
        (type === "all" || a.type === type),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sel = s.approvals.find((a) => a.id === open);

  return (
    <>
      <PageHeader
        title={isOwner ? "Approvals" : "My requests"}
        description={
          isOwner
            ? "Decisions here are a demo simulation until a secure backend enforces them."
            : "Requests you sent to the owner. You cannot approve your own requests."
        }
        actions={<SampleTag />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <F
          value={type}
          onChange={setType}
          label="Type"
          opts={[["all", "All types"], ...Object.entries(TYPE_LABEL)]}
          className="w-52"
        />
      </div>
      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title="No requests"
            body={tab === "pending" ? "Nothing is waiting for a decision." : undefined}
          />
        ) : (
          <ul className="divide-y">
            {rows.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setOpen(a.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
                >
                  <span className="w-20 font-medium">{a.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{TYPE_LABEL[a.type]}</span>{" "}
                    <span className="text-muted-foreground">· {subject(a)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.reason}</span>
                  </span>
                  <span className="hidden w-32 text-xs text-muted-foreground sm:block">
                    {name(a.requesterId)}
                    <br />
                    {fmtDateTime(a.createdAt)}
                  </span>
                  <span className="num w-20 text-right font-medium">{amountText(a)}</span>
                  <StatusBadge tone={APPROVAL_STATUS[a.status].tone}>
                    {APPROVAL_STATUS[a.status].label}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sel && <Detail key={sel.id} req={sel} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Detail({ req }: { req: ApprovalRequest }) {
  const s = useDemoState();
  const name = useEmployeeName();
  const subject = useSubject();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"approved" | "rejected" | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = s.role === "owner";
  const own = req.requesterId === s.currentUserId;
  const sale = req.saleId ? s.sales.find((x) => x.id === req.saleId) : undefined;
  const f = req.variantId ? findVariant(s, req.variantId) : undefined;
  const events = s.audit.filter(
    (e) => e.target === req.number || (sale && e.target === sale.receiptNo),
  );

  const decide = async () => {
    if (!confirm) return;
    setBusy(true);
    const r = await repo.decideApproval(req.id, confirm, note);
    setBusy(false);
    setConfirm(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`${req.number} ${confirm} (demo)`);
  };

  return (
    <>
      <SheetHeader className="px-0">
        <SheetTitle className="flex items-center gap-2">
          {req.number}{" "}
          <StatusBadge tone={APPROVAL_STATUS[req.status].tone}>
            {APPROVAL_STATUS[req.status].label}
          </StatusBadge>
        </SheetTitle>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-6 text-sm">
        <dl className="space-y-1.5">
          <KV k="Type" v={TYPE_LABEL[req.type]} />
          <KV k="Requested by" v={name(req.requesterId)} />
          <KV k="Requested at" v={fmtDateTime(req.createdAt)} />
          <KV k="Related" v={subject(req)} />
          <KV
            k={req.type === "stock_adjustment" ? "Stock difference" : "Amount"}
            v={amountText(req)}
          />
          {f && <KV k="Current recorded stock" v={String(f.variant.stock)} />}
          {sale && <KV k="Sale total" v={fmtTHB(sale.total)} />}
        </dl>
        <div>
          <div className="eyebrow mb-1">Reason</div>
          <p className="rounded-md bg-muted p-2">{req.reason}</p>
        </div>
        {sale && (
          <Link
            to="/sales"
            search={{ receipt: sale.id }}
            className="text-xs font-medium text-primary"
          >
            Open receipt {sale.receiptNo}
          </Link>
        )}
        {req.status !== "pending" && (
          <div className="rounded-md border p-3">
            <div className="eyebrow mb-1">Decision</div>
            <p>
              {APPROVAL_STATUS[req.status].label} by {req.decidedBy ? name(req.decidedBy) : "—"} ·{" "}
              {req.decidedAt ? fmtDateTime(req.decidedAt) : ""}
            </p>
            {req.decisionNote && <p className="mt-1 text-muted-foreground">“{req.decisionNote}”</p>}
          </div>
        )}
        {req.status === "pending" && isOwner && !own && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="dn" className="text-xs">
                Decision note (required to reject)
              </Label>
              <Textarea id="dn" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirm("rejected")}
                disabled={!note.trim()}
              >
                <X /> Reject
              </Button>
              <Button className="flex-1" onClick={() => setConfirm("approved")}>
                <Check /> Approve
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Simulated approval. A real backend must enforce this permission.
            </p>
          </div>
        )}
        {req.status === "pending" && own && (
          <p className="rounded-md bg-warning-soft p-2 text-xs text-warning">
            You submitted this request, so you cannot decide it.
          </p>
        )}
        {req.status === "pending" && !isOwner && !own && (
          <p className="text-xs text-muted-foreground">Only the owner can decide requests.</p>
        )}
        <div>
          <div className="eyebrow mb-1">Related audit events</div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">None.</p>
          ) : (
            events.map((e) => <KV key={e.id} k={e.action} v={fmtDateTime(e.at)} />)
          )}
        </div>
      </div>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "approved" ? "Approve" : "Reject"} {req.number}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "approved"
                ? req.type === "refund"
                  ? "The sale will be marked refunded and items returned to stock."
                  : req.type === "stock_adjustment"
                    ? "A new stock movement will be recorded. History is kept."
                    : req.type === "cash_discrepancy"
                      ? "The session will be marked resolved. The original count is preserved."
                      : "The request will be marked approved."
                : "The requester will see your note."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={decide} disabled={busy}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="num text-right">{v}</dd>
    </div>
  );
}
