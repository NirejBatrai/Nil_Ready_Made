/**
 * SERVER-ONLY Product model. Mirrors `Product` in src/types/domain.ts.
 *
 * - All money is integer satang (฿1 = 100 satang); never floats. The field names say so
 *   (`priceSatang`, `minimumSellingPriceSatang`, `costSatang`), so values stored before the
 *   change (whole baht in `price`, `minimumSellingPrice`, `cost`) can never be read as satang;
 *   `bun run db:migrate-money-satang` converts them.
 * - Each product has its own owner-defined minimum selling price; there is no global minimum.
 *   The price rule is `productPricingErrorSatang` from src/lib/money.ts.
 * - `costSatang` is owner-only and `select: false`: no query returns it unless it asks for it.
 * - Pricing fields can only change through document `save()` (the product service). Query-style
 *   updates that touch them are rejected, so they cannot skip the price/minimum validation.
 *   Raw driver calls (`Model.collection.*`, `bulkWrite`) bypass Mongoose and are not used.
 * - SKU and barcode uniqueness is enforced by MongoDB with case-insensitive unique indexes. They
 *   are created ONLY by the local `bun run db:setup-indexes` command; requests never create
 *   indexes, and product creation refuses to run until `verifyProductIndexes` confirms them.
 */
import { Schema, type Connection, type HydratedDocument } from "mongoose";
import { MAX_SATANG, productPricingErrorSatang } from "@/lib/money";
import { CATEGORY_LABEL } from "@/lib/format";
import type { Category } from "@/types/domain";

export interface ProductVariantDoc {
  id: string;
  sku: string;
  size?: string | undefined;
  color?: string | undefined;
  barcode?: string | undefined;
  openingStock: number;
  stock: number;
}

export interface ProductDoc {
  _id: string;
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
  variants: ProductVariantDoc[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProductDocument = HydratedDocument<ProductDoc>;

/**
 * SKU policy: trimmed, upper-cased, then 1–64 of A–Z 0–9 . _ -
 * Barcode policy: trimmed, upper-cased, then 4–64 of A–Z 0–9. Anything else (inner spaces,
 * hyphens, symbols) is REJECTED rather than stripped, so two different codes are never merged.
 */
export const SKU_PATTERN = /^[A-Z0-9._-]{1,64}$/;
export const BARCODE_PATTERN = /^[A-Z0-9]{4,64}$/;

/** Case-insensitive comparison, so uniqueness holds even for a write that skipped upper-casing. */
const CASE_INSENSITIVE = { locale: "en", strength: 2 };

/** The unique indexes product creation requires. */
export const PRODUCT_INDEXES = [
  { name: "product_sku_unique_ci", key: { sku: 1 }, partial: false },
  { name: "variant_sku_unique_ci", key: { "variants.sku": 1 }, partial: false },
  { name: "variant_barcode_unique_ci", key: { "variants.barcode": 1 }, partial: true },
] as const;

/** Fields that only the product service may change (via `save()`, which runs validation). */
export const PROTECTED_PRICING_FIELDS = [
  "priceSatang",
  "minimumSellingPriceSatang",
  "costSatang",
] as const;

const wholeBaht = { validator: Number.isInteger, message: "{PATH} must be a whole number." };
const wholeSatang = {
  validator: Number.isSafeInteger,
  message: "{PATH} must be a whole number of satang.",
};

const variantSchema = new Schema<ProductVariantDoc>(
  {
    id: { type: String, required: true },
    sku: { type: String, required: true, trim: true, uppercase: true, match: SKU_PATTERN },
    size: { type: String, trim: true, maxlength: 32 },
    color: { type: String, trim: true, maxlength: 32 },
    barcode: { type: String, trim: true, uppercase: true, match: BARCODE_PATTERN },
    openingStock: { type: Number, required: true, min: 0, validate: wholeBaht },
    stock: { type: Number, required: true, min: 0, validate: wholeBaht },
  },
  // `id` is a real field here, so disable Mongoose's `id` virtual on variants.
  { _id: false, id: false, strict: "throw" },
);

export const productSchema = new Schema<ProductDoc>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sku: { type: String, required: true, trim: true, uppercase: true, match: SKU_PATTERN },
    category: { type: String, required: true, enum: Object.keys(CATEGORY_LABEL) },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    priceSatang: { type: Number, required: true, min: 1, max: MAX_SATANG, validate: wholeSatang },
    minimumSellingPriceSatang: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_SATANG,
      validate: wholeSatang,
    },
    costSatang: { type: Number, min: 0, max: MAX_SATANG, validate: wholeSatang, select: false },
    barcode: { type: String, trim: true, maxlength: 64 },
    imageUrl: { type: String, trim: true, maxlength: 2048 },
    active: { type: Boolean, required: true, default: true },
    lowStockThreshold: { type: Number, required: true, min: 0, validate: wholeBaht },
    variants: {
      type: [variantSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: "At least one variant." },
    },
  },
  { strict: "throw", timestamps: true, optimisticConcurrency: true },
);

for (const index of PRODUCT_INDEXES)
  productSchema.index(index.key, {
    name: index.name,
    unique: true,
    collation: CASE_INSENSITIVE,
    ...(index.partial
      ? { partialFilterExpression: { "variants.barcode": { $type: "string" } } }
      : {}),
  });

// Cross-field rules every save must satisfy, whoever calls it.
productSchema.pre("validate", function () {
  const pricing = productPricingErrorSatang({
    priceSatang: this.priceSatang,
    minimumSellingPriceSatang: this.minimumSellingPriceSatang,
    // Only checked when loaded: cost is select:false and absent from ordinary reads.
    costSatang: this.isSelected("costSatang") ? this.costSatang : undefined,
  });
  if (pricing) this.invalidate("minimumSellingPriceSatang", pricing);
  const skus = this.variants.map((v) => v.sku);
  const ids = this.variants.map((v) => v.id);
  if (new Set(skus).size !== skus.length)
    this.invalidate("variants", "Variant SKUs must be unique.");
  if (new Set(ids).size !== ids.length) this.invalidate("variants", "Variant ids must be unique.");
  // A multikey unique index does not catch duplicates inside one product, so check here.
  const barcodes = this.variants.flatMap((v) => (v.barcode ? [v.barcode] : []));
  if (new Set(barcodes).size !== barcodes.length)
    this.invalidate("variants", "Variant barcodes must be unique.");
});

const touchesPricing = (update: unknown): boolean => {
  if (Array.isArray(update)) return true; // aggregation-pipeline updates: never allowed
  if (update === null || typeof update !== "object") return false;
  return Object.entries(update).some(([key, value]) =>
    key.startsWith("$")
      ? touchesPricing(value)
      : PROTECTED_PRICING_FIELDS.some((f) => key === f || key.startsWith(`${f}.`)),
  );
};

productSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  if (touchesPricing(this.getUpdate()))
    throw new Error("Product pricing can only be changed through the product service.");
});

productSchema.pre(["replaceOne", "findOneAndReplace"], function () {
  throw new Error("Products cannot be replaced; use the product service.");
});

/** The Product model bound to a specific connection (idempotent). */
export const productModel = (conn: Connection) => conn.model<ProductDoc>("Product", productSchema);

/**
 * Creates the unique indexes. ONLY for the local `db:setup-indexes` command and tests; never call
 * it while handling a request. Connections use `autoIndex: false`.
 */
export const ensureProductIndexes = (conn: Connection) => productModel(conn).createIndexes();

const isMissingCollection = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && e.code === 26; // NamespaceNotFound

/**
 * READ-ONLY. True only if every required index exists with the exact definition: unique,
 * case-insensitive, and (for barcodes) partial. A missing collection counts as missing indexes.
 */
export async function verifyProductIndexes(conn: Connection): Promise<boolean> {
  let existing: Awaited<ReturnType<ReturnType<typeof productModel>["collection"]["indexes"]>>;
  try {
    existing = await productModel(conn).collection.indexes();
  } catch (e) {
    if (isMissingCollection(e)) return false;
    throw e;
  }
  return PRODUCT_INDEXES.every((required) =>
    existing.some(
      (i) =>
        i.name === required.name &&
        i.unique === true &&
        JSON.stringify(i.key) === JSON.stringify(required.key) &&
        i.collation?.["locale"] === CASE_INSENSITIVE.locale &&
        i.collation?.["strength"] === CASE_INSENSITIVE.strength &&
        Boolean(i.partialFilterExpression) === required.partial,
    ),
  );
}

/**
 * READ-ONLY pre-check for `db:setup-indexes`: existing values that would collide under the
 * case-insensitive rule, or that are not stored in normalized (trimmed, upper-case) form.
 * The setup command refuses to change anything while any are found.
 */
export async function findProductKeyConflicts(conn: Connection) {
  const products = productModel(conn).collection;
  const normalized = (path: string) => ({ $toUpper: { $trim: { input: path } } });
  const duplicates = async (unwind: boolean, path: string) =>
    (
      await products
        .aggregate<{ _id: string }>([
          ...(unwind ? [{ $unwind: "$variants" }] : []),
          { $match: { [path.slice(1)]: { $type: "string" } } },
          { $group: { _id: normalized(path), n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
          { $limit: 20 },
        ])
        .toArray()
    ).map((d) => d._id);
  const notNormalized = async (unwind: boolean, path: string) =>
    (
      await products
        .aggregate<{ n: number }>([
          ...(unwind ? [{ $unwind: "$variants" }] : []),
          { $match: { [path.slice(1)]: { $type: "string" } } },
          { $match: { $expr: { $ne: [path, normalized(path)] } } },
          { $count: "n" },
        ])
        .toArray()
    )[0]?.n ?? 0;
  return {
    duplicateProductSkus: await duplicates(false, "$sku"),
    duplicateVariantSkus: await duplicates(true, "$variants.sku"),
    duplicateBarcodes: await duplicates(true, "$variants.barcode"),
    notNormalized:
      (await notNormalized(false, "$sku")) +
      (await notNormalized(true, "$variants.sku")) +
      (await notNormalized(true, "$variants.barcode")),
  };
}
