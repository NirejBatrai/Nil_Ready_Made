/**
 * SERVER-ONLY models for the INTERIM Quick Sales notebook (decision 0004; retires when slice S9
 * lands). All money is integer satang; never floats.
 *
 * - `opening_floats`: the change money in the bag at the start of a Bangkok business day. `_id`
 *   IS the business day ("YYYY-MM-DD"), so MongoDB's built-in unique `_id` refuses a second one
 *   for the same day, even for simultaneous requests. No other index is needed.
 * - `quick_sales`: one line in the notebook. Every field except `itemText`, `amountSatang` and
 *   `payment` is set by the server (id, user, time, business day, cancel state). `createdAt` is
 *   written by the service from the server clock (not Mongoose timestamps), so tests can set it.
 *
 * No secondary indexes are defined: the data is small (one shop, about two weeks), and requests
 * never create indexes. Records are kept 5 years (decision 0004); nothing deletes them.
 *
 * Owner actions (decision 0004, amended): **nothing is ever hard-deleted.** "Remove" is a soft
 * delete (`removed: true` with who, when and why); restore sets `removed: false` and records who
 * and when, keeping the last removal's fields for the audit trail. An owner cancel records
 * `cancelledBy` and `cancelReason`. Documents written before these fields existed have none of
 * them: queries treat a missing `removed` as not removed (`{ removed: { $ne: true } }`).
 *
 * Opening change: `_id` stays the business day, so there is still only one ACTIVE opening change
 * per day. Recording a new one after removal is one atomic update that moves the removed entry
 * into `replaced` (kept, never deleted) and writes the new amount in its place.
 */
import { Schema, type Connection } from "mongoose";
import { MAX_SATANG } from "../../lib/money";

export const PAYMENTS = ["cash", "qr"] as const;
export type Payment = (typeof PAYMENTS)[number];
export const ITEM_TEXT_MAX = 100;
const BUSINESS_DAY = /^\d{4}-\d{2}-\d{2}$/;

const wholeSatang = {
  validator: Number.isSafeInteger,
  message: "{PATH} must be a whole number of satang.",
};

/** Soft-delete / restore fields, shared by opening changes and sales. */
export interface RemovalFields {
  removed?: boolean | undefined;
  removedBy?: string | null | undefined;
  removedAt?: Date | null | undefined;
  removeReason?: string | null | undefined;
  restoredBy?: string | null | undefined;
  restoredAt?: Date | null | undefined;
}

/** A removed opening change that a newer one replaced; kept inside the day's document. */
export interface ReplacedOpeningFloat {
  amountSatang: number;
  userId: string;
  createdAt: Date;
  removedBy: string | null;
  removedAt: Date | null;
  removeReason: string | null;
}

export interface OpeningFloatDoc extends RemovalFields {
  /** The Bangkok business day, "YYYY-MM-DD". */
  _id: string;
  amountSatang: number;
  userId: string;
  createdAt: Date;
  replaced?: ReplacedOpeningFloat[] | undefined;
}

export const REASON_MAX = 200;

const removalSchema = {
  removed: { type: Boolean, default: false },
  removedBy: { type: String, default: null },
  removedAt: { type: Date, default: null },
  removeReason: { type: String, default: null, maxlength: REASON_MAX },
  restoredBy: { type: String, default: null },
  restoredAt: { type: Date, default: null },
};

export const openingFloatSchema = new Schema<OpeningFloatDoc>(
  {
    _id: { type: String, required: true, match: BUSINESS_DAY },
    amountSatang: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_SATANG,
      validate: wholeSatang,
    },
    userId: { type: String, required: true },
    createdAt: { type: Date, required: true },
    ...removalSchema,
    replaced: {
      type: [
        new Schema<ReplacedOpeningFloat>(
          {
            amountSatang: { type: Number, required: true },
            userId: { type: String, required: true },
            createdAt: { type: Date, required: true },
            removedBy: { type: String, default: null },
            removedAt: { type: Date, default: null },
            removeReason: { type: String, default: null },
          },
          { _id: false, strict: "throw" },
        ),
      ],
      default: undefined,
    },
  },
  { strict: "throw", collection: "opening_floats" },
);

export interface QuickSaleDoc extends RemovalFields {
  _id: string;
  itemText: string;
  amountSatang: number;
  payment: Payment;
  userId: string;
  businessDay: string;
  cancelled: boolean;
  cancelledAt: Date | null;
  /** Set only by an owner cancel (a staff cancel of their own sale leaves it unset). */
  cancelledBy?: string | null | undefined;
  cancelReason?: string | null | undefined;
  createdAt: Date;
}

export const quickSaleSchema = new Schema<QuickSaleDoc>(
  {
    _id: { type: String, required: true },
    itemText: { type: String, required: true, trim: true, minlength: 1, maxlength: ITEM_TEXT_MAX },
    amountSatang: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_SATANG,
      validate: wholeSatang,
    },
    payment: { type: String, required: true, enum: PAYMENTS },
    userId: { type: String, required: true },
    businessDay: { type: String, required: true, match: BUSINESS_DAY },
    cancelled: { type: Boolean, required: true, default: false },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, default: null },
    cancelReason: { type: String, default: null, maxlength: REASON_MAX },
    createdAt: { type: Date, required: true },
    ...removalSchema,
  },
  { strict: "throw", collection: "quick_sales" },
);

export const openingFloatModel = (conn: Connection) =>
  conn.model<OpeningFloatDoc>("OpeningFloat", openingFloatSchema);
export const quickSaleModel = (conn: Connection) =>
  conn.model<QuickSaleDoc>("QuickSale", quickSaleSchema);
