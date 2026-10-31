/**
 * Product server functions. All OWNER-ONLY. Reads, creation, editing and archiving; used only by
 * the /owner/products pages and /dev/auth, never by the demo screens. There is no delete.
 *
 * Browser code may import this file: handler bodies become RPC stubs in the client bundle and the
 * database code loads only through server-side dynamic imports.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireOwner } from "./auth";
import { safeErrors } from "./server-errors";

/** Never throws (see `credentials` in ./auth): an invalid id becomes `null`. */
const productId = (data: unknown): string | null =>
  typeof data === "string" && /^prd_[A-Za-z0-9-]{1,64}$/.test(data) ? data : null;

/** OWNER-ONLY: one product including its cost price, or `null` if it does not exist. */
export const getProductForOwner = createServerFn({ method: "GET" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(productId)
  .handler(async ({ data }) => {
    if (!data) return null;
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    const product = await database.withDatabase((conn) =>
      createProductService(conn).getProductForOwner(data),
    );
    return product ?? null;
  });

/** Never throws: anything other than `{ includeArchived: true }` means active products only. */
const listOptions = (data: unknown): { includeArchived: boolean } => ({
  includeArchived:
    typeof data === "object" &&
    data !== null &&
    "includeArchived" in data &&
    data.includeArchived === true,
});

/**
 * OWNER-ONLY, READ-ONLY product list. Never includes cost: it uses the service's public
 * `listProducts`, which excludes cost at the query and builds results field by field.
 */
export const listProductsForOwner = createServerFn({ method: "GET" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(listOptions)
  .handler(async ({ data }) => {
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    return database.withDatabase((conn) =>
      createProductService(conn).listProducts({ includeArchived: data.includeArchived }),
    );
  });

/** Never throws; the product service validates the input strictly (unknown fields rejected). */
const untrustedInput = (data: unknown): unknown => data;

/**
 * OWNER-ONLY product creation (POST: also covered by the CSRF check). The input may include an
 * optional cost; the response is the cost-free public product. Stock always starts at 0, and
 * creation refuses until the unique indexes exist (`bun run db:setup-indexes`).
 */
export const createProductForOwner = createServerFn({ method: "POST" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(untrustedInput)
  .handler(async ({ data }) => {
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    return database.withDatabase((conn) => createProductService(conn).createProduct(data));
  });

/**
 * OWNER-ONLY: one product for the edit form, WITHOUT cost (cost stays write-only, as on the
 * create form), or `null` if it does not exist. Archived products are returned too.
 */
export const getProductForEditing = createServerFn({ method: "GET" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(productId)
  .handler(async ({ data }) => {
    if (!data) return null;
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    const product = await database.withDatabase((conn) =>
      createProductService(conn).getProduct(data),
    );
    return product ?? null;
  });

/** Never throws; both parts are validated strictly by the product service. */
const productUpdate = (data: unknown): { id: unknown; update: unknown } =>
  typeof data === "object" && data !== null && "id" in data && "update" in data
    ? { id: data.id, update: data.update }
    : { id: null, update: null };

/**
 * OWNER-ONLY product edit (POST). Only name, category, description, prices, cost (`null` clears
 * it), image URL and low-stock threshold can change; SKU, variants, stock and the active flag
 * cannot (unknown fields are rejected). The response is the cost-free public product.
 */
export const updateProductForOwner = createServerFn({ method: "POST" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(productUpdate)
  .handler(async ({ data }) => {
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    return database.withDatabase((conn) =>
      createProductService(conn).updateProduct(data.id, data.update),
    );
  });

/** OWNER-ONLY: hides a product from the active list. Products are never deleted. */
export const archiveProductForOwner = createServerFn({ method: "POST" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(untrustedInput)
  .handler(async ({ data }) => {
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    return database.withDatabase((conn) =>
      createProductService(conn).setProductActive(data, false),
    );
  });

/** OWNER-ONLY: returns an archived product to the active list. */
export const restoreProductForOwner = createServerFn({ method: "POST" })
  .middleware([safeErrors, requireOwner])
  .inputValidator(untrustedInput)
  .handler(async ({ data }) => {
    const [{ database }, { createProductService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/products.server"),
    ]);
    return database.withDatabase((conn) => createProductService(conn).setProductActive(data, true));
  });
