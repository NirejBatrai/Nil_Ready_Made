/**
 * Domain contract for Luxe Retail OS.
 * These types are shared by the demo repository and a future backend repository.
 * Money is stored as integer THB (satang not used in the demo).
 */

export type Role = "owner" | "employee";

export type Category =
  | "shoes"
  | "bags"
  | "bikinis"
  | "swimwear"
  | "dresses"
  | "suitcases"
  | "sports_balls"
  | "accessories"
  | "other";

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  size?: string | undefined;
  color?: string | undefined;
  barcode?: string | undefined;
  openingStock: number;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: Category;
  description: string;
  price: number;
  /** Owner-only field. */
  cost?: number | undefined;
  barcode?: string | undefined;
  imageUrl?: string | undefined;
  active: boolean;
  lowStockThreshold: number;
  variants: ProductVariant[];
}

export type PaymentMethod = "cash" | "qr";
export type PaymentStatus = "recorded" | "pending" | "verified" | "failed" | "exception";
export type SaleStatus = "completed" | "refunded" | "partially_refunded" | "voided";

export interface SaleItem {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  sku: string;
  qty: number;
  /** Price snapshot at time of sale. */
  unitPrice: number;
  /** Cost snapshot, when known. */
  unitCost?: number | undefined;
}

export interface Sale {
  id: string;
  receiptNo: string;
  createdAt: string;
  employeeId: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  cashReceived?: number | undefined;
  change?: number | undefined;
  cashSessionId?: string | undefined;
}

export interface Payment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  expected: number;
  recorded: number;
  reference?: string | undefined;
  recordedAt: string;
  status: PaymentStatus;
  verifiedBy?: string | undefined;
  verifiedAt?: string | undefined;
  verificationNote?: string | undefined;
  /** Always "manual" in the demo; no bank integration exists. */
  verificationSource?: "manual" | undefined;
}

export type MovementType =
  "opening" | "sale" | "restock" | "customer_return" | "approved_correction" | "damaged" | "other";

export interface InventoryMovement {
  id: string;
  variantId: string;
  type: MovementType;
  /** Signed quantity delta. */
  qty: number;
  at: string;
  actorId: string;
  reference?: string | undefined;
  note?: string | undefined;
}

export type CashSessionStatus = "open" | "balanced" | "pending_review" | "resolved";

export interface CashMovement {
  id: string;
  direction: "in" | "out";
  amount: number;
  reason: string;
  at: string;
}

export interface CashSession {
  id: string;
  employeeId: string;
  openedAt: string;
  openingFloat: number;
  openingNotes?: string | undefined;
  cashMovements: CashMovement[];
  closedAt?: string | undefined;
  /** Snapshot of expected cash at closing; never rewritten. */
  expectedAtClose?: number | undefined;
  countedCash?: number | undefined;
  denominations?: Record<string, number> | undefined;
  explanation?: string | undefined;
  status: CashSessionStatus;
  ownerNote?: string | undefined;
}

export interface Refund {
  id: string;
  saleId: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  at: string;
  approvalId: string;
}

export type ApprovalType =
  "refund" | "discount" | "price_override" | "stock_adjustment" | "cash_discrepancy" | "other";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequest {
  id: string;
  number: string;
  type: ApprovalType;
  requesterId: string;
  createdAt: string;
  saleId?: string | undefined;
  variantId?: string | undefined;
  cashSessionId?: string | undefined;
  amount?: number | undefined;
  stockDiff?: number | undefined;
  reason: string;
  status: ApprovalStatus;
  decisionNote?: string | undefined;
  decidedAt?: string | undefined;
  decidedBy?: string | undefined;
  stockCountId?: string | undefined;
}

export type AuditResult = "success" | "failure" | "pending";

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  action: string;
  target: string;
  result: AuditResult;
  summary: string;
}

export interface EmployeeProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  active: boolean;
  lastActiveAt: string;
  createdAt: string;
}

export type Severity = "info" | "warning" | "critical";

export interface AppNotification {
  id: string;
  severity: Severity;
  at: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
}

export interface StockCount {
  id: string;
  startedAt: string;
  submittedAt?: string | undefined;
  actorId: string;
  lines: { variantId: string; recorded: number; counted: number }[];
  status: "draft" | "submitted" | "reviewed";
}

export interface ShopSettings {
  shopName: string;
  address: string;
  taxId: string;
  receiptFooter: string;
  showSkuOnReceipt: boolean;
  defaultLowStock: number;
  maxEmployeeDiscountPct: number;
  refundWindowDays: number;
  notifyCashDiscrepancy: boolean;
  notifyPendingQr: boolean;
  notifyLowStock: boolean;
}

export interface CartLine {
  variantId: string;
  qty: number;
}

export interface CreateSaleRequest {
  lines: CartLine[];
  discountPct: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number | undefined;
  qrReference?: string | undefined;
  /** Client idempotency key; backend must enforce uniqueness. */
  idempotencyKey: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
