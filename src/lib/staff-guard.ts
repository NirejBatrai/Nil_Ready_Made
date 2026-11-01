/**
 * INTERIM Quick Sales (decision 0004): staff have exactly one page, /quick-sales, and never reach
 * the browser demo. Used as `beforeLoad` on the demo's landing page and its `_shell` layout.
 *
 * - No session cookie (every ordinary demo visitor): `getCurrentUser` answers `null` without
 *   touching the database, and the demo works exactly as before.
 * - A staff session: redirected to /quick-sales.
 * - The session cannot be checked (database or network down while a cookie is present): also
 *   redirected to /quick-sales, which shows its "cannot be reached" message. Failing closed means
 *   a staff member can never land in the demo by accident.
 *
 * This is navigation, not access control: the demo holds only fictional browser data, and every
 * real operation is checked on the server.
 */
import { redirect } from "@tanstack/react-router";
import { getCurrentUser } from "./auth";

export async function keepStaffOutOfDemo(): Promise<void> {
  let role: string | undefined;
  try {
    role = (await getCurrentUser())?.role;
  } catch {
    throw redirect({ to: "/quick-sales" });
  }
  if (role === "staff") throw redirect({ to: "/quick-sales" });
}
