/**
 * Server functions for the INTERIM Quick Sales notebook (decision 0004; retires when slice S9
 * lands). Every function runs `safeErrors` first, then `requirePermission`, which re-reads the
 * session and the user and checks the role against src/lib/permissions.ts (deny by default).
 *
 * - Staff functions act only as the signed-in user (from the session, never from the request)
 *   and return only that user's own entries: never totals or other people's sales.
 * - `getDayForOwner` needs `quickSales.viewDay`, which only the owner has.
 * - Input validators never throw: anything unexpected is passed on as-is or becomes `null`, and
 *   the service refuses it.
 *
 * Browser code may import this file: handler bodies become RPC stubs in the client bundle and the
 * database code loads only through server-side dynamic imports.
 */
import { createServerFn } from "@tanstack/react-start";
import { requirePermission } from "./auth";
import { parseBusinessDay } from "./bangkok-time";
import { safeErrors } from "./server-errors";

const untrusted = (data: unknown): unknown => data;

/** STAFF page data: whether today's opening change exists, and the caller's own sales of today. */
export const getQuickSalesPage = createServerFn({ method: "GET" })
  .middleware([safeErrors, requirePermission("quickSales.useOwn")])
  .handler(async ({ context }) => {
    const [{ database }, { createQuickSalesService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/quick-sales.server"),
    ]);
    return database.withDatabase((conn) =>
      createQuickSalesService(conn).staffPage({ id: context.user.id }),
    );
  });

/** STAFF: `{ amountText }`, the change money typed in baht ("500", "1,000.50"). */
export const recordOpeningFloat = createServerFn({ method: "POST" })
  .middleware([safeErrors, requirePermission("quickSales.recordOpeningFloat")])
  .inputValidator(untrusted)
  .handler(async ({ data, context }) => {
    const [{ database }, { createQuickSalesService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/quick-sales.server"),
    ]);
    return database.withDatabase((conn) =>
      createQuickSalesService(conn).recordOpeningFloat({ id: context.user.id }, data),
    );
  });

/** STAFF: `{ itemText, amountText, payment: "cash" | "qr" }`. No date, time or user is accepted. */
export const addQuickSale = createServerFn({ method: "POST" })
  .middleware([safeErrors, requirePermission("quickSales.add")])
  .inputValidator(untrusted)
  .handler(async ({ data, context }) => {
    const [{ database }, { createQuickSalesService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/quick-sales.server"),
    ]);
    return database.withDatabase((conn) =>
      createQuickSalesService(conn).addSale({ id: context.user.id }, data),
    );
  });

/** STAFF: the sale id; only the caller's own sale, at most 10 minutes old. */
export const cancelQuickSale = createServerFn({ method: "POST" })
  .middleware([safeErrors, requirePermission("quickSales.cancelOwn")])
  .inputValidator(untrusted)
  .handler(async ({ data, context }) => {
    const [{ database }, { createQuickSalesService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/quick-sales.server"),
    ]);
    return database.withDatabase((conn) =>
      createQuickSalesService(conn).cancelOwnSale({ id: context.user.id }, data),
    );
  });

/** OWNER ONLY: one business day ("YYYY-MM-DD"; anything else means today in Bangkok). */
export const getDayForOwner = createServerFn({ method: "GET" })
  .middleware([safeErrors, requirePermission("quickSales.viewDay")])
  .inputValidator((data: unknown): string | null => parseBusinessDay(data))
  .handler(async ({ data }) => {
    const [{ database }, { createQuickSalesService }] = await Promise.all([
      import("@/server/db.server"),
      import("@/server/quick-sales.server"),
    ]);
    return database.withDatabase((conn) => {
      const q = createQuickSalesService(conn);
      return q.ownerDay(data ?? q.today());
    });
  });
