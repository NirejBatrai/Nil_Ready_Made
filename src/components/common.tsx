import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Backpack,
  Briefcase,
  CircleDot,
  Footprints,
  Gem,
  Lock,
  Package,
  Shirt,
  Sparkles,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalStatus, Category, PaymentStatus, SaleStatus } from "@/types/domain";
import { useDemoState } from "@/lib/repository/demo-store";

export type Tone = "neutral" | "success" | "warning" | "danger" | "primary" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-destructive-soft text-destructive border-transparent",
  primary: "bg-primary text-primary-foreground border-transparent",
  info: "bg-sage text-sage-foreground border-transparent",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  recorded: { label: "Cash recorded", tone: "neutral" },
  pending: { label: "Awaiting verification", tone: "warning" },
  verified: { label: "Verified (manual)", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  exception: { label: "Exception", tone: "danger" },
};
export const SALE_STATUS: Record<SaleStatus, { label: string; tone: Tone }> = {
  completed: { label: "Completed", tone: "success" },
  refunded: { label: "Refunded", tone: "warning" },
  partially_refunded: { label: "Part refunded", tone: "warning" },
  voided: { label: "Voided", tone: "danger" },
};
export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SampleTag() {
  return <StatusBadge tone="info">Sample data</StatusBadge>;
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClass,
}: {
  title?: ReactNode | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClass?: string | undefined;
}) {
  return (
    <section className={cn("surface overflow-hidden", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  to,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  to?: string | undefined;
  tone?: "warning" | "danger" | undefined;
}) {
  const inner = (
    <div className="surface h-full p-4 transition-colors hover:border-primary/40">
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          "num mt-2 text-2xl font-semibold tracking-tight",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EmptyState({
  icon: Icon = Package,
  title,
  body,
  action,
}: {
  icon?: LucideIcon | undefined;
  title: string;
  body?: string | undefined;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-sm text-xs text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}

const CAT_ICON: Record<Category, LucideIcon> = {
  shoes: Footprints,
  bags: Backpack,
  bikinis: Sparkles,
  swimwear: Waves,
  dresses: Shirt,
  suitcases: Briefcase,
  sports_balls: CircleDot,
  accessories: Gem,
  other: Package,
};

export function ProductThumb({
  category,
  imageUrl,
  className,
}: {
  category: Category;
  imageUrl?: string | undefined;
  className?: string | undefined;
}) {
  const Icon = CAT_ICON[category];
  if (imageUrl)
    return <img src={imageUrl} alt="" className={cn("rounded-md object-cover", className)} />;
  return (
    <div
      className={cn("flex items-center justify-center rounded-md bg-sage/60", className)}
      aria-hidden
    >
      <Icon className="size-1/2 max-h-8 max-w-8 text-sage-foreground/70" strokeWidth={1.5} />
    </div>
  );
}

export function OwnerOnly({ children }: { children: ReactNode }) {
  const { role } = useDemoState();
  if (role === "owner") return <>{children}</>;
  return (
    <div className="surface mx-auto mt-10 max-w-md">
      <EmptyState
        icon={Lock}
        title="Owner access required"
        body="This area is limited to the owner. In this demo the restriction is UI-only; the real backend must enforce it."
      />
    </div>
  );
}

export function useEmployeeName() {
  const { employees } = useDemoState();
  return (id: string) =>
    employees.find((e) => e.id === id)?.name ?? (id === "unknown" ? "Unknown" : id);
}
