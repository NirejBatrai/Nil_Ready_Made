/**
 * LOCAL, OWNER-RUN ONLY: converts product money from whole baht to integer satang.
 *
 *   bun run db:migrate-money-satang            # dry run (default): counts only, changes nothing
 *   bun run db:migrate-money-satang --apply    # writes the conversion
 *
 * - Old fields `price`, `minimumSellingPrice`, `cost` (whole baht) become `priceSatang`,
 *   `minimumSellingPriceSatang`, `costSatang` (× 100) and the old fields are removed, in one
 *   atomic update per product.
 * - Idempotent: only products that still have an old field are touched (the guard is in the
 *   update filter itself), so a second run, or a run after an interruption, changes nothing
 *   that was already converted.
 * - Refuses, changing nothing, if any product has old and new fields at once, old values that are
 *   not whole numbers ≥ 0 (price ≥ 1), or values that would exceed ฿10,000,000.00.
 * - Connects with MONGODB_URI (Bun loads it from .env); never prints it, and never prints product
 *   data: only counts.
 * - Writes with the raw driver collection, so the model's guard against query-style pricing
 *   updates does not apply; every value is checked above before anything is written.
 */
import { database, DatabaseUnavailableError } from "../src/server/db.server";
import { MAX_SATANG } from "../src/lib/money";

const OLD = ["price", "minimumSellingPrice", "cost"] as const;
const NEW = ["priceSatang", "minimumSellingPriceSatang", "costSatang"] as const;
const MAX_BAHT = MAX_SATANG / 100;

const anyOf = (fields: readonly string[]) => ({
  $or: fields.map((f) => ({ [f]: { $exists: true } })),
});
/** Guard: a product needs converting exactly when it still has an old field. */
const NEEDS_MIGRATION = anyOf(OLD);

/** A number between min and ฿10,000,000 with no fraction (never errors on other types). */
const wholeNumberIn = (field: string, min: number) => ({
  [field]: { $type: ["int", "long", "double", "decimal"], $gte: min, $lte: MAX_BAHT },
  $expr: {
    $eq: [
      { $convert: { input: `$${field}`, to: "long", onError: null, onNull: null } },
      `$${field}`,
    ],
  },
});

async function main(apply: boolean): Promise<number> {
  try {
    return await database.withDatabase(async (conn) => {
      if (!conn.db) throw new Error("not connected");
      const products = conn.db.collection("products");
      const total = await products.countDocuments({});
      const pending = await products.countDocuments(NEEDS_MIGRATION);
      const mixed = await products.countDocuments({ $and: [anyOf(OLD), anyOf(NEW)] });
      // Every product still to convert must have a valid whole-baht price and minimum, and a
      // valid cost if it has one; anything else is counted as invalid.
      const valid = await products.countDocuments({
        $and: [
          NEEDS_MIGRATION,
          wholeNumberIn("price", 1),
          wholeNumberIn("minimumSellingPrice", 0),
          { $or: [{ cost: { $exists: false } }, wholeNumberIn("cost", 0)] },
          { $expr: { $lte: ["$minimumSellingPrice", "$price"] } },
        ],
      });
      const invalid = pending - valid;
      console.log(`Products: ${total}`);
      console.log(`Already in satang: ${total - pending}`);
      console.log(`To convert (whole baht → satang): ${pending}`);
      console.log(`Blocking: ${mixed} with old and new fields, ${invalid} with invalid values`);
      if (mixed > 0 || invalid > 0) {
        console.error("Fix the blocking products first. Nothing was changed.");
        return 1;
      }
      if (!apply) {
        console.log("Dry run: nothing was changed. Run with --apply to convert.");
        return 0;
      }
      const result = await products.updateMany(NEEDS_MIGRATION, [
        {
          $set: {
            priceSatang: { $multiply: [{ $toLong: "$price" }, 100] },
            minimumSellingPriceSatang: { $multiply: [{ $toLong: "$minimumSellingPrice" }, 100] },
            costSatang: {
              $cond: [
                { $eq: [{ $type: "$cost" }, "missing"] },
                "$$REMOVE",
                { $multiply: [{ $toLong: "$cost" }, 100] },
              ],
            },
          },
        },
        { $unset: [...OLD] },
      ]);
      const left = await products.countDocuments(NEEDS_MIGRATION);
      console.log(`Converted: ${result.modifiedCount}. Still to convert: ${left}.`);
      return left === 0 ? 0 : 1;
    });
  } catch (e) {
    if (e instanceof DatabaseUnavailableError)
      console.error(
        `Could not use the database (${e.reason.replace("_", " ")}). Nothing was changed.`,
      );
    else console.error("Unexpected error. The migration did not complete; run it again.");
    return 1;
  } finally {
    await database.shutdown();
  }
}

const args = process.argv.slice(2);
if (args.some((a) => a !== "--apply")) {
  console.error("Usage: bun run db:migrate-money-satang [--apply]");
  process.exit(2);
}
main(args.includes("--apply")).then(
  (code) => process.exit(code),
  () => process.exit(1),
);
