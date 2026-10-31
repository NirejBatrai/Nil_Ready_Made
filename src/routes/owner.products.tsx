/**
 * Real-data product list for the signed-in owner. Standalone: not part of the demo screens, and
 * the demo's simulated Owner role grants nothing here.
 *
 * - Access is enforced on the server: every product server function runs `requireOwner` on every
 *   call. The `beforeLoad` redirect below is only a convenience for signed-out visitors.
 * - Product cost is never requested or shown on this page.
 * - Active products by default; `?view=archived` lists archived ones. Archiving (after a
 *   confirmation) and restoring re-load the list before the action counts as finished; there is
 *   no delete.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORY_LABEL, fmtTHB } from "@/lib/format";
import {
  archiveProductForOwner,
  listProductsForOwner,
  restoreProductForOwner,
} from "@/lib/products";
import { SAFE_MESSAGES } from "@/lib/server-errors";

const toLogin = () => redirect({ to: "/login", search: { redirect: "/owner/products" } });

type ProductsSearch = { view?: "archived" | undefined };

export const Route = createFileRoute("/owner/products")({
  validateSearch: (search: Record<string, unknown>): ProductsSearch =>
    search["view"] === "archived" ? { view: "archived" } : {},
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
  loaderDeps: ({ search }) => ({ archived: search.view === "archived" }),
  loader: {
    // Leaving this page caches its data; by default, coming back (e.g. right after creating a
    // product) renders that stale list first and reloads in the background. Blocking makes the
    // router wait for the fresh list instead, so an outdated list is never shown.
    staleReloadMode: "blocking",
    handler: async ({ context, deps }) => {
      if (context.authUnavailable) return { state: "unavailable" as const, products: [] };
      try {
        if (!deps.archived)
          return { state: "ok" as const, products: await listProductsForOwner({ data: {} }) };
        const all = await listProductsForOwner({ data: { includeArchived: true } });
        return { state: "ok" as const, products: all.filter((p) => !p.active) };
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
          throw toLogin();
        if (message === SAFE_MESSAGES.unavailable)
          return { state: "unavailable" as const, products: [] };
        return { state: "error" as const, products: [] };
      }
    },
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

const tab = "rounded-md px-3 py-1.5 font-medium";
const activeTab = `${tab} bg-muted text-foreground`;
const idleTab = `${tab} text-muted-foreground hover:text-foreground`;

function Frame({ children }: { children: ReactNode }) {
  const { view } = Route.useSearch();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Products (real data)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Owner only · from the database. Costs are not shown here. Products are archived, never
        deleted.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Link
          to="/owner/products/new"
          data-testid="add-product-link"
          className="inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add product
        </Link>
        <nav className="flex gap-1 text-sm" aria-label="Product views">
          <Link
            to="/owner/products"
            search={{}}
            data-testid="view-active"
            className={view === "archived" ? idleTab : activeTab}
          >
            Active
          </Link>
          <Link
            to="/owner/products"
            search={{ view: "archived" }}
            data-testid="view-archived"
            className={view === "archived" ? activeTab : idleTab}
          >
            Archived
          </Link>
        </nav>
      </div>
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

type Listed = Awaited<ReturnType<typeof listProductsForOwner>>[number];

function friendly(message: string) {
  if (message === SAFE_MESSAGES.unavailable)
    return "The database cannot be reached right now. Nothing was changed. Please try again later.";
  if (message === SAFE_MESSAGES.notSignedIn || message === SAFE_MESSAGES.notAllowed)
    return "Your session has ended. Sign in again to change products.";
  return message || SAFE_MESSAGES.generic;
}

function OwnerProducts() {
  const { state, products } = Route.useLoaderData();
  const { view } = Route.useSearch();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<Listed | null>(null);
  useEffect(() => setHydrated(true), []);
  const archivedView = view === "archived";

  /** Runs one archive/restore, then waits for the fresh list before the action counts as done. */
  const change = async (action: typeof archiveProductForOwner, id: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await action({ data: id });
      if (!result.ok) setError(friendly(result.error));
      await router.invalidate();
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

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
          {archivedView ? "No archived products." : "No products in the database yet."}
        </p>
      </Frame>
    );

  return (
    <Frame>
      {error && (
        <p
          role="alert"
          data-testid="products-action-error"
          className="mb-3 rounded-md bg-destructive-soft p-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="surface overflow-x-auto">
        <table
          data-testid="products-table"
          data-view={archivedView ? "archived" : "active"}
          className="w-full min-w-[760px] text-sm"
        >
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-2 font-medium">SKU</th>
              <th className="px-2 font-medium">Category</th>
              <th className="px-2 text-right font-medium">Price</th>
              <th className="px-2 text-right font-medium">Minimum</th>
              <th className="px-2 text-right font-medium">Stock</th>
              <th className="px-2 font-medium">Status</th>
              <th className="px-4 text-right font-medium">Actions</th>
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
                <td className="px-2">{p.active ? "Active" : "Archived"}</td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap">
                  {p.active ? (
                    <>
                      <Link
                        to="/owner/products/$productId/edit"
                        params={{ productId: p.id }}
                        data-testid="product-edit"
                        className="mr-2 text-sm font-medium text-primary hover:underline"
                      >
                        Edit
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="product-archive"
                        disabled={!hydrated || busy}
                        onClick={() => setConfirming(p)}
                      >
                        Archive
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="product-restore"
                      disabled={!hydrated || busy}
                      onClick={() => void change(restoreProductForOwner, p.id)}
                    >
                      {busy ? "Restoring…" : "Restore"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirming(null);
        }}
      >
        <AlertDialogContent data-testid="archive-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {confirming?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from the active list but is not deleted. You can restore it from
              Archived at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="archive-cancel" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="archive-confirm"
              disabled={busy}
              onClick={(e) => {
                // Keep the dialog open until the archive and the fresh list have finished.
                e.preventDefault();
                if (confirming) void change(archiveProductForOwner, confirming.id);
              }}
            >
              {busy ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  );
}
