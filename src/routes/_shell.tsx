import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { keepStaffOutOfDemo } from "@/lib/staff-guard";

export const Route = createFileRoute("/_shell")({
  // INTERIM Quick Sales (decision 0004): staff sessions go to /quick-sales, never the demo.
  beforeLoad: keepStaffOutOfDemo,
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
