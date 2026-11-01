/**
 * Owner-only "Edit product" form (real data). Standalone: not part of the demo screens, and the
 * demo's simulated Owner role grants nothing here.
 *
 * - The server enforces everything: `getProductForEditing` and `updateProductForOwner` run
 *   `requireOwner` on every request, and the product service validates every field again; the
 *   guard below only redirects signed-out visitors.
 * - Same fields and messages as the create form. SKU and variants are shown but cannot change
 *   (the service does not allow it); stock is never edited here.
 * - Cost stays write-only: it is never loaded into this page. Leaving the field empty keeps the
 *   stored cost; the checkbox removes it.
 * - Amounts are typed in baht ("1800", "1,800", "1800.50") and parsed here to integer satang
 *   without floating-point math (src/lib/money.ts); the server validates them again.
 * - After saving, router data is invalidated before returning to the list, which also loads with
 *   a blocking reload, so the old values are never shown.
 * - POST form with the button disabled until hydrated, so a native submit can never put field
 *   values into a URL.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORY_LABEL } from "@/lib/format";
import { parseBahtToSatang, satangToInput } from "@/lib/money";
import { getProductForEditing, updateProductForOwner } from "@/lib/products";
import { SAFE_MESSAGES } from "@/lib/server-errors";

const toLogin = () => redirect({ to: "/login", search: { redirect: "/owner/products" } });

export const Route = createFileRoute("/owner/products_/$productId/edit")({
  head: () => ({
    meta: [
      { title: "Edit product (real data) · Luxe Retail OS" },
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
    if (!user) throw toLogin();
    return { authUnavailable: false };
  },
  loader: {
    // Never fill the form from cached (possibly outdated) product data.
    staleReloadMode: "blocking",
    handler: async ({ context, params }) => {
      if (context.authUnavailable) return { state: "unavailable" as const, product: null };
      try {
        const product = await getProductForEditing({ data: params.productId });
        return product
          ? { state: "ok" as const, product }
          : { state: "missing" as const, product: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
          throw toLogin();
        if (message === SAFE_MESSAGES.unavailable)
          return { state: "unavailable" as const, product: null };
        return { state: "error" as const, product: null };
      }
    },
  },
  pendingMs: 200,
  pendingComponent: () => (
    <Page>
      <p
        data-testid="edit-product-loading"
        className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" /> Loading product…
      </p>
    </Page>
  ),
  component: EditProductPage,
});

type EditableProduct = NonNullable<Awaited<ReturnType<typeof getProductForEditing>>>;

/** Empty → NaN, which the server rejects with a clear message. */
const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.trim()));

/** Satang for a money field, or a message naming the field. */
const money = (label: string, text: string) => {
  const r = parseBahtToSatang(text);
  return r.ok ? r : { ok: false as const, error: `${label}: ${r.error}` };
};

function friendly(message: string) {
  if (message === SAFE_MESSAGES.unavailable)
    return "The database cannot be reached right now. Nothing was saved. Please try again later.";
  if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
    return "Your session has ended. Sign in again to edit products.";
  return message || SAFE_MESSAGES.generic;
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit product (real data)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Owner only. SKU, variants and stock cannot be changed here. The stored cost is never shown.
      </p>
      {children}
      <div className="mt-8 flex gap-4 text-sm">
        <Link to="/owner/products" className="font-medium text-primary hover:underline">
          Back to products
        </Link>
      </div>
    </div>
  );
}

function EditProductPage() {
  const { state, product } = Route.useLoaderData();
  if (state === "ok" && product)
    return (
      <Page>
        <EditForm key={product.id} product={product} />
      </Page>
    );
  return (
    <Page>
      <p role="alert" data-testid="edit-product-error" className="surface mt-6 p-5 text-sm">
        {state === "missing"
          ? "This product does not exist."
          : state === "unavailable"
            ? "The database cannot be reached right now, so products cannot be edited. Please try again later."
            : "Something went wrong while loading this product."}
      </p>
    </Page>
  );
}

function EditForm({ product }: { product: EditableProduct }) {
  const navigate = useNavigate();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState<string>(product.category);
  const [description, setDescription] = useState(product.description);
  const [price, setPrice] = useState(satangToInput(product.priceSatang));
  const [minimum, setMinimum] = useState(satangToInput(product.minimumSellingPriceSatang));
  const [cost, setCost] = useState("");
  const [clearCost, setClearCost] = useState(false);
  const [threshold, setThreshold] = useState(String(product.lowStockThreshold));
  useEffect(() => setHydrated(true), []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const priceSatang = money("Selling price", price);
    const minimumSatang = money("Minimum price", minimum);
    const costSatang = !clearCost && cost.trim() ? money("New cost", cost) : undefined;
    for (const r of [priceSatang, minimumSatang, costSatang])
      if (r && !r.ok) return setError(r.error);
    if (!priceSatang.ok || !minimumSatang.ok || (costSatang && !costSatang.ok)) return;
    setBusy(true);
    try {
      const result = await updateProductForOwner({
        data: {
          id: product.id,
          update: {
            name,
            category,
            description,
            priceSatang: priceSatang.satang,
            minimumSellingPriceSatang: minimumSatang.satang,
            // Empty: keep the stored cost. The checkbox sends `null`, which removes it.
            ...(clearCost
              ? { costSatang: null }
              : costSatang
                ? { costSatang: costSatang.satang }
                : {}),
            lowStockThreshold: toNumber(threshold),
          },
        },
      });
      if (result.ok) {
        await router.invalidate();
        await navigate({ to: "/owner/products" });
      } else setError(friendly(result.error));
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  };

  const field = "space-y-1.5";
  return (
    <form
      method="post"
      onSubmit={submit}
      data-testid="edit-product-form"
      className="surface mt-6 space-y-5 p-5"
    >
      {!product.active && (
        <p data-testid="ep-archived" className="rounded-md bg-muted p-2 text-sm">
          This product is archived. Restore it from the Archived list to sell it again.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="ep-name">Name</Label>
          <Input
            id="ep-name"
            data-testid="ep-name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={field}>
          <Label htmlFor="ep-sku">SKU (cannot be changed)</Label>
          <Input id="ep-sku" data-testid="ep-sku" readOnly disabled value={product.sku} />
        </div>
        <div className={field}>
          <Label htmlFor="ep-category">Category</Label>
          <select
            id="ep-category"
            data-testid="ep-category"
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
          <Label htmlFor="ep-threshold">Low-stock alert at</Label>
          <Input
            id="ep-threshold"
            data-testid="ep-threshold"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <div className={field}>
          <Label htmlFor="ep-price">Selling price ฿</Label>
          <Input
            id="ep-price"
            data-testid="ep-price"
            inputMode="decimal"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className={field}>
          <Label htmlFor="ep-minimum">Minimum price ฿ (this product only)</Label>
          <Input
            id="ep-minimum"
            data-testid="ep-minimum"
            inputMode="decimal"
            required
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
          />
        </div>
        <div className={field}>
          <Label htmlFor="ep-cost">New cost ฿ (optional, owner only)</Label>
          <Input
            id="ep-cost"
            data-testid="ep-cost"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Leave empty to keep the stored cost"
            disabled={clearCost}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              data-testid="ep-clear-cost"
              checked={clearCost}
              onChange={(e) => setClearCost(e.target.checked)}
            />
            Remove the stored cost
          </label>
        </div>
      </div>
      <div className={field}>
        <Label htmlFor="ep-description">Description</Label>
        <Textarea
          id="ep-description"
          data-testid="ep-description"
          maxLength={2000}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">Variants (cannot be changed here)</p>
        <ul data-testid="ep-variants" className="divide-y rounded-md border text-sm">
          {product.variants.map((v) => (
            <li key={v.id} className="flex flex-wrap gap-x-4 px-3 py-1.5">
              <span className="font-mono text-[11px]">{v.sku}</span>
              {v.size && <span>Size {v.size}</span>}
              {v.color && <span>{v.color}</span>}
              {v.barcode && <span className="font-mono text-[11px]">{v.barcode}</span>}
              <span className="text-muted-foreground">Stock {v.stock}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="ep-error"
          className="rounded-md bg-destructive-soft p-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button type="submit" data-testid="ep-submit" className="w-full" disabled={!hydrated || busy}>
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
