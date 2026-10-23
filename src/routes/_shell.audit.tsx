import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { F } from "@/components/FilterSelect";
import {
  EmptyState,
  OwnerOnly,
  PageHeader,
  SampleTag,
  StatusBadge,
  useEmployeeName,
  type Tone,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { dayKey, downloadCSV, fmtDateTime } from "@/lib/format";
import type { AuditResult } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/audit")({
  head: pageHead(
    "Audit trail",
    "Read-only history of sales, approvals, stock, cash and security events.",
  ),
  component: () => (
    <OwnerOnly>
      <Audit />
    </OwnerOnly>
  ),
});

const RESULT: Record<AuditResult, { label: string; tone: Tone }> = {
  success: { label: "Success", tone: "success" },
  failure: { label: "Failure", tone: "danger" },
  pending: { label: "Pending", tone: "warning" },
};

function Audit() {
  const s = useDemoState();
  const name = useEmployeeName();
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("all");
  const [action, setAction] = useState("all");
  const [from, setFrom] = useState("2026-10-08");
  const [to, setTo] = useState("2026-12-31");
  const [hideSales, setHideSales] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const groups = useMemo(
    () => Array.from(new Set(s.audit.map((a) => a.action.split(".")[0] ?? a.action))).sort(),
    [s.audit],
  );
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return s.audit.filter((a) => {
      const k = dayKey(a.at);
      return (
        k >= from &&
        k <= to &&
        (!hideSales || a.action !== "sale.completed") &&
        (actor === "all" || a.actorId === actor) &&
        (action === "all" || a.action.startsWith(`${action}.`)) &&
        (!t ||
          a.action.includes(t) ||
          a.target.toLowerCase().includes(t) ||
          a.summary.toLowerCase().includes(t))
      );
    });
  }, [s.audit, q, actor, action, from, to, hideSales]);
  const sel = s.audit.find((a) => a.id === open);

  const exportCsv = () => {
    try {
      downloadCSV("audit-demo.csv", [
        ["Timestamp", "Actor", "Action", "Target", "Result", "Summary"],
        ...rows.map((a) => [a.at, name(a.actorId), a.action, a.target, a.result, a.summary]),
      ]);
      setExportErr(null);
    } catch {
      setExportErr("Export failed. The audit view is unchanged; try again.");
    }
  };

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Read-only. Events cannot be edited or deleted here."
        actions={
          <>
            <SampleTag />
            <Button variant="outline" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
          </>
        }
      />
      <div className="mb-4 flex gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
        <ShieldAlert className="size-4 shrink-0" />
        <p>
          This demo log lives in your browser and is not tamper-proof. Real integrity (append-only
          storage, server-side writes) must be provided by the backend.
        </p>
      </div>
      {exportErr && (
        <p
          className="mb-4 rounded-md bg-destructive-soft p-2 text-sm text-destructive"
          role="alert"
        >
          {exportErr}
        </p>
      )}
      <div className="surface mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input
          placeholder="Search action, target, summary"
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
          value={actor}
          onChange={setActor}
          label="Actor"
          opts={[
            ["all", "All actors"],
            ...s.employees.map((e) => [e.id, e.name] as [string, string]),
            ["unknown", "Unknown"],
          ]}
        />
        <F
          value={action}
          onChange={setAction}
          label="Action"
          opts={[
            ["all", "All actions"],
            ...groups.map((g) => [g, g.replace("_", " ")] as [string, string]),
          ]}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground lg:col-span-6">
          <input
            type="checkbox"
            checked={hideSales}
            onChange={(e) => setHideSales(e.target.checked)}
          />{" "}
          Hide routine “sale completed” events
        </label>
      </div>
      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No events match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Timestamp</th>
                  <th className="px-2 font-medium">Actor</th>
                  <th className="px-2 font-medium">Action</th>
                  <th className="px-2 font-medium">Target</th>
                  <th className="px-2 font-medium">Result</th>
                  <th className="px-4 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, 300).map((a) => (
                  <tr
                    key={a.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setOpen(a.id)}
                  >
                    <td className="num whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                      {fmtDateTime(a.at)}
                    </td>
                    <td className="px-2">{name(a.actorId)}</td>
                    <td className="px-2 font-mono text-xs">{a.action}</td>
                    <td className="px-2 font-mono text-xs">{a.target}</td>
                    <td className="px-2">
                      <StatusBadge tone={RESULT[a.result].tone}>
                        {RESULT[a.result].label}
                      </StatusBadge>
                    </td>
                    <td className="max-w-xs truncate px-4 text-muted-foreground">{a.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{rows.length} events</p>
      </div>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {sel && (
            <>
              <SheetHeader className="px-0">
                <SheetTitle className="font-mono text-base">{sel.action}</SheetTitle>
              </SheetHeader>
              <dl className="space-y-2 px-4 text-sm">
                {[
                  ["Event ID", sel.id],
                  ["Timestamp", fmtDateTime(sel.at)],
                  ["Actor", name(sel.actorId)],
                  ["Target", sel.target],
                  ["Result", RESULT[sel.result].label],
                  ["Summary", sel.summary],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[100px_1fr] gap-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 flex items-center gap-1.5 px-4 text-xs text-muted-foreground">
                <Lock className="size-3" /> Read-only record
              </p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
