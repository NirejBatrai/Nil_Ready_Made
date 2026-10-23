import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { OwnerOnly, PageHeader, Panel, SampleTag, StatusBadge } from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { repo } from "@/lib/repository";
import type { ShopSettings } from "@/types/domain";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_shell/settings")({
  head: pageHead(
    "Settings",
    "Shop profile, receipts, stock thresholds, discount and refund policies.",
  ),
  component: () => (
    <OwnerOnly>
      <SettingsPage />
    </OwnerOnly>
  ),
});

function SettingsPage() {
  const s = useDemoState();
  return <Form key={JSON.stringify(s.settings)} initial={s.settings} />;
}

function Form({ initial }: { initial: ShopSettings }) {
  const [st, setSt] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(st) !== JSON.stringify(initial);
  const up = <K extends keyof ShopSettings>(k: K, v: ShopSettings[K]) =>
    setSt((x) => ({ ...x, [k]: v }));
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;

  const save = async () => {
    setErr(null);
    if (st.maxEmployeeDiscountPct > 50) return setErr("Employee discount limit cannot exceed 50%.");
    if (st.refundWindowDays > 90) return setErr("Refund window cannot exceed 90 days.");
    setBusy(true);
    const r = await repo.saveSettings(st);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success("Settings saved to local demo state");
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Saved only in this browser for the demo."
        actions={
          <>
            <SampleTag />
            <Button onClick={save} disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          </>
        }
      />
      {err && (
        <p
          className="mb-4 rounded-md bg-destructive-soft p-2 text-sm text-destructive"
          role="alert"
        >
          {err}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Shop profile">
          <div className="space-y-3">
            <Fld id="sn" label="Shop name">
              <Input id="sn" value={st.shopName} onChange={(e) => up("shopName", e.target.value)} />
            </Fld>
            <Fld id="ad" label="Address">
              <Textarea
                id="ad"
                rows={2}
                value={st.address}
                onChange={(e) => up("address", e.target.value)}
              />
            </Fld>
            <Fld id="tx" label="Tax ID">
              <Input id="tx" value={st.taxId} onChange={(e) => up("taxId", e.target.value)} />
            </Fld>
            <div className="flex items-center gap-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <div className="flex size-10 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
                L
              </div>
              Logo upload needs file storage — available once a backend is connected.
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="eyebrow">Currency</div>
                <div className="mt-1">Thai baht (THB, ฿)</div>
              </div>
              <div>
                <div className="eyebrow">Time zone</div>
                <div className="mt-1">Asia/Bangkok (UTC+7)</div>
              </div>
            </div>
          </div>
        </Panel>
        <Panel title="Receipts">
          <div className="space-y-3">
            <Fld id="rf" label="Receipt footer">
              <Textarea
                id="rf"
                rows={2}
                value={st.receiptFooter}
                onChange={(e) => up("receiptFooter", e.target.value)}
              />
            </Fld>
            <Toggle
              label="Show SKU on receipts"
              checked={st.showSkuOnReceipt}
              onChange={(v) => up("showSkuOnReceipt", v)}
            />
            <p className="text-xs text-muted-foreground">
              Receipt numbers follow LX-YYMMDD-NNNN. The backend must guarantee uniqueness.
            </p>
          </div>
        </Panel>
        <Panel title="Stock & policies">
          <div className="grid grid-cols-3 gap-3">
            <Fld id="ls" label="Default low-stock level">
              <Input
                id="ls"
                inputMode="numeric"
                className="num"
                value={st.defaultLowStock}
                onChange={(e) => up("defaultLowStock", num(e.target.value))}
              />
            </Fld>
            <Fld id="md" label="Employee discount limit %">
              <Input
                id="md"
                inputMode="numeric"
                className="num"
                value={st.maxEmployeeDiscountPct}
                onChange={(e) => up("maxEmployeeDiscountPct", num(e.target.value))}
              />
            </Fld>
            <Fld id="rw" label="Refund window (days)">
              <Input
                id="rw"
                inputMode="numeric"
                className="num"
                value={st.refundWindowDays}
                onChange={(e) => up("refundWindowDays", num(e.target.value))}
              />
            </Fld>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            All employee discounts and refunds currently require owner approval. The limit is shown
            for policy reference.
          </p>
        </Panel>
        <Panel title="Employee permissions">
          <ul className="space-y-1.5 text-sm">
            {[
              ["Checkout & receipts", true],
              ["Open / close cash drawer", true],
              ["Request refunds & stock adjustments", true],
              ["Change prices or give discounts", false],
              ["Approve requests", false],
              ["View costs, audit trail, reports", false],
            ].map(([k, v]) => (
              <li key={String(k)} className="flex justify-between">
                <span>{k}</span>
                <StatusBadge tone={v ? "success" : "neutral"}>
                  {v ? "Allowed" : "Owner only"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Notifications (in-app demo)">
          <div className="space-y-2">
            <Toggle
              label="Cash discrepancy detected"
              checked={st.notifyCashDiscrepancy}
              onChange={(v) => up("notifyCashDiscrepancy", v)}
            />
            <Toggle
              label="QR payment pending verification"
              checked={st.notifyPendingQr}
              onChange={(v) => up("notifyPendingQr", v)}
            />
            <Toggle
              label="Product below minimum stock"
              checked={st.notifyLowStock}
              onChange={(v) => up("notifyLowStock", v)}
            />
            <p className="text-xs text-muted-foreground">
              Email, LINE and push notifications are not active — no sending service is connected.
            </p>
          </div>
        </Panel>
        <Panel title="Backup & account security">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              No backups are running. Data exists only in this browser.
            </div>
            <div className="flex justify-between">
              <span>Backup status</span>
              <StatusBadge tone="warning">Not configured</StatusBadge>
            </div>
            <div className="flex justify-between">
              <span>Two-factor sign-in</span>
              <StatusBadge>Requires backend</StatusBadge>
            </div>
            <div className="flex justify-between">
              <span>Password policy</span>
              <StatusBadge>Requires backend</StatusBadge>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Fld({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
