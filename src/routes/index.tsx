import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ShieldAlert, ShoppingBag, LayoutDashboard } from "lucide-react";
import { repo } from "@/lib/repository";
import type { Role } from "@/types/domain";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Luxe Retail OS — Retail POS & inventory demo" },
      {
        name: "description",
        content:
          "Mobile point of sale, inventory, cash reconciliation and owner oversight for a boutique retail shop. Interactive demo.",
      },
      { property: "og:title", content: "Luxe Retail OS" },
      {
        property: "og:description",
        content: "Premium retail POS, inventory and business intelligence — interactive demo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const nav = useNavigate();
  const enter = (role: Role) => {
    repo.setDemoRole(role);
    nav({ to: role === "owner" ? "/dashboard" : "/pos" });
  };
  const cards = [
    {
      role: "owner" as Role,
      icon: LayoutDashboard,
      title: "Owner",
      who: "Ploy Siriwan",
      body: "Remote dashboard, approvals, reconciliation, audit trail and settings.",
    },
    {
      role: "employee" as Role,
      icon: ShoppingBag,
      title: "Employee",
      who: "Mali Chaiyaporn",
      body: "Fast one-hand checkout, cash drawer, requests and today’s sales.",
    },
  ];
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-xl">
        <div className="flex size-10 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
          L
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Luxe Retail OS</h1>
        <p className="mt-2 text-muted-foreground">
          Point of sale and back office for Luxe Beach Boutique. Choose a demo account to continue.
        </p>
        <div className="mt-8 grid gap-3">
          {cards.map((c) => (
            <button
              key={c.role}
              onClick={() => enter(c.role)}
              className="surface group flex items-center gap-4 p-5 text-left transition-colors hover:border-primary/50"
            >
              <div className="rounded-md bg-sage p-2.5 text-sage-foreground">
                <c.icon className="size-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">
                  {c.title}{" "}
                  <span className="text-sm font-normal text-muted-foreground">· {c.who}</span>
                </div>
                <div className="text-sm text-muted-foreground">{c.body}</div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
        <div className="mt-6 flex gap-2 rounded-md bg-warning-soft p-3 text-xs text-warning">
          <ShieldAlert className="size-4 shrink-0" />
          <p>
            Demo accounts are a UI simulation, not real sign-in. All data is fictional and stored in
            this browser only. Access control, payments and audit integrity must be enforced by the
            future backend.
          </p>
        </div>
      </div>
    </div>
  );
}
