/**
 * LOCAL SETUP ONLY: creates the unique indexes the app requires. Run on your own computer:
 *
 *   bun run db:setup-indexes
 *
 * - Connects with MONGODB_URI (Bun loads it from .env); nothing is printed about it.
 * - Idempotent: safe to run again.
 * - NEVER modifies product data. It first checks, read-only, for existing SKUs/barcodes that would
 *   collide under the case-insensitive rule or are not stored normalized (trimmed, upper-case).
 *   If any are found, it lists them and stops without changing anything.
 * - If MongoDB refuses an index (existing duplicates, or an existing index with a different
 *   definition), it stops and reports; nothing is dropped or rewritten.
 */
import { ensureAuthIndexes } from "../src/server/auth/auth.server";
import { database, DatabaseUnavailableError } from "../src/server/db.server";
import {
  ensureProductIndexes,
  findProductKeyConflicts,
  verifyProductIndexes,
} from "../src/server/models/product.server";

const codeOf = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e ? e.code : undefined;

async function main(): Promise<number> {
  try {
    return await database.withDatabase(async (conn) => {
      const conflicts = await findProductKeyConflicts(conn);
      const problems = [
        ["Product SKUs that collide (case-insensitive)", conflicts.duplicateProductSkus],
        ["Variant SKUs that collide (case-insensitive)", conflicts.duplicateVariantSkus],
        ["Barcodes that collide (case-insensitive)", conflicts.duplicateBarcodes],
      ] as const;
      let blocked = false;
      for (const [label, values] of problems)
        if (values.length) {
          blocked = true;
          console.error(`${label}: ${values.join(", ")}`);
        }
      if (conflicts.notNormalized > 0) {
        blocked = true;
        console.error(
          `${conflicts.notNormalized} stored SKU/barcode value(s) are not trimmed upper-case.`,
        );
      }
      if (blocked) {
        console.error("Fix these products first. No indexes were created and no data was changed.");
        return 1;
      }
      await ensureAuthIndexes(conn);
      await ensureProductIndexes(conn);
      if (!(await verifyProductIndexes(conn))) {
        console.error(
          "Indexes could not be confirmed after setup. Product creation stays disabled.",
        );
        return 1;
      }
      console.log("Database indexes are in place. Product creation is enabled.");
      return 0;
    });
  } catch (e) {
    const code = codeOf(e);
    if (e instanceof DatabaseUnavailableError)
      console.error(
        `Could not use the database (${e.reason.replace("_", " ")}). Nothing was changed.`,
      );
    else if (code === 11000)
      console.error("Existing duplicate values prevent a unique index. No data was changed.");
    else if (code === 85 || code === 86)
      console.error(
        "An existing index with the same name but a different definition blocks setup. Nothing was dropped or changed.",
      );
    else console.error("Unexpected error. Setup did not complete; no data was changed.");
    return 1;
  } finally {
    await database.shutdown();
  }
}

main().then(
  (code) => process.exit(code),
  () => process.exit(1),
);
