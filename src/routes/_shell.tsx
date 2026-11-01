import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { requireDemo } from "@/lib/demo";
import { keepStaffOutOfDemo } from "@/lib/staff-guard";

export const Route = createFileRoute("/_shell")({
  beforeLoad: async () => {
    // DEMO_ENABLED off (the production default): every demo screen redirects to /login.
    await requireDemo();
    // INTERIM Quick Sales (decision 0004): staff sessions go to /quick-sales, never the demo.
    await keepStaffOutOfDemo();
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
