/**
 * SERVER-ONLY product service. Exposed only through owner-only server functions in
 * src/lib/products.ts (read list, read one with cost, create).
 *
 * - Every input is treated as untrusted: validated with Zod, then with
 *   `productPricingErrorSatang` (per-product minimum, no global minimum), then by the Mongoose
 *   schema.
 * - All money is integer satang (`priceSatang`, `minimumSellingPriceSatang`, `costSatang`); never
 *   floats. The browser parses typed amounts to satang (src/lib/money.ts); the server re-checks
 *   that every amount is a whole number of satang within bounds.
 * - Ids are generated here; callers cannot choose them.
 * - Public reads never contain `costSatang`: it is excluded by the schema (`select: false`) and the
 *   mappers build results field by field. Only `getProductForOwner` returns it, and its future
 *   caller must check the owner role first (authentication does not exist yet).
 * - New products and variants always start with stock 0; callers cannot supply stock. Stock
 *   changes belong to inventory movements (a later step); `updateProduct` cannot touch stock,
 *   SKUs or variants.
 * - SKUs and barcodes are normalized here (trim + upper-case) and checked against the shared
 *   patterns in the model; creation refuses unless the unique indexes are verified to exist.
 * - Products are archived, never deleted, so past sales keep valid references.
 * - Database failures surface as DatabaseUnavailableError with no driver details.
 */
import { randomUUID } from "node:crypto";
import mongoose, { type Connection } from "mongoose";
import { z } from "zod";
import { CATEGORY_LABEL } from "@/lib/format";
import { productPricingErrorSatang } from "@/lib/money";
import type { Category, ProductVariant, Result } from "@/types/domain";
import { DatabaseUnavailableError } from "./db.server";
import {
  BARCODE_PATTERN,
  productModel,
  SKU_PATTERN,
  verifyProductIndexes,
  type ProductDocument,
} from "./models/product.server";

/**
 * A real product as the owner may see it, money in integer satang. Separate from the demo's
 * `Product` type (whole baht, browser-only).
 */
export interface OwnerProduct {
  id: string;
  name: string;
  sku: string;
  category: Category;
  description: string;
  priceSatang: number;
  minimumSellingPriceSatang: number;
  costSatang?: number | undefined;
  barcode?: string | undefined;
  imageUrl?: string | undefined;
  active: boolean;
  lowStockThreshold: number;
  variants: ProductVariant[];
}

/** A product as non-owners may see it: never includes cost. */
export type PublicProduct = Omit<OwnerProduct, "costSatang">;

const isCategory = (v: string): v is Category => Object.hasOwn(CATEGORY_LABEL, v);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const count = z.number().int().nonnegative().max(1_000_000);

const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SKU_PATTERN, "SKU must be 1–64 letters, digits, '.', '-' or '_'.");
const barcodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BARCODE_PATTERN, "Barcode must be 4–64 letters or digits (no spaces or symbols).");

// No stock fields: new variants always start at 0, and `.strict()` rejects any supplied value.
const variantInputSchema = z
  .object({
    sku: skuSchema,
    size: optionalText(32),
    color: optionalText(32),
    barcode: barcodeSchema.optional(),
  })
  .strict();

// Money fields are plain numbers here so `productPricingErrorSatang` gives one clear message; it
// rejects non-integers, negatives, NaN, Infinity and amounts above ฿10,000,000.00.
export const productInputSchema = z
  .object({
    name: text(200),
    sku: skuSchema,
    category: z.string().refine(isCategory, "Unknown category."),
    description: z.string().trim().max(2000).default(""),
    priceSatang: z.number(),
    minimumSellingPriceSatang: z.number(),
    costSatang: z.number().optional(),
    imageUrl: z.string().trim().url().startsWith("https://").max(2048).optional(),
    lowStockThreshold: count,
    variants: z.array(variantInputSchema).min(1).max(200),
  })
  .strict();

/** Fields an owner may edit later. SKU, variants and stock are deliberately absent. */
export const productUpdateSchema = z
  .object({
    name: text(200),
    category: z.string().refine(isCategory, "Unknown category."),
    description: z.string().trim().max(2000),
    priceSatang: z.number(),
    minimumSellingPriceSatang: z.number(),
    /** `null` clears the cost. */
    costSatang: z.number().nullable(),
    imageUrl: z.string().trim().url().startsWith("https://").max(2048).nullable(),
    lowStockThreshold: count,
  })
  .partial()
  .strict();

/** Product ids are generated strings; anything else (including query objects) is rejected. */
const productIdSchema = z.string().regex(/^prd_[A-Za-z0-9-]{1,64}$/);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const SETUP_INCOMPLETE =
  "Product setup is incomplete: required database indexes are missing. Run `bun run db:setup-indexes` first.";
const zodError = (e: z.ZodError) => {
  const issue = e.issues[0];
  return fail(issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input.");
};

function toVariant(productId: string, v: ProductDocument["variants"][number]): ProductVariant {
  return {
    id: v.id,
    productId,
    sku: v.sku,
    size: v.size,
    color: v.color,
    barcode: v.barcode,
    openingStock: v.openingStock,
    stock: v.stock,
  };
}

/** Built field by field so cost can never leak through a spread. */
export function toPublicProduct(doc: ProductDocument): PublicProduct {
  const variants = doc.variants.map((v) => toVariant(doc._id, v));
  return {
    id: doc._id,
    name: doc.name,
    sku: doc.sku,
    category: doc.category,
    description: doc.description,
    priceSatang: doc.priceSatang,
    minimumSellingPriceSatang: doc.minimumSellingPriceSatang,
    barcode: variants.length === 1 ? variants[0]?.barcode : undefined,
    imageUrl: doc.imageUrl,
    active: doc.active,
    lowStockThreshold: doc.lowStockThreshold,
    variants,
  };
}

const isDuplicateKey = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && e.code === 11000;

/** Business-rule failures become Results; anything else is a generic database failure. */
function writeFailure(e: unknown): { ok: false; error: string } {
  if (e instanceof mongoose.Error.ValidationError)
    return fail(Object.values(e.errors)[0]?.message ?? "Invalid product data.");
  if (e instanceof mongoose.Error.VersionError)
    return fail("This product was changed at the same time. Reload it and try again.");
  if (e instanceof mongoose.Error.StrictModeError) return fail("Invalid product data.");
  if (isDuplicateKey(e)) return fail("That SKU or barcode is already used by another product.");
  throw new DatabaseUnavailableError("unavailable");
}

async function read<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    throw new DatabaseUnavailableError("unavailable");
  }
}

export function createProductService(conn: Connection) {
  const Product = productModel(conn);

  return {
    async listProducts(opts: { includeArchived?: boolean } = {}): Promise<PublicProduct[]> {
      const filter = opts.includeArchived ? {} : { active: true };
      const docs = await read(() => Product.find(filter).select("-costSatang").sort({ name: 1 }));
      return docs.map(toPublicProduct);
    },

    async getProduct(id: unknown): Promise<PublicProduct | undefined> {
      const parsed = productIdSchema.safeParse(id);
      if (!parsed.success) return undefined;
      const doc = await read(() => Product.findById(parsed.data).select("-costSatang"));
      return doc ? toPublicProduct(doc) : undefined;
    },

    /**
     * OWNER-ONLY: includes cost. Not reachable from the browser. Any future server function
     * that calls this must verify an authenticated owner session first.
     */
    async getProductForOwner(id: unknown): Promise<OwnerProduct | undefined> {
      const parsed = productIdSchema.safeParse(id);
      if (!parsed.success) return undefined;
      const doc = await read(() => Product.findById(parsed.data).select("+costSatang"));
      return doc ? { ...toPublicProduct(doc), costSatang: doc.costSatang } : undefined;
    },

    async createProduct(input: unknown): Promise<Result<PublicProduct>> {
      const parsed = productInputSchema.safeParse(input);
      if (!parsed.success) return zodError(parsed.error);
      const p = parsed.data;
      const pricing = productPricingErrorSatang(p);
      if (pricing) return fail(pricing);
      // Fail closed: without the unique indexes, concurrent duplicates could be stored.
      if (!(await read(() => verifyProductIndexes(conn)))) return fail(SETUP_INCOMPLETE);
      try {
        const doc = await Product.create({
          _id: `prd_${randomUUID()}`,
          name: p.name,
          sku: p.sku,
          category: p.category,
          description: p.description,
          priceSatang: p.priceSatang,
          minimumSellingPriceSatang: p.minimumSellingPriceSatang,
          costSatang: p.costSatang,
          imageUrl: p.imageUrl,
          active: true,
          lowStockThreshold: p.lowStockThreshold,
          variants: p.variants.map((v) => ({
            id: `var_${randomUUID()}`,
            sku: v.sku,
            size: v.size,
            color: v.color,
            barcode: v.barcode,
            openingStock: 0,
            stock: 0,
          })),
        });
        return { ok: true, data: toPublicProduct(doc) };
      } catch (e) {
        return writeFailure(e);
      }
    },

    async updateProduct(id: unknown, update: unknown): Promise<Result<PublicProduct>> {
      const parsedId = productIdSchema.safeParse(id);
      if (!parsedId.success) return fail("Product not found.");
      const parsed = productUpdateSchema.safeParse(update);
      if (!parsed.success) return zodError(parsed.error);
      const u = parsed.data;
      // Load cost too, so the combined pricing check sees the full picture.
      const doc = await read(() => Product.findById(parsedId.data).select("+costSatang"));
      if (!doc) return fail("Product not found.");

      const next = {
        priceSatang: u.priceSatang ?? doc.priceSatang,
        minimumSellingPriceSatang: u.minimumSellingPriceSatang ?? doc.minimumSellingPriceSatang,
        costSatang: u.costSatang === null ? undefined : (u.costSatang ?? doc.costSatang),
      };
      const pricing = productPricingErrorSatang(next);
      if (pricing) return fail(pricing);

      if (u.name !== undefined) doc.name = u.name;
      if (u.category !== undefined) doc.category = u.category;
      if (u.description !== undefined) doc.description = u.description;
      if (u.lowStockThreshold !== undefined) doc.lowStockThreshold = u.lowStockThreshold;
      if (u.imageUrl !== undefined) doc.imageUrl = u.imageUrl ?? undefined;
      doc.priceSatang = next.priceSatang;
      doc.minimumSellingPriceSatang = next.minimumSellingPriceSatang;
      doc.costSatang = next.costSatang;
      try {
        // optimisticConcurrency: a concurrent save of the same product fails with VersionError.
        await doc.save();
        return { ok: true, data: toPublicProduct(doc) };
      } catch (e) {
        return writeFailure(e);
      }
    },

    async setProductActive(id: unknown, active: boolean): Promise<Result<PublicProduct>> {
      const parsedId = productIdSchema.safeParse(id);
      if (!parsedId.success) return fail("Product not found.");
      const doc = await read(() => Product.findById(parsedId.data).select("-costSatang"));
      if (!doc) return fail("Product not found.");
      doc.active = active;
      try {
        await doc.save();
        return { ok: true, data: toPublicProduct(doc) };
      } catch (e) {
        return writeFailure(e);
      }
    },
  };
}
