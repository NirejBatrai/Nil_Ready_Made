import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { ClipboardList, History, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { CATEGORY_LABEL, fmtDateTime, variantLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MovementType } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/inventory")({
  head: pageHead(
    "Inventory",
    "Stock levels, movement history, adjustment requests and physical stock counts.",
  ),
  component: Inventory,
});

const MOVE_LABEL: Record<MovementType, string> = {
  opening: "Opening stock",
  sale: "Sale",
  restock: "Restock",
  customer_return: "Customer return",
  approved_correction: "Approved correction",
  damaged: "Damaged",
  other: "Other adjustment",
};

function Inventory() {
  const s = useDemoState();
  const name = useEmployeeName();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState("all");
  const [history, setHistory] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<string | null>(null);

  const rows = useMemo(() => {
    const t = q.toLowerCase();
    const lastMove = new Map<string, string>();
    for (const m of s.movements) {
      const prev = lastMove.get(m.variantId);
      if (!prev || m.at > prev) lastMove.set(m.variantId, m.at);
    }
    return s.products
      .filter((p) => p.active && (cat === "all" || p.category === cat))
      .flatMap((p) =>
        p.variants.map((v) => ({
          p,
          v,
          last: lastMove.get(v.id),
          st: v.stock === 0 ? "out" : v.stock <= p.lowStockThreshold ? "low" : "ok",
        })),
      )
      .filter(
        (r) =>
          (status === "all" || r.st === status) &&
          (!t || r.p.name.toLowerCase().includes(t) || r.v.sku.toLowerCase().includes(t)),
      )
      .sort((a, b) => a.v.stock - b.v.stock);
  }, [s.products, s.movements, q, cat, status]);

  const pendingAdj = s.approvals.filter((a) => a.type === "stock_adjustment");

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Recorded stock changes only through sales, restocks, returns and approved adjustments."
        actions={<SampleTag />}
      />
      <Tabs defaultValue="stock">
        <TabsList className="mb-4">
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="count">Stock count</TabsTrigger>
          <TabsTrigger value="requests">Adjustment requests</TabsTrigger>
          <TabsTrigger value="moves">Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <div className="surface mb-4 grid gap-2 p-3 sm:grid-cols-4">
            <Input
              placeholder="Search product or SKU"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="sm:col-span-2"
              aria-label="Search"
            />
            <F
              value={cat}
              onChange={setCat}
              label="Category"
              opts={[["all", "All categories"], ...Object.entries(CATEGORY_LABEL)]}
            />
            <F
              value={status}
              onChange={setStatus}
              label="Stock status"
              opts={[
                ["all", "Any status"],
                ["low", "Low stock"],
                ["out", "Out of stock"],
                ["ok", "OK"],
              ]}
            />
          </div>
          <div className="surface overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState title="No stock lines match" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Product / variant</th>
                      <th className="px-2 font-medium">SKU</th>
                      <th className="px-2 text-right font-medium">Opening</th>
                      <th className="px-2 text-right font-medium">Recorded</th>
                      <th className="px-2 text-right font-medium">Threshold</th>
                      <th className="px-2 font-medium">Last movement</th>
                      <th className="px-2 font-medium">Status</th>
                      <th className="px-4 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map(({ p, v, last, st }) => (
                      <tr key={v.id} className="hover:bg-muted/40">
                        <td className="px-4 py-2">
                          <span className="font-medium">{p.name}</span>{" "}
                          <span className="text-xs text-muted-foreground">{variantLabel(v)}</span>
                        </td>
                        <td className="px-2 font-mono text-[11px] text-muted-foreground">
                          {v.sku}
                        </td>
                        <td className="num px-2 text-right">{v.openingStock}</td>
                        <td className="num px-2 text-right font-medium">{v.stock}</td>
                        <td className="num px-2 text-right text-muted-foreground">
                          {p.lowStockThreshold}
                        </td>
                        <td className="num px-2 text-xs text-muted-foreground">
                          {last ? fmtDateTime(last) : "—"}
                        </td>
                        <td className="px-2">
                          {st === "out" ? (
                            <StatusBadge tone="danger">Out</StatusBadge>
                          ) : st === "low" ? (
                            <StatusBadge tone="warning">Low</StatusBadge>
                          ) : (
                            <StatusBadge tone="success">OK</StatusBadge>
                          )}
                        </td>
                        <td className="px-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Movement history"
                            onClick={() => setHistory(v.id)}
                          >
                            <History />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Request adjustment"
                            onClick={() => setAdjust(v.id)}
                          >
                            <SlidersHorizontal />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="count">
          <StockCount />
        </TabsContent>

        <TabsContent value="requests">
          <div className="surface overflow-hidden">
            {pendingAdj.length === 0 ? (
              <EmptyState title="No adjustment requests" />
            ) : (
              <ul className="divide-y">
                {pendingAdj.map((a) => {
                  const f = a.variantId ? findVariant(s, a.variantId) : undefined;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="font-medium">{a.number}</span>
                      <span className="min-w-0 flex-1">
                        {f ? `${f.product.name} · ${variantLabel(f.variant)}` : "—"}
                        <span className="block text-xs text-muted-foreground">
                          {a.reason} · {name(a.requesterId)} · {fmtDateTime(a.createdAt)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "num font-semibold",
                          (a.stockDiff ?? 0) < 0 ? "text-destructive" : "text-success",
                        )}
                      >
                        {(a.stockDiff ?? 0) > 0 ? "+" : ""}
                        {a.stockDiff}
                      </span>
                      <StatusBadge tone={APPROVAL_STATUS[a.status].tone}>
                        {APPROVAL_STATUS[a.status].label}
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="moves">
          <Movements />
        </TabsContent>
      </Tabs>

      <Sheet open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {history && <VariantHistory variantId={history} />}
        </SheetContent>
      </Sheet>
      <AdjustDialog variantId={adjust} onClose={() => setAdjust(null)} />
    </>
  );
}

function VariantHistory({ variantId }: { variantId: string }) {
  const s = useDemoState();
  const name = useEmployeeName();
  const f = findVariant(s, variantId);
  const moves = s.movements
    .filter((m) => m.variantId === variantId)
    .sort((a, b) => a.at.localeCompare(b.at));
  let running = 0;
  const rows = moves.map((m) => ({ m, bal: (running += m.qty) }));
  return (
    <>
      <SheetHeader className="px-0">
        <SheetTitle>
          {f?.product.name} · {f && variantLabel(f.variant)}
        </SheetTitle>
      </SheetHeader>
      <p className="px-4 text-xs text-muted-foreground">
        Complete history — corrections are added as new lines, never overwritten.
      </p>
      <ul className="mt-3 divide-y px-4">
        {[...rows].reverse().map(({ m, bal }) => (
          <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{MOVE_LABEL[m.type]}</div>
              <div className="truncate text-xs text-muted-foreground">
                {fmtDateTime(m.at)} · {name(m.actorId)}
                {m.reference ? ` · ${m.reference}` : ""}
                {m.note ? ` · ${m.note}` : ""}
              </div>
            </div>
            <span
              className={cn(
                "num w-10 text-right font-medium",
                m.qty < 0 ? "text-destructive" : "text-success",
              )}
            >
              {m.qty > 0 ? "+" : ""}
              {m.qty}
            </span>
            <span className="num w-10 text-right text-muted-foreground">{bal}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function AdjustDialog({ variantId, onClose }: { variantId: string | null; onClose: () => void }) {
  const s = useDemoState();
  const f = variantId ? findVariant(s, variantId) : undefined;
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("damaged");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const diff = f && counted !== "" ? Number(counted) - f.variant.stock : 0;
  const REASONS: [string, string][] = [
    ["damaged", "Damaged item"],
    ["miscount", "Count correction"],
    ["found", "Found stock"],
    ["other", "Other documented reason"],
  ];
  const submit = async () => {
    if (!variantId) return;
    setBusy(true);
    const label = REASONS.find(([k]) => k === reason)?.[1] ?? reason;
    const r = await repo.requestStockAdjustment(
      variantId,
      diff,
      `${label}${notes ? `: ${notes}` : ""}`,
    );
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`${r.data.number} sent for owner approval — stock unchanged until approved`);
    setCounted("");
    setNotes("");
    onClose();
  };
  return (
    <Dialog open={!!variantId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request stock adjustment</DialogTitle>
          <DialogDescription>
            {f ? `${f.product.name} · ${variantLabel(f.variant)}` : ""}. Recorded stock only changes
            after owner approval.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <Label className="text-xs">Current</Label>
            <div className="num mt-2 text-lg font-semibold">{f?.variant.stock}</div>
          </div>
          <div>
            <Label htmlFor="cq" className="text-xs">
              Counted
            </Label>
            <Input
              id="cq"
              inputMode="numeric"
              value={counted}
              onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))}
              className="num mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Difference</Label>
            <div
              className={cn(
                "num mt-2 text-lg font-semibold",
                diff < 0 && "text-destructive",
                diff > 0 && "text-success",
              )}
            >
              {diff > 0 ? "+" : ""}
              {diff}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Reason</Label>
          <F value={reason} onChange={setReason} label="Reason" opts={REASONS} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="an" className="text-xs">
            Notes (optional)
          </Label>
          <Textarea id="an" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || counted === "" || diff === 0}>
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockCount() {
  const s = useDemoState();
  const name = useEmployeeName();
  const [step, setStep] = useState<"idle" | "select" | "count" | "review">("idle");
  const [cat, setCat] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const products = s.products.filter((p) => p.active && (cat === "all" || p.category === cat));
  const lines = selected.flatMap((id) => {
    const f = findVariant(s, id);
    return f ? [{ ...f, counted: counts[id] }] : [];
  });
  const variances = lines.filter(
    (l) => l.counted !== undefined && l.counted !== "" && Number(l.counted) !== l.variant.stock,
  );
  const toggleProduct = (ids: string[], on: boolean) =>
    setSelected((cur) =>
      on ? Array.from(new Set([...cur, ...ids])) : cur.filter((x) => !ids.includes(x)),
    );

  const submit = async () => {
    setBusy(true);
    const r = await repo.submitStockCount(
      lines.map((l) => ({ variantId: l.variant.id, counted: Number(l.counted) })),
    );
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(
      r.data.requests
        ? `Count submitted — ${r.data.requests} variance(s) sent for approval`
        : "Count submitted — no variances",
    );
    setStep("idle");
    setSelected([]);
    setCounts({});
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="surface lg:col-span-2">
        <div className="flex items-center gap-2 border-b px-4 py-3 text-xs">
          {(["select", "count", "review"] as const).map((k, i) => (
            <span
              key={k}
              className={cn(
                "rounded-full px-2.5 py-1",
                step === k
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}. {k === "select" ? "Select items" : k === "count" ? "Enter counts" : "Review"}
            </span>
          ))}
        </div>
        {step === "idle" && (
          <EmptyState
            icon={ClipboardList}
            title="Start a physical stock count"
            body="Choose the items you will count, enter physical quantities and compare them with recorded stock."
            action={
              <Button className="mt-2" onClick={() => setStep("select")}>
                Start stock count
              </Button>
            }
          />
        )}
        {step === "select" && (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <F
                value={cat}
                onChange={setCat}
                label="Category"
                opts={[["all", "All categories"], ...Object.entries(CATEGORY_LABEL)]}
                className="w-48"
              />
              <span className="text-xs text-muted-foreground">
                {selected.length} variants selected
              </span>
            </div>
            <ul className="max-h-[420px] divide-y overflow-y-auto rounded-md border">
              {products.map((p) => {
                const ids = p.variants.map((v) => v.id);
                const on = ids.every((id) => selected.includes(id));
                return (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(c) => toggleProduct(ids, c === true)}
                      />
                      <span className="flex-1">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.variants.length} variant(s)
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("idle")}>
                Cancel
              </Button>
              <Button disabled={!selected.length} onClick={() => setStep("count")}>
                Next
              </Button>
            </div>
          </div>
        )}
        {step === "count" && (
          <div className="p-4">
            <ul className="max-h-[460px] divide-y overflow-y-auto rounded-md border">
              {lines.map((l) => (
                <li key={l.variant.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {l.product.name}{" "}
                    <span className="text-xs text-muted-foreground">{variantLabel(l.variant)}</span>
                  </span>
                  <Input
                    aria-label={`Counted ${l.product.name} ${variantLabel(l.variant)}`}
                    inputMode="numeric"
                    className="num h-9 w-20"
                    value={counts[l.variant.id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({
                        ...c,
                        [l.variant.id]: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Recorded quantities are hidden while counting to avoid bias.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button disabled={lines.some((l) => !l.counted)} onClick={() => setStep("review")}>
                Compare
              </Button>
            </div>
          </div>
        )}
        {step === "review" && (
          <div className="p-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Item</th>
                  <th className="text-right font-medium">Recorded</th>
                  <th className="text-right font-medium">Counted</th>
                  <th className="text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l) => {
                  const d = Number(l.counted) - l.variant.stock;
                  return (
                    <tr key={l.variant.id} className={cn(d !== 0 && "bg-warning-soft/50")}>
                      <td className="py-1.5">
                        {l.product.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          {variantLabel(l.variant)}
                        </span>
                      </td>
                      <td className="num text-right">{l.variant.stock}</td>
                      <td className="num text-right">{l.counted}</td>
                      <td
                        className={cn(
                          "num text-right font-medium",
                          d < 0 && "text-destructive",
                          d > 0 && "text-success",
                        )}
                      >
                        {d > 0 ? "+" : ""}
                        {d}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-sm">
              {variances.length
                ? `${variances.length} variance(s) will be sent to the owner as adjustment requests.`
                : "No variances — counts match recorded stock."}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("count")}>
                Back
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? "Submitting…" : "Submit count for review"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="surface">
        <div className="border-b px-4 py-3 text-sm font-semibold">Previous counts</div>
        {s.stockCounts.length === 0 ? (
          <EmptyState title="No counts yet" />
        ) : (
          <ul className="divide-y text-sm">
            {s.stockCounts.map((c) => {
              const v = c.lines.filter((l) => l.counted !== l.recorded).length;
              return (
                <li key={c.id} className="px-4 py-2.5">
                  <div className="flex justify-between">
                    <span>{fmtDateTime(c.startedAt)}</span>
                    <StatusBadge tone={c.status === "reviewed" ? "success" : "warning"}>
                      {c.status === "reviewed" ? "Reviewed" : "Awaiting approval"}
                    </StatusBadge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {name(c.actorId)} · {c.lines.length} items · {v} variance(s)
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Movements() {
  const s = useDemoState();
  const name = useEmployeeName();
  const [type, setType] = useState("all");
  const rows = s.movements
    .filter((m) => m.type !== "opening" && (type === "all" || m.type === type))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 120);
  return (
    <div className="surface overflow-hidden">
      <div className="border-b p-3">
        <F
          value={type}
          onChange={setType}
          label="Movement type"
          opts={[
            ["all", "All movement types"],
            ...Object.entries(MOVE_LABEL).filter(([k]) => k !== "opening"),
          ]}
          className="w-60"
        />
      </div>
      <ul className="divide-y">
        {rows.map((m) => {
          const f = findVariant(s, m.variantId);
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="num w-28 shrink-0 text-xs text-muted-foreground">
                {fmtDateTime(m.at)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {f?.product.name}{" "}
                <span className="text-xs text-muted-foreground">
                  {f && variantLabel(f.variant)}
                </span>
              </span>
              <span className="hidden w-36 text-xs text-muted-foreground sm:block">
                {MOVE_LABEL[m.type]}
                {m.reference ? ` · ${m.reference}` : ""}
              </span>
              <span className="hidden w-28 truncate text-xs sm:block">{name(m.actorId)}</span>
              <span
                className={cn(
                  "num w-10 text-right font-medium",
                  m.qty < 0 ? "text-destructive" : "text-success",
                )}
              >
                {m.qty > 0 ? "+" : ""}
                {m.qty}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
