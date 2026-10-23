/**
 * Owner-only "Add product" form (real data). Standalone: not part of the demo screens, and the
 * demo's simulated Owner role grants nothing here.
 *
 * - The server enforces everything: `createProductForOwner` runs `requireOwner` on every request
 *   and validates all fields; the guard below only redirects signed-out visitors.
 * - Cost is optional and write-only: sent once, stored, never shown or returned afterwards.
 * - Stock cannot be entered; every variant starts at 0.
 * - POST form with the button disabled until hydrated, so a native submit can never put field
 *   values into a URL.
 */
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORY_LABEL } from "@/lib/format";
import { createProductForOwner } from "@/lib/products";
import { SAFE_MESSAGES } from "@/lib/server-errors";

export const Route = createFileRoute("/owner/products_/new")({
  head: () => ({
    meta: [
      { title: "Add product (real data) · Luxe Retail OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await getCurrentUser();
    } catch {
      return { authUnavailable: true };
    }
    // The only allowlisted return path is the list; the owner reaches this form from there.
    if (!user) throw redirect({ to: "/login", search: { redirect: "/owner/products" } });
    return { authUnavailable: false };
  },
  component: NewProduct,
});

type VariantRow = { sku: string; size: string; color: string; barcode: string };
const emptyVariant = (): VariantRow => ({ sku: "", size: "", color: "", barcode: "" });

/** Empty → NaN, which the server rejects with a clear message. */
const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.trim()));
const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {});

function friendly(message: string) {
  if (message === SAFE_MESSAGES.unavailable)
    return "The database cannot be reached right now. Nothing was saved. Please try again later.";
  if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
    return "Your session has ended. Sign in again to add products.";
  return message || SAFE_MESSAGES.generic;
}

function NewProduct() {
  const { authUnavailable } = Route.useRouteContext();
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [minimum, setMinimum] = useState("");
  const [cost, setCost] = useState("");
  const [threshold, setThreshold] = useState("3");
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);
  useEffect(() => setHydrated(true), []);

  const updateVariant = (i: number, patch: Partial<VariantRow>) =>
    setVariants((rows) => rows.map((row, n) => (n === i ? { ...row, ...patch } : row)));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await createProductForOwner({
        data: {
          name,
          sku,
          category,
          description,
          price: toNumber(price),
          minimumSellingPrice: toNumber(minimum),
          ...(cost.trim() ? { cost: toNumber(cost) } : {}),
          lowStockThreshold: toNumber(threshold),
          variants: variants.map((v, i) => ({
            // A single variant with no SKU of its own uses the product SKU.
            sku: v.sku.trim() || (variants.length === 1 && i === 0 ? sku : ""),
            ...optional("size", v.size),
            ...optional("color", v.color),
            ...optional("barcode", v.barcode),
          })),
        },
      });
      if (result.ok) await navigate({ to: "/owner/products" });
      else setError(friendly(result.error));
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  };

  const field = "space-y-1.5";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Add product (real data)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Owner only. New products start with stock 0. Cost is optional and is never shown again.
      </p>

      {authUnavailable ? (
        <p role="alert" data-testid="new-product-unavailable" className="surface mt-6 p-5 text-sm">
          The database cannot be reached right now, so products cannot be added. Please try again
          later.
        </p>
      ) : (
        <form
          method="post"
          onSubmit={submit}
          data-testid="new-product-form"
          className="surface mt-6 space-y-5 p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="np-name">Name</Label>
              <Input
                id="np-name"
                data-testid="np-name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className={field}>
              <Label htmlFor="np-sku">SKU</Label>
              <Input
                id="np-sku"
                data-testid="np-sku"
                required
                maxLength={64}
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div className={field}>
              <Label htmlFor="np-category">Category</Label>
              <select
                id="np-category"
                data-testid="np-category"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className={field}>
              <Label htmlFor="np-threshold">Low-stock alert at</Label>
              <Input
                id="np-threshold"
                data-testid="np-threshold"
                inputMode="numeric"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
            <div className={field}>
              <Label htmlFor="np-price">Selling price ฿</Label>
              <Input
                id="np-price"
                data-testid="np-price"
                inputMode="numeric"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className={field}>
              <Label htmlFor="np-minimum">Minimum price ฿ (this product only)</Label>
              <Input
                id="np-minimum"
                data-testid="np-minimum"
                inputMode="numeric"
                required
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
              />
            </div>
            <div className={field}>
              <Label htmlFor="np-cost">Cost ฿ (optional, owner only)</Label>
              <Input
                id="np-cost"
                data-testid="np-cost"
                inputMode="numeric"
                autoComplete="off"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
          </div>
          <div className={field}>
            <Label htmlFor="np-description">Description</Label>
            <Textarea
              id="np-description"
              data-testid="np-description"
              maxLength={2000}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Variants (stock starts at 0)</legend>
            {variants.map((v, i) => (
              <div
                key={i}
                data-testid="np-variant"
                className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_0.6fr_0.8fr_1fr_auto]"
              >
                <Input
                  aria-label={`Variant ${i + 1} SKU`}
                  placeholder={variants.length === 1 ? "SKU (default: product SKU)" : "SKU"}
                  maxLength={64}
                  value={v.sku}
                  onChange={(e) => updateVariant(i, { sku: e.target.value })}
                />
                <Input
                  aria-label={`Variant ${i + 1} size`}
                  placeholder="Size"
                  maxLength={32}
                  value={v.size}
                  onChange={(e) => updateVariant(i, { size: e.target.value })}
                />
                <Input
                  aria-label={`Variant ${i + 1} colour`}
                  placeholder="Colour"
                  maxLength={32}
                  value={v.color}
                  onChange={(e) => updateVariant(i, { color: e.target.value })}
                />
                <Input
                  aria-label={`Variant ${i + 1} barcode`}
                  placeholder="Barcode (optional)"
                  maxLength={64}
                  value={v.barcode}
                  onChange={(e) => updateVariant(i, { barcode: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove variant ${i + 1}`}
                  disabled={variants.length === 1}
                  onClick={() => setVariants((rows) => rows.filter((_, n) => n !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="np-add-variant"
              disabled={variants.length >= 200}
              onClick={() => setVariants((rows) => [...rows, emptyVariant()])}
            >
              <Plus /> Add variant
            </Button>
          </fieldset>

          {error && (
            <p
              role="alert"
              data-testid="np-error"
              className="rounded-md bg-destructive-soft p-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            data-testid="np-submit"
            className="w-full"
            disabled={!hydrated || busy}
          >
            {busy ? "Saving…" : "Create product"}
          </Button>
        </form>
      )}

      <div className="mt-8 flex gap-4 text-sm">
        <Link to="/owner/products" className="font-medium text-primary hover:underline">
          Back to products
        </Link>
      </div>
    </div>
  );
}
