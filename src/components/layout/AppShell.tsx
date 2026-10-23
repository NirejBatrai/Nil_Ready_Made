import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BarChart3,
  Boxes,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScrollText,
  Settings,
  ShoppingBag,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hydrateDemoState, resetDemoState, useDemoState } from "@/lib/repository/demo-store";
import { markNotificationsRead, repo } from "@/lib/repository";
import { fmtDateTime } from "@/lib/format";
import type { Role } from "@/types/domain";

type NavItem = { to: string; label: string; icon: LucideIcon; roles: Role[]; mobile?: boolean };

export const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner"], mobile: true },
  { to: "/pos", label: "Checkout", icon: ShoppingBag, roles: ["owner", "employee"], mobile: true },
  { to: "/sales", label: "Sales", icon: Receipt, roles: ["owner", "employee"], mobile: true },
  { to: "/products", label: "Products", icon: Tag, roles: ["owner"] },
  { to: "/inventory", label: "Inventory", icon: Boxes, roles: ["owner", "employee"], mobile: true },
  { to: "/payments", label: "Payments", icon: CreditCard, roles: ["owner"] },
  {
    to: "/reconciliation",
    label: "Cash drawer",
    icon: Wallet,
    roles: ["owner", "employee"],
    mobile: true,
  },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck, roles: ["owner", "employee"] },
  { to: "/audit", label: "Audit trail", icon: ScrollText, roles: ["owner"] },
  { to: "/employees", label: "Employees", icon: Users, roles: ["owner"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["owner"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["owner"] },
];

function RoleSwitch() {
  const { role } = useDemoState();
  return (
    <div
      className="flex items-center rounded-md border bg-muted p-0.5 text-xs"
      role="group"
      aria-label="Demo role"
    >
      {(["owner", "employee"] as Role[]).map((r) => (
        <button
          key={r}
          onClick={() => repo.setDemoRole(r)}
          aria-pressed={role === r}
          className={cn(
            "rounded px-2.5 py-2 font-medium capitalize transition-colors sm:py-1",
            role === r
              ? "bg-card text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function Notifications() {
  const { notifications, role } = useDemoState();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  if (role !== "owner") return null;
  const tone = {
    critical: "bg-destructive",
    warning: "bg-warning",
    info: "bg-sage-foreground",
  } as const;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => setOpen(true)}
        className="relative"
      >
        <Bell />
        {unread > 0 && (
          <span className="num absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
            {unread}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <div className="mt-2 flex items-center justify-between px-4 text-xs text-muted-foreground">
            <span>Sample notifications</span>
            <button
              className="font-medium text-primary hover:underline"
              onClick={() => markNotificationsRead()}
            >
              Mark all read
            </button>
          </div>
          <ul className="mt-2 divide-y">
            {notifications.map((n) => (
              <li key={n.id}>
                <Link
                  to={n.link}
                  onClick={() => {
                    markNotificationsRead([n.id]);
                    setOpen(false);
                  }}
                  className={cn("flex gap-3 px-4 py-3 hover:bg-muted", !n.read && "bg-accent/40")}
                >
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone[n.severity])}
                    aria-label={n.severity}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {fmtDateTime(n.at)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

function NavList({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { approvals, role } = useDemoState();
  const pending = approvals.filter((a) => a.status === "pending").length;
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          title={collapsed ? n.label : undefined}
          className="group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{
            className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
          }}
        >
          <n.icon className="size-4 shrink-0" strokeWidth={1.75} />
          {!collapsed && <span className="flex-1">{n.label}</span>}
          {!collapsed && n.to === "/approvals" && role === "owner" && pending > 0 && (
            <span className="num rounded-full bg-warning-soft px-1.5 text-[11px] text-warning">
              {pending}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const state = useDemoState();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => hydrateDemoState(), []);
  const items = NAV.filter((n) => n.roles.includes(state.role));
  const mobileItems = items.filter((n) => n.mobile).slice(0, 4);
  const user = state.employees.find((e) => e.id === state.currentUserId);
  const isPos = path === "/pos";

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] md:flex",
          collapsed ? "w-[60px]" : "w-60",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            L
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold">Luxe Retail OS</div>
              <div className="text-[11px] text-muted-foreground">{state.settings.shopName}</div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <NavList items={items} collapsed={collapsed} />
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen />
            ) : (
              <>
                <PanelLeftClose /> Collapse
              </>
            )}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="bg-warning-soft px-4 py-1.5 text-center text-[11px] text-warning">
          Demo mode — fictional data stored only in this browser. Roles, payments and security are
          simulated.{" "}
          <button
            className="relative font-semibold underline after:absolute after:-inset-3 after:content-['']"
            onClick={() => {
              if (window.confirm("Reset demo? All demo changes in this browser will be lost."))
                resetDemoState();
            }}
          >
            Reset demo
          </button>
        </div>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenu(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{user?.name}</span>
            <span className="hidden sm:inline">
              {" "}
              · {state.role === "owner" ? "Owner" : "Employee"}
            </span>
          </div>
          <RoleSwitch />
          <Notifications />
        </header>
        <main
          className={cn(
            "mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-10",
            isPos && "max-w-none px-0 pt-0 sm:px-0 md:pb-0",
          )}
        >
          {children}
        </main>
      </div>

      {!isPos && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-card md:hidden"
          style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, 1fr)` }}
          aria-label="Quick"
        >
          {mobileItems.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
              activeProps={{ className: "text-primary font-medium" }}
            >
              <n.icon className="size-5" strokeWidth={1.75} />
              {n.label}
            </Link>
          ))}
          <button
            onClick={() => setMobileMenu(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
          >
            <Menu className="size-5" strokeWidth={1.75} />
            More
          </button>
        </nav>
      )}

      <Sheet open={mobileMenu} onOpenChange={setMobileMenu}>
        <SheetContent side="left" className="w-72 bg-sidebar p-3">
          <SheetHeader className="px-1">
            <SheetTitle>Luxe Retail OS</SheetTitle>
          </SheetHeader>
          <NavList items={items} onNavigate={() => setMobileMenu(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
