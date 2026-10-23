/**
 * Real-data product list for the signed-in owner. READ-ONLY. Standalone: not part of the demo
 * screens, and the demo's simulated Owner role grants nothing here.
 *
 * - Access is enforced on the server: `listProductsForOwner` runs `requireOwner` on every call.
 *   The `beforeLoad` redirect below is only a convenience for signed-out visitors.
 * - Product cost is never requested or shown on this page.
 */
import type { ReactNode } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORY_LABEL, fmtTHB } from "@/lib/format";
import { listProductsForOwner } from "@/lib/products";
import { SAFE_MESSAGES } from "@/lib/server-errors";

const toLogin = () => redirect({ to: "/login", search: { redirect: "/owner/products" } });

export const Route = createFileRoute("/owner/products")({
  head: () => ({
    meta: [
      { title: "Products (real data) · Luxe Retail OS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await getCurrentUser();
    } catch {
      // Cannot check the session (database unreachable): show the error state, not a redirect.
      return { authUnavailable: true };
    }
    if (!user) throw toLogin();
    return { authUnavailable: false };
  },
  loader: async ({ context }) => {
    if (context.authUnavailable) return { state: "unavailable" as const, products: [] };
    try {
      return { state: "ok" as const, products: await listProductsForOwner({ data: {} }) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
        throw toLogin();
      if (message === SAFE_MESSAGES.unavailable)
        return { state: "unavailable" as const, products: [] };
      return { state: "error" as const, products: [] };
    }
  },
  pendingMs: 200,
  pendingComponent: () => (
    <Frame>
      <p
        data-testid="products-loading"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" /> Loading products…
      </p>
    </Frame>
  ),
  component: OwnerProducts,
});

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Products (real data)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Owner only · read-only · from the database. Costs are not shown here.
      </p>
      <Link
        to="/owner/products/new"
        data-testid="add-product-link"
        className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Add product
      </Link>
      <div className="mt-6">{children}</div>
      <div className="mt-8 flex gap-4 text-sm">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Account
        </Link>
        <Link to="/" className="font-medium text-primary hover:underline">
          Back to the demo
        </Link>
      </div>
    </div>
  );
}

function OwnerProducts() {
  const { state, products } = Route.useLoaderData();
  const router = useRouter();

  if (state !== "ok")
    return (
      <Frame>
        <div role="alert" data-testid="products-error" className="surface space-y-3 p-5 text-sm">
          <p>
            {state === "unavailable"
              ? "Products are temporarily unavailable because the database cannot be reached. Please try again later."
              : "Something went wrong while loading products."}
          </p>
          <Button
            data-testid="products-retry"
            variant="outline"
            onClick={() => router.invalidate()}
          >
            Retry
          </Button>
        </div>
      </Frame>
    );

  if (products.length === 0)
    return (
      <Frame>
        <p data-testid="products-empty" className="surface p-5 text-sm text-muted-foreground">
          No products in the database yet. Adding products comes in a later step.
        </p>
      </Frame>
    );

  return (
    <Frame>
      <div className="surface overflow-x-auto">
        <table data-testid="products-table" className="w-full min-w-[640px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-2 font-medium">SKU</th>
              <th className="px-2 font-medium">Category</th>
              <th className="px-2 text-right font-medium">Price</th>
              <th className="px-2 text-right font-medium">Minimum</th>
              <th className="px-2 text-right font-medium">Stock</th>
              <th className="px-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.map((p) => (
              <tr key={p.id} data-testid="product-row">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-2 font-mono text-[11px] text-muted-foreground">{p.sku}</td>
                <td className="px-2">{CATEGORY_LABEL[p.category]}</td>
                <td className="num px-2 text-right">{fmtTHB(p.price)}</td>
                <td className="num px-2 text-right">{fmtTHB(p.minimumSellingPrice)}</td>
                <td className="num px-2 text-right">
                  {p.variants.reduce((total, v) => total + v.stock, 0)}
                </td>
                <td className="px-4">{p.active ? "Active" : "Archived"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}
