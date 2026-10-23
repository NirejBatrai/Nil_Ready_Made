import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  QrCode,
  Search,
  ShoppingBag,
  Tag,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductThumb, StatusBadge, useEmployeeName } from "@/components/common";
import { Receipt } from "@/components/sales/Receipt";
import { useDemoState } from "@/lib/repository/demo-store";
import { findVariant, newId, repo } from "@/lib/repository";
import { cartTotals, cashChange } from "@/lib/calc";
import { CATEGORY_LABEL, fmtTHB, variantLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CartLine, Category, PaymentMethod, Product, Sale } from "@/types/domain";
import { pageHead } from "@/lib/seo";
import { nth } from "@/lib/assert";

export const Route = createFileRoute("/_shell/pos")({
  head: pageHead("Checkout", "Fast mobile point of sale for cash and QR / bank transfer payments."),
  component: Pos,
});

function Pos() {
  const s = useDemoState();
  const name = useEmployeeName();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picker, setPicker] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [discountPct, setDiscountPct] = useState(0);
  const [requestOpen, setRequestOpen] = useState<null | {
    type: "discount" | "price_override";
    variantId?: string;
  }>(null);
  const [done, setDone] = useState<Sale | null>(null);
  const isOwner = s.role === "owner";
  const openSession = s.cashSessions.find((c) => c.status === "open");

  const products = useMemo(() => {
    const term = q.trim().toLowerCase();
    return s.products.filter(
      (p) =>
        p.active &&
        (cat === "all" || p.category === cat) &&
        (!term ||
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          p.variants.some((v) => v.sku.toLowerCase().includes(term) || v.barcode?.includes(term))),
    );
  }, [s.products, q, cat]);

  const lines = cart.map((l) => {
    const f = findVariant(s, l.variantId)!;
    return { ...l, product: f.product, variant: f.variant, unitPrice: f.product.price };
  });
  const totals = cartTotals(lines, discountPct);
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const cats = Array.from(new Set(s.products.filter((p) => p.active).map((p) => p.category)));

  const add = (variantId: string) => {
    const f = findVariant(s, variantId)!;
    const inCart = cart.find((l) => l.variantId === variantId)?.qty ?? 0;
    if (inCart + 1 > f.variant.stock) {
      toast.error(`Only ${f.variant.stock} in stock`);
      return;
    }
    setCart((c) =>
      inCart
        ? c.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { variantId, qty: 1 }],
    );
  };
  const setQty = (variantId: string, qty: number) => {
    const f = findVariant(s, variantId)!;
    if (qty > f.variant.stock) {
      toast.error(`Only ${f.variant.stock} in stock`);
      return;
    }
    setCart((c) =>
      qty <= 0
        ? c.filter((l) => l.variantId !== variantId)
        : c.map((l) => (l.variantId === variantId ? { ...l, qty } : l)),
    );
  };
  const tapProduct = (p: Product) => {
    const avail = p.variants.filter((v) => v.stock > 0);
    if (p.variants.length === 1) {
      if (!avail.length) {
        toast.error("Out of stock");
        return;
      }
      add(nth(p.variants, 0).id);
    } else setPicker(p);
  };
  const reset = () => {
    setCart([]);
    setDiscountPct(0);
    setDone(null);
    setCheckout(false);
    setCartOpen(false);
  };

  if (done) {
    const pay = s.payments.find((p) => p.saleId === done.id);
    return (
      <div className="mx-auto max-w-md px-4 py-8">
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-success" />
          <h1 className="mt-3 text-xl font-semibold">Sale recorded</h1>
          <p className="num mt-1 text-sm text-muted-foreground">
            {done.receiptNo} · {fmtTHB(done.total)}
          </p>
          {done.paymentMethod === "cash" ? (
            <p className="num mt-3 text-2xl font-semibold">Change {fmtTHB(done.change ?? 0)}</p>
          ) : (
            <div className="mt-3">
              <StatusBadge tone="warning">QR payment awaiting owner verification</StatusBadge>
            </div>
          )}
        </div>
        <div className="surface mt-6 p-4">
          <Receipt
            sale={done}
            payment={pay}
            settings={s.settings}
            employee={name(done.employeeId)}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" size="xl" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button size="xl" onClick={reset}>
            New sale
          </Button>
        </div>
      </div>
    );
  }

  const CartBody = (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <ShoppingBag className="size-6" />
            Cart is empty
          </div>
        ) : (
          <ul className="divide-y">
            {lines.map((l) => (
              <li key={l.variantId} className="flex gap-3 py-3">
                <ProductThumb category={l.product.category} className="size-12 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {variantLabel(l.variant)} · {fmtTHB(l.unitPrice)}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => setQty(l.variantId, l.qty - 1)}
                      aria-label="Decrease"
                    >
                      <Minus />
                    </Button>
                    <span className="num w-6 text-center text-sm">{l.qty}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => setQty(l.variantId, l.qty + 1)}
                      aria-label="Increase"
                      disabled={l.qty >= l.variant.stock}
                    >
                      <Plus />
                    </Button>
                    <button
                      className="ml-1 text-[11px] text-muted-foreground underline"
                      onClick={() =>
                        setRequestOpen({ type: "price_override", variantId: l.variantId })
                      }
                    >
                      Price change?
                    </button>
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <span className="num text-sm font-medium">{fmtTHB(l.unitPrice * l.qty)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setQty(l.variantId, 0)}
                    aria-label="Remove"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2 border-t pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Discount</span>
          {isOwner ? (
            <div className="flex gap-1">
              {[0, 5, 10].map((p) => (
                <button
                  key={p}
                  onClick={() => setDiscountPct(p)}
                  className={cn(
                    "num rounded border px-2 py-0.5 text-xs",
                    discountPct === p && "border-primary bg-accent text-accent-foreground",
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          ) : (
            <button
              className="text-xs font-medium text-primary"
              onClick={() => setRequestOpen({ type: "discount" })}
              disabled={!lines.length}
            >
              <Tag className="mr-1 inline size-3" />
              Request discount
            </button>
          )}
        </div>
        <Row k="Subtotal" v={fmtTHB(totals.subtotal)} />
        {totals.discount > 0 && (
          <Row k={`Authorized discount (${discountPct}%)`} v={`−${fmtTHB(totals.discount)}`} />
        )}
        <div className="num flex items-baseline justify-between pt-1">
          <span className="font-medium">Total</span>
          <span className="text-2xl font-semibold">{fmtTHB(totals.total)}</span>
        </div>
        <Button
          size="xl"
          className="w-full"
          disabled={!lines.length}
          onClick={() => {
            setCartOpen(false);
            setCheckout(true);
          }}
        >
          Charge {fmtTHB(totals.total)}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[calc(100vh-5.5rem)]">
      <div className="min-w-0 flex-1 pb-28 lg:pb-6">
        <div className="sticky top-14 z-20 space-y-2 border-b bg-background px-4 py-3 sm:px-6">
          {!openSession && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
              <span>
                <Wallet className="mr-1 inline size-3.5" />
                Cash drawer is closed — cash payments are disabled.
              </span>
              <Link to="/reconciliation" className="font-semibold underline">
                Open drawer
              </Link>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, SKU or barcode"
              className="h-11 pl-9 text-base"
              aria-label="Search products"
            />
            {q && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2"
                onClick={() => setQ("")}
                aria-label="Clear"
              >
                <X className="size-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
            {(["all", ...cats] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  cat === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        {products.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No products match “{q}”.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 sm:px-6 xl:grid-cols-4">
            {products.map((p) => {
              const stock = p.variants.reduce((a, v) => a + v.stock, 0);
              return (
                <button
                  key={p.id}
                  onClick={() => tapProduct(p)}
                  disabled={stock === 0}
                  className="surface group flex flex-col p-2 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
                >
                  <ProductThumb
                    category={p.category}
                    imageUrl={p.imageUrl}
                    className="aspect-[4/3] w-full"
                  />
                  <div className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight">
                    {p.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{p.sku}</div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="num font-semibold">{fmtTHB(p.price)}</span>
                    <span
                      className={cn(
                        "num text-[11px]",
                        stock === 0
                          ? "text-destructive"
                          : stock <= p.lowStockThreshold
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {stock === 0 ? "Sold out" : `${stock} in stock`}
                    </span>
                  </div>
                  {p.variants.length > 1 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {p.variants.length} options
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <aside className="sticky top-14 hidden h-[calc(100vh-5.5rem)] w-[380px] shrink-0 flex-col border-l bg-card p-4 lg:flex">
        <h2 className="mb-2 font-semibold">
          Cart <span className="num text-sm font-normal text-muted-foreground">({count})</span>
        </h2>
        {CartBody}
      </aside>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card p-3 lg:hidden">
          <Button size="xl" className="w-full justify-between" onClick={() => setCartOpen(true)}>
            <span>
              <ShoppingBag className="mr-2 inline" />
              {count} item{count > 1 ? "s" : ""}
            </span>
            <span className="num">{fmtTHB(totals.total)}</span>
          </Button>
        </div>
      )}
      {count === 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-card py-2 text-[11px] text-muted-foreground lg:hidden">
          <Link to="/sales" className="px-3">
            Sales
          </Link>
          <Link to="/reconciliation" className="px-3">
            Cash drawer
          </Link>
          <Link to="/inventory" className="px-3">
            Stock
          </Link>
          <Link to="/approvals" className="px-3">
            Requests
          </Link>
        </nav>
      )}

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="flex h-[88vh] flex-col rounded-t-xl p-4">
          <SheetHeader className="p-0">
            <SheetTitle>Cart ({count})</SheetTitle>
          </SheetHeader>
          {CartBody}
        </SheetContent>
      </Sheet>

      <Sheet open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[80vh] overflow-y-auto rounded-t-xl p-4 sm:mx-auto sm:max-w-lg"
        >
          {picker && (
            <>
              <SheetHeader className="p-0">
                <SheetTitle>{picker.name}</SheetTitle>
              </SheetHeader>
              <p className="num text-sm text-muted-foreground">
                {fmtTHB(picker.price)} · choose an option
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {picker.variants.map((v) => {
                  const inCart = cart.find((l) => l.variantId === v.id)?.qty ?? 0;
                  return (
                    <button
                      key={v.id}
                      disabled={v.stock - inCart <= 0}
                      onClick={() => {
                        add(v.id);
                        setPicker(null);
                      }}
                      className="rounded-md border p-3 text-left text-sm transition-colors hover:border-primary disabled:opacity-40"
                    >
                      <div className="font-medium">{variantLabel(v)}</div>
                      <div className="num text-xs text-muted-foreground">
                        {v.stock - inCart} available
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <CheckoutDialog
        open={checkout}
        onOpenChange={setCheckout}
        total={totals.total}
        subtotal={totals.subtotal}
        discount={totals.discount}
        cashEnabled={!!openSession}
        onDone={setDone}
        cart={cart}
        discountPct={discountPct}
      />
      <RequestDialog req={requestOpen} onClose={() => setRequestOpen(null)} />
    </div>
  );
}

function CheckoutDialog({
  open,
  onOpenChange,
  total,
  subtotal,
  discount,
  cashEnabled,
  onDone,
  cart,
  discountPct,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  total: number;
  subtotal: number;
  discount: number;
  cashEnabled: boolean;
  onDone: (s: Sale) => void;
  cart: CartLine[];
  discountPct: number;
}) {
  const [method, setMethod] = useState<PaymentMethod>(cashEnabled ? "cash" : "qr");
  const [received, setReceived] = useState("");
  const [ref, setRef] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const key = useRef(newId("idem"));
  const rec = Number(received);
  const ch = cashChange(total, rec);
  const canPay = method === "qr" || (cashEnabled && ch.sufficient);
  const quick = Array.from(
    new Set([
      total,
      Math.ceil(total / 100) * 100,
      Math.ceil(total / 500) * 500,
      Math.ceil(total / 1000) * 1000,
    ]),
  ).filter((v) => v >= total);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = await repo.createSale({
      lines: cart,
      discountPct,
      paymentMethod: method,
      cashReceived: method === "cash" ? rec : undefined,
      qrReference: ref,
      idempotencyKey: key.current,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setConfirm(false);
      return;
    }
    key.current = newId("idem");
    setReceived("");
    setRef("");
    setConfirm(false);
    onOpenChange(false);
    onDone(r.data);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          onOpenChange(o);
          setConfirm(false);
          setErr("");
        }
      }}
    >
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirm ? "Confirm sale" : "Payment"}</DialogTitle>
          <DialogDescription className="num">
            Total due {fmtTHB(total)}
            {discount > 0 ? ` (subtotal ${fmtTHB(subtotal)}, discount ${fmtTHB(discount)})` : ""}
          </DialogDescription>
        </DialogHeader>
        {!confirm ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
              {(
                [
                  ["cash", "Cash", Banknote],
                  ["qr", "Thai QR / transfer", QrCode],
                ] as const
              ).map(([m, label, Icon]) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  disabled={m === "cash" && !cashEnabled}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border p-3 text-sm font-medium disabled:opacity-40",
                    method === m && "border-primary bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {label}
                </button>
              ))}
            </div>
            {method === "cash" ? (
              <div className="space-y-2">
                <Label htmlFor="rec">Cash received</Label>
                <Input
                  id="rec"
                  inputMode="numeric"
                  value={received}
                  onChange={(e) => setReceived(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  className="num h-12 text-xl"
                  autoFocus
                />
                <div className="flex flex-wrap gap-1.5">
                  {quick.map((v) => (
                    <Button
                      key={v}
                      variant="outline"
                      size="sm"
                      className="num"
                      onClick={() => setReceived(String(v))}
                    >
                      {v === total ? "Exact" : fmtTHB(v)}
                    </Button>
                  ))}
                </div>
                <div
                  className={cn(
                    "num flex justify-between rounded-md p-3 text-sm",
                    received && !ch.sufficient
                      ? "bg-destructive-soft text-destructive"
                      : "bg-muted",
                  )}
                >
                  {received && !ch.sufficient ? (
                    <>
                      <span>Short by</span>
                      <span className="font-semibold">{fmtTHB(ch.shortBy)}</span>
                    </>
                  ) : (
                    <>
                      <span>Change due</span>
                      <span className="text-lg font-semibold">{fmtTHB(ch.change)}</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-md border border-dashed p-3">
                  <div className="flex size-20 shrink-0 items-center justify-center rounded bg-muted">
                    <QrCode className="size-10 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Demo placeholder — no PromptPay QR is generated and no bank is connected. Ask
                    the customer to pay to the shop account, then record the reference.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ref">Transfer reference (optional)</Label>
                  <Input
                    id="ref"
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="e.g. last 6 digits on slip"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  The payment will be saved as <b>awaiting verification</b>. A reference number is
                  not proof that funds were received.
                </p>
              </div>
            )}
            {err && (
              <p
                className="rounded-md bg-destructive-soft p-2 text-sm text-destructive"
                role="alert"
              >
                {err}
              </p>
            )}
            <Button
              size="xl"
              className="w-full"
              disabled={!canPay}
              onClick={() => setConfirm(true)}
            >
              Review
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <Row k="Items" v={String(cart.reduce((a, l) => a + l.qty, 0))} />
            <Row k="Total" v={fmtTHB(total)} />
            <Row k="Method" v={method === "cash" ? "Cash" : "QR / transfer (unverified)"} />
            {method === "cash" && (
              <>
                <Row k="Received" v={fmtTHB(rec)} />
                <Row k="Change" v={fmtTHB(ch.change)} />
              </>
            )}
            <DialogFooter className="gap-2 pt-2 sm:flex-col">
              <Button size="xl" className="w-full" onClick={submit} disabled={busy}>
                {busy ? "Recording…" : "Complete sale"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
                Back
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestDialog({
  req,
  onClose,
}: {
  req: null | { type: "discount" | "price_override"; variantId?: string };
  onClose: () => void;
}) {
  const s = useDemoState();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const f = req?.variantId ? findVariant(s, req.variantId) : undefined;
  const submit = async () => {
    if (!req) return;
    setBusy(true);
    const r = await repo.requestApproval({
      type: req.type,
      variantId: req.variantId,
      amount: Number(amount) || undefined,
      reason,
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`${r.data.number} sent to owner for approval`);
    setAmount("");
    setReason("");
    onClose();
  };
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {req?.type === "discount" ? "Request a discount" : "Request a price override"}
          </DialogTitle>
          <DialogDescription>
            Employees can’t change prices directly. The owner will review this request.
          </DialogDescription>
        </DialogHeader>
        {f && (
          <p className="num text-sm">
            {f.product.name} · current price {fmtTHB(f.product.price)}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="amt">
            {req?.type === "discount" ? "Requested discount (%)" : "Requested price (฿)"}
          </Label>
          <Input
            id="amt"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="why">Reason</Label>
          <Textarea
            id="why"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this needed?"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !reason.trim() || !amount}>
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="num flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
