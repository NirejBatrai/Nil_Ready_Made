/**
 * INTERIM permission table for Quick Sales (decision 0004). Deny by default: a role may do only
 * what is listed for it here; an unknown role or permission is refused. Enforced on the server by
 * `requirePermission` (src/lib/auth.ts → auth.server.ts), never by the browser.
 *
 * This is NOT the 0002 permission matrix (slice S1); it retires with Quick Sales when S9 lands.
 * The product and owner functions keep `requireOwner`, which refuses every role but `owner`.
 *
 * Browser-importable data only; knowing the table grants nothing.
 */

export type Permission =
  /** See whether today's opening change exists and one's OWN entries of the last 10 minutes. */
  | "quickSales.useOwn"
  | "quickSales.recordOpeningFloat"
  | "quickSales.add"
  /** Cancel one's OWN sale within 10 minutes (the service checks owner and age atomically). */
  | "quickSales.cancelOwn"
  /** A whole day: totals, expected cash and every sale with its staff name. */
  | "quickSales.viewDay";

export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  owner: [
    "quickSales.useOwn",
    "quickSales.recordOpeningFloat",
    "quickSales.add",
    "quickSales.cancelOwn",
    "quickSales.viewDay",
  ],
  staff: [
    "quickSales.useOwn",
    "quickSales.recordOpeningFloat",
    "quickSales.add",
    "quickSales.cancelOwn",
  ],
};

/** True only when `role` is in the table and lists `permission`. */
export function hasPermission(role: unknown, permission: Permission): boolean {
  if (typeof role !== "string" || !Object.hasOwn(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
