import type { Category, ProductVariant } from "@/types/domain";

export const TZ = "Asia/Bangkok";

const thb = new Intl.NumberFormat("en-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});
export const fmtTHB = (n: number) => thb.format(n).replace("THB", "฿").replace(/\s/, "");

export const fmtNum = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

/** YYYY-MM-DD in Bangkok time. */
export const dayKey = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);

export const CATEGORY_LABEL: Record<Category, string> = {
  shoes: "Shoes",
  bags: "Bags",
  bikinis: "Bikinis",
  swimwear: "Swimwear",
  dresses: "Dresses",
  suitcases: "Suitcases",
  sports_balls: "Sports balls",
  accessories: "Accessories",
  other: "Other",
};

export const variantLabel = (v: Pick<ProductVariant, "size" | "color">) =>
  [v.size, v.color].filter(Boolean).join(" · ") || "Standard";

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`# SAMPLE DEMO DATA - fictional\n${csv}`], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
