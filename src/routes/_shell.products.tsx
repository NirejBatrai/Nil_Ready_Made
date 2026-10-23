import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowUpDown, Archive, ImagePlus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { F } from "@/components/FilterSelect";
import {
  EmptyState,
  OwnerOnly,
  PageHeader,
  ProductThumb,
  SampleTag,
  StatusBadge,
} from "@/components/common";
import { useDemoState } from "@/lib/repository/demo-store";
import { newId, repo } from "@/lib/repository";
import { CATEGORY_LABEL, fmtTHB, variantLabel } from "@/lib/format";
import type { Category, Product, ProductVariant } from "@/types/domain";
import { pageHead } from "@/lib/seo";
import { productPricingError } from "@/lib/calc";
import { cn } from "@/lib/utils";

type Search = { stock?: string | undefined };
export const Route = createFileRoute("/_shell/products")({
  head: pageHead(
    "Products",
    "Product catalog with variants, pricing, barcodes and low-stock thresholds.",
  ),
  validateSearch: (s: Record<string, unknown>): Search => ({
    stock: typeof s["stock"] === "string" ? s["stock"] : undefined,
  }),
  component: () => (
    <OwnerOnly>
      <Products />
    </OwnerOnly>
  ),
});

const PAGE = 12;

function Products() {
  const s = useDemoState();
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [stock, setStock] = useState(search.stock ?? "all");
  const [showArchived, setShowArchived] = useState("active");
  const [sort, setSort] = useState<"name" | "price" | "stock">("name");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState<Product | null>(null);

  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return s.products
      .map((p) => ({
        p,
        total: p.variants.reduce((a, v) => a + v.stock, 0),
        low: p.variants.some((v) => v.stock <= p.lowStockThreshold),
      }))
      .filter(
        ({ p, total, low }) =>
          (showArchived === "all" || (showArchived === "active" ? p.active : !p.active)) &&
          (cat === "all" || p.category === cat) &&
          (stock === "all" ||
            (stock === "low"
              ? low && total > 0
              : stock === "out"
                ? total === 0 || p.variants.some((v) => v.stock === 0)
                : !low)) &&
          (!t ||
            p.name.toLowerCase().includes(t) ||
            p.sku.toLowerCase().includes(t) ||
            p.variants.some((v) => v.barcode?.includes(t))),
      )
      .sort((a, b) =>
        sort === "name"
          ? a.p.name.localeCompare(b.p.name)
          : sort === "price"
            ? b.p.price - a.p.price
            : a.total - b.total,
      );
  }, [s.products, q, cat, stock, showArchived, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  const blank = (): Product => ({
    id: newId("prd"),
    name: "",
    sku: "",
    category: "other",
    description: "",
    price: 0,
    minimumSellingPrice: 0,
    active: true,
    lowStockThreshold: s.settings.defaultLowStock,
    variants: [],
  });

  return (
    <>
      <PageHeader
        title="Products"
        description={`${s.products.length} products · ${s.products.reduce((a, p) => a + p.variants.length, 0)} variants`}
        actions={
          <>
            <SampleTag />
            <Button onClick={() => setEditing(blank())}>
              <Plus /> Add product
            </Button>
          </>
        }
      />
      <div className="surface mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          placeholder="Search name, SKU, barcode"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          className="lg:col-span-2"
          aria-label="Search"
        />
        <F
          value={cat}
          onChange={(v) => {
            setCat(v);
            setPage(0);
          }}
          label="Category"
          opts={[["all", "All categories"], ...Object.entries(CATEGORY_LABEL)]}
        />
        <F
          value={stock}
          onChange={(v) => {
            setStock(v);
            setPage(0);
          }}
          label="Stock"
          opts={[
            ["all", "Any stock"],
            ["ok", "In stock"],
            ["low", "Low stock"],
            ["out", "Out of stock"],
          ]}
        />
        <F
          value={showArchived}
          onChange={(v) => {
            setShowArchived(v);
            setPage(0);
          }}
          label="Status"
          opts={[
            ["active", "Active"],
            ["archived", "Archived"],
            ["all", "All"],
          ]}
        />
      </div>
      <div className="surface overflow-hidden">
        {view.length === 0 ? (
          <EmptyState title="No products found" body="Try different filters, or add a product." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">
                    <button
                      onClick={() => setSort("name")}
                      className="inline-flex items-center gap-1"
                    >
                      Product <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-2 font-medium">Category</th>
                  <th className="px-2 font-medium">Variants</th>
                  <th className="px-2 text-right font-medium">
                    <button
                      onClick={() => setSort("price")}
                      className="inline-flex items-center gap-1"
                    >
                      Price <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-2 text-right font-medium">
                    <button
                      onClick={() => setSort("stock")}
                      className="inline-flex items-center gap-1"
                    >
                      On hand <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-2 font-medium">Stock status</th>
                  <th className="px-2 font-medium">Status</th>
                  <th className="px-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {view.map(({ p, total, low }) => (
                  <tr key={p.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2">
                      <button
                        className="flex items-center gap-3 text-left"
                        onClick={() => setEditing(p)}
                      >
                        <ProductThumb
                          category={p.category}
                          imageUrl={p.imageUrl}
                          className="size-10 shrink-0"
                        />
                        <span>
                          <span className="block font-medium">{p.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {p.sku}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-2">{CATEGORY_LABEL[p.category]}</td>
                    <td className="num px-2">
                      {p.variants.length === 1 ? (
                        <span className="text-muted-foreground">Single</span>
                      ) : (
                        p.variants.length
                      )}
                    </td>
                    <td className="num px-2 text-right">
                      {fmtTHB(p.price)}
                      {p.minimumSellingPrice < p.price && (
                        <span className="block text-[11px] text-muted-foreground">
                          min {fmtTHB(p.minimumSellingPrice)}
                        </span>
                      )}
                    </td>
                    <td className="num px-2 text-right">{total}</td>
                    <td className="px-2">
                      {total === 0 ? (
                        <StatusBadge tone="danger">Out</StatusBadge>
                      ) : low ? (
                        <StatusBadge tone="warning">Low</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">OK</StatusBadge>
                      )}
                    </td>
                    <td className="px-2">
                      {p.active ? (
                        <StatusBadge>Active</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Archived</StatusBadge>
                      )}
                    </td>
                    <td className="px-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit"
                        onClick={() => setEditing(p)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={p.active ? "Archive" : "Restore"}
                        onClick={() =>
                          p.active
                            ? setArchiving(p)
                            : repo
                                .archiveProduct(p.id, true)
                                .then((r) =>
                                  r.ok ? toast.success("Restored") : toast.error(r.error),
                                )
                        }
                      >
                        {p.active ? <Archive /> : <RotateCcw />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>{rows.length} products</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Prev
            </Button>
            <span className="num">
              {page + 1} / {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {editing && (
            <ProductForm
              initial={editing}
              isNew={!s.products.some((p) => p.id === editing.id)}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be hidden from checkout. Sales history and stock records are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                archiving &&
                repo
                  .archiveProduct(archiving.id, false)
                  .then((r) => (r.ok ? toast.success("Archived") : toast.error(r.error)))
              }
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProductForm({
  initial,
  isNew,
  onDone,
}: {
  initial: Product;
  isNew: boolean;
  onDone: () => void;
}) {
  const [p, setP] = useState<Product>(structuredClone(initial));
  const [hasVariants, setHasVariants] = useState(
    initial.variants.length > 1 || !!initial.variants[0]?.size || !!initial.variants[0]?.color,
  );
  const [sizes, setSizes] = useState("");
  const [colors, setColors] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Blank minimum means "same as selling price" (no reductions), so a forgotten field never allows ฿0 sales.
  const [minDraft, setMinDraft] = useState(isNew ? "" : String(initial.minimumSellingPrice));
  const minimum = minDraft === "" ? p.price : Number(minDraft);
  const pricingError = p.price
    ? productPricingError({ ...p, minimumSellingPrice: minimum })
    : undefined;
  const up = (patch: Partial<Product>) => setP((x) => ({ ...x, ...patch }));
  const upV = (id: string, patch: Partial<ProductVariant>) =>
    setP((x) => ({
      ...x,
      variants: x.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));

  const generate = () => {
    const ss = sizes
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const cs = colors
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const combos = (cs.length ? cs : [undefined]).flatMap((c) =>
      (ss.length ? ss : [undefined]).map((sz) => ({ size: sz, color: c })),
    );
    const existing = new Set(p.variants.map((v) => variantLabel(v)));
    const add = combos
      .filter((c) => !existing.has(variantLabel(c)))
      .map((c) => ({
        id: newId("var"),
        productId: p.id,
        sku: `${p.sku}-${[c.size, c.color?.slice(0, 3).toUpperCase()].filter(Boolean).join("-")}`,
        ...c,
        openingStock: 0,
        stock: 0,
      }));
    up({ variants: [...p.variants, ...add] });
  };

  const save = async () => {
    setErr(null);
    let next: Product = { ...p, minimumSellingPrice: minimum };
    if (!hasVariants) {
      const v = p.variants[0] ?? {
        id: newId("var"),
        productId: p.id,
        sku: p.sku,
        openingStock: 0,
        stock: 0,
      };
      next = {
        ...p,
        variants: [{ ...v, sku: p.sku, size: undefined, color: undefined, barcode: p.barcode }],
      };
    } else if (!p.variants.length) return setErr("Add at least one variant.");
    if (isNew)
      next = { ...next, variants: next.variants.map((v) => ({ ...v, stock: v.openingStock })) };
    setBusy(true);
    const r = await repo.saveProduct(next);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(isNew ? "Product created (demo)" : "Product saved (demo)");
    onDone();
  };

  return (
    <>
      <SheetHeader className="px-0">
        <SheetTitle>{isNew ? "New product" : "Edit product"}</SheetTitle>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-8">
        <div className="flex items-center gap-3">
          <ProductThumb category={p.category} imageUrl={p.imageUrl} className="size-16" />
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <ImagePlus className="size-4" /> Choose image (preview only)
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const fr = new FileReader();
                  fr.onload = () => up({ imageUrl: String(fr.result) });
                  fr.readAsDataURL(f);
                }
              }}
            />
          </label>
        </div>
        <Field label="Product name">
          <Input value={p.name} onChange={(e) => up({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <Input value={p.sku} onChange={(e) => up({ sku: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Category">
            <F
              value={p.category}
              onChange={(v) => up({ category: v as Category })}
              label="Category"
              opts={Object.entries(CATEGORY_LABEL)}
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            value={p.description}
            onChange={(e) => up({ description: e.target.value })}
            rows={2}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Selling price ฿">
            <Input
              inputMode="numeric"
              value={p.price || ""}
              onChange={(e) => up({ price: Number(e.target.value.replace(/\D/g, "")) })}
            />
          </Field>
          <Field label="Minimum price ฿">
            <Input
              inputMode="numeric"
              value={minDraft}
              placeholder={p.price ? String(p.price) : "Same as price"}
              onChange={(e) => setMinDraft(e.target.value.replace(/\D/g, ""))}
              aria-invalid={!!pricingError}
              aria-describedby="pricing-help"
            />
          </Field>
          <Field label="Cost ฿ (owner only)">
            <Input
              inputMode="numeric"
              value={p.cost ?? ""}
              onChange={(e) =>
                up({ cost: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : undefined })
              }
            />
          </Field>
          <Field label="Low-stock at">
            <Input
              inputMode="numeric"
              value={p.lowStockThreshold}
              onChange={(e) => up({ lowStockThreshold: Number(e.target.value.replace(/\D/g, "")) })}
            />
          </Field>
        </div>
        <p
          id="pricing-help"
          className={cn(
            "-mt-1 text-xs",
            pricingError ? "text-destructive" : "text-muted-foreground",
          )}
          role={pricingError ? "alert" : undefined}
        >
          {pricingError ??
            `Checkout allows ${p.price ? `${fmtTHB(minimum)}–${fmtTHB(p.price)}` : "prices from the minimum up to the selling price"}. Blank minimum = selling price (no reductions). Sales below the minimum are always blocked.`}
        </p>

        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Variants</div>
              <div className="text-xs text-muted-foreground">
                A product is the design; variants are the sizes/colours you stock.
              </div>
            </div>
            <div className="flex rounded-md border bg-muted p-0.5 text-xs">
              <button
                className={`rounded px-2 py-1 ${!hasVariants ? "bg-card shadow-card" : ""}`}
                onClick={() => setHasVariants(false)}
              >
                Single
              </button>
              <button
                className={`rounded px-2 py-1 ${hasVariants ? "bg-card shadow-card" : ""}`}
                onClick={() => setHasVariants(true)}
              >
                Sizes / colours
              </button>
            </div>
          </div>
          {!hasVariants ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Barcode (optional)">
                <Input value={p.barcode ?? ""} onChange={(e) => up({ barcode: e.target.value })} />
              </Field>
              {isNew && (
                <Field label="Opening stock">
                  <Input
                    inputMode="numeric"
                    value={p.variants[0]?.openingStock ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ""));
                      up({
                        variants: [
                          {
                            id: p.variants[0]?.id ?? newId("var"),
                            productId: p.id,
                            sku: p.sku,
                            openingStock: n,
                            stock: n,
                          },
                        ],
                      });
                    }}
                  />
                </Field>
              )}
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Sizes (comma)">
                  <Input
                    value={sizes}
                    onChange={(e) => setSizes(e.target.value)}
                    placeholder="S, M, L"
                  />
                </Field>
                <Field label="Colours (comma)">
                  <Input
                    value={colors}
                    onChange={(e) => setColors(e.target.value)}
                    placeholder="Black, Sand"
                  />
                </Field>
                <Button variant="outline" onClick={generate} disabled={!p.sku}>
                  Add
                </Button>
              </div>
              <ul className="mt-3 divide-y rounded-md border">
                {p.variants.map((v) => (
                  <li
                    key={v.id}
                    className="grid grid-cols-[1fr_110px_70px_auto] items-center gap-2 px-2 py-1.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{variantLabel(v)}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {v.sku}
                      </span>
                    </span>
                    <Input
                      className="h-8 text-xs"
                      placeholder="Barcode"
                      value={v.barcode ?? ""}
                      onChange={(e) => upV(v.id, { barcode: e.target.value })}
                    />
                    {isNew ? (
                      <Input
                        className="num h-8 text-xs"
                        inputMode="numeric"
                        aria-label="Opening stock"
                        value={v.openingStock}
                        onChange={(e) =>
                          upV(v.id, { openingStock: Number(e.target.value.replace(/\D/g, "")) })
                        }
                      />
                    ) : (
                      <span className="num text-right text-xs text-muted-foreground">
                        {v.stock} pcs
                      </span>
                    )}
                    {isNew || !initial.variants.some((o) => o.id === v.id) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="Remove"
                        onClick={() => up({ variants: p.variants.filter((x) => x.id !== v.id) })}
                      >
                        <Trash2 />
                      </Button>
                    ) : (
                      <span className="w-8" />
                    )}
                  </li>
                ))}
                {!p.variants.length && (
                  <li className="p-3 text-xs text-muted-foreground">
                    Enter sizes and/or colours, then Add.
                  </li>
                )}
              </ul>
            </>
          )}
          {!isNew && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Stock can only change through sales, restocks or approved adjustments.
            </p>
          )}
        </div>
        {err && (
          <p className="rounded-md bg-destructive-soft p-2 text-sm text-destructive" role="alert">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save product"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
