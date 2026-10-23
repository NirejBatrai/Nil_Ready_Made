import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { OwnerOnly, PageHeader, SampleTag, StatusBadge } from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { newId, repo } from "@/lib/repository";
import { fmtDate, fmtDateTime, fmtTHB } from "@/lib/format";
import type { EmployeeProfile } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/employees")({
  head: pageHead("Employees", "Staff directory, roles, status and recent activity."),
  component: () => (
    <OwnerOnly>
      <Employees />
    </OwnerOnly>
  ),
});

const ACCESS = {
  owner: ["Everything, including approvals, costs, audit and settings"],
  employee: [
    "Checkout (cash & QR)",
    "Own sales history",
    "Open / close cash drawer",
    "Submit refund, discount and stock requests",
  ],
};

function Employees() {
  const s = useDemoState();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sel = s.employees.find((e) => e.id === open);
  return (
    <>
      <PageHeader
        title="Employees"
        description={`${s.employees.filter((e) => e.active).length} active accounts`}
        actions={
          <>
            <SampleTag />
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add employee
            </Button>
          </>
        }
      />
      <div className="mb-4 flex gap-2 rounded-md bg-warning-soft p-3 text-xs text-warning">
        <ShieldAlert className="size-4 shrink-0" />
        <p>
          Account management is simulated. No invitations are sent, no passwords exist, and access
          is not enforced until a secure backend is connected.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {s.employees.map((e) => {
          const sales = s.sales.filter((x) => x.employeeId === e.id);
          return (
            <button
              key={e.id}
              onClick={() => setOpen(e.id)}
              className="surface p-4 text-left transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-sage text-sm font-semibold text-sage-foreground">
                  {e.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{e.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{e.email}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <StatusBadge tone={e.role === "owner" ? "primary" : "info"}>
                  {e.role === "owner" ? "Owner" : "Employee"}
                </StatusBadge>
                <StatusBadge tone={e.active ? "success" : "neutral"}>
                  {e.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Last active {fmtDateTime(e.lastActiveAt)} · {sales.length} sales
              </div>
            </button>
          );
        })}
      </div>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sel && <Detail emp={sel} />}
        </SheetContent>
      </Sheet>
      <CreateDialog key={String(creating)} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function Detail({ emp }: { emp: EmployeeProfile }) {
  const s = useDemoState();
  const [confirm, setConfirm] = useState(false);
  const sales = s.sales.filter((x) => x.employeeId === emp.id && x.status !== "voided");
  const events = s.audit
    .filter((a) => a.actorId === emp.id && a.action !== "sale.completed")
    .slice(0, 10);
  const isSelf = emp.id === s.currentUserId;
  const toggle = async () => {
    const r = await repo.saveEmployee({ ...emp, active: !emp.active });
    setConfirm(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(emp.active ? `${emp.name} deactivated (demo)` : `${emp.name} reactivated (demo)`);
  };
  return (
    <>
      <SheetHeader className="px-0">
        <SheetTitle>{emp.name}</SheetTitle>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6 text-sm">
        <dl className="space-y-1.5">
          {[
            ["Email", emp.email],
            ["Phone", emp.phone],
            ["Role", emp.role === "owner" ? "Owner" : "Employee"],
            ["Status", emp.active ? "Active" : "Inactive"],
            ["Joined", fmtDate(emp.createdAt)],
            [
              "Sales recorded",
              `${sales.length} · ${fmtTHB(sales.reduce((a, x) => a + x.total, 0))}`,
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="num text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <div className="eyebrow mb-1">Access</div>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {ACCESS[emp.role].map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="eyebrow mb-1">Sessions</div>
          <div className="flex items-center justify-between rounded-md border p-2 text-xs">
            <span>
              {emp.active
                ? "Shop phone · last seen " + fmtDateTime(emp.lastActiveAt)
                : "No active sessions"}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!emp.active}
              onClick={() =>
                toast("Sign-out of sessions needs the real backend — not available in demo")
              }
            >
              Sign out
            </Button>
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1">Recent activity</div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent activity.</p>
          ) : (
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className="font-mono">{e.action}</span> · {e.summary}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{fmtDateTime(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!isSelf && (
          <Button
            variant={emp.active ? "destructive" : "outline"}
            className="w-full"
            onClick={() => setConfirm(true)}
          >
            {emp.active ? "Deactivate account" : "Reactivate account"}
          </Button>
        )}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {emp.active ? `Deactivate ${emp.name}?` : `Reactivate ${emp.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {emp.active
                ? "They will no longer be able to use checkout. Their sales history stays intact."
                : "They will regain employee access."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggle}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const now = new Date().toISOString();
    const r = await repo.saveEmployee({
      id: newId("emp"),
      name,
      email,
      phone,
      role: "employee",
      active: true,
      lastActiveAt: now,
      createdAt: now,
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Employee added to demo directory — no invite sent");
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>
            In production the backend would send a secure invitation; the employee sets their own
            password. Nothing is sent in this demo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="en" className="text-xs">
            Full name
          </Label>
          <Input id="en" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ee" className="text-xs">
            Email
          </Label>
          <Input id="ee" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ep" className="text-xs">
            Phone
          </Label>
          <Input id="ep" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Role: Employee</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Add employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
