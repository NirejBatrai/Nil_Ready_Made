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

export interface OpeningFloatDoc {
  /** The Bangkok business day, "YYYY-MM-DD". */
  _id: string;
  amountSatang: number;
  userId: string;
  createdAt: Date;
}

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
  },
  { strict: "throw", collection: "opening_floats" },
);

export interface QuickSaleDoc {
  _id: string;
  itemText: string;
  amountSatang: number;
  payment: Payment;
  userId: string;
  businessDay: string;
  cancelled: boolean;
  cancelledAt: Date | null;
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
    createdAt: { type: Date, required: true },
  },
  { strict: "throw", collection: "quick_sales" },
);

export const openingFloatModel = (conn: Connection) =>
  conn.model<OpeningFloatDoc>("OpeningFloat", openingFloatSchema);
export const quickSaleModel = (conn: Connection) =>
  conn.model<QuickSaleDoc>("QuickSale", quickSaleSchema);
