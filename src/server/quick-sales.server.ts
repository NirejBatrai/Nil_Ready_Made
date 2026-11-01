/**
 * SERVER-ONLY service for the INTERIM Quick Sales notebook (decision 0004; retires when slice S9
 * lands). Callers must check permissions first (src/lib/quick-sales.ts uses `requirePermission`).
 * Uses relative imports so it can run outside Vite.
 *
 * - All money is integer satang; never floats. Amounts arrive as the text the person typed and
 *   are parsed HERE with `parseBahtToSatang` (string and integer operations only). Nothing from
 *   the browser is trusted.
 * - The server sets the id, the user, the time and the Bangkok business day. Inputs with any
 *   other field (a date, a time, a user, a cancel flag, …) are refused.
 * - Staff results are built field by field (`toStaffSale`) and only ever from the caller's own
 *   sales: they never contain totals, other people's sales, user ids or names.
 * - Cancel is ONE atomic update whose filter requires this sale, this user, not cancelled and
 *   created less than 10 minutes ago; there is no read-then-write gap.
 * - Database failures surface as DatabaseUnavailableError with no driver details.
 */
import { randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import { z } from "zod";
import { bangkokDay, bangkokTime } from "../lib/bangkok-time";
import { parseBahtToSatang } from "../lib/money";
import { DatabaseUnavailableError } from "./db.server";
import {
  ITEM_TEXT_MAX,
  openingFloatModel,
  PAYMENTS,
  quickSaleModel,
  type Payment,
  type QuickSaleDoc,
} from "./models/quick-sale.server";
import { userModel } from "./models/user.server";

export const CANCEL_WINDOW_MS = 10 * 60 * 1000;
/** The staff page lists at most this many of the caller's own entries (of the last 10 minutes). */
export const RECENT_LIMIT = 5;

export const QUICK_SALE_ERRORS = {
  input: "Enter the item, the amount and Cash or QR.",
  item: `Enter the item (1–${ITEM_TEXT_MAX} characters, no line breaks).`,
  amountZero: "The amount must be more than ฿0.00.",
  openingExists: "Today's change money is already recorded.",
  openingMissing: "Record today's change money first.",
  cannotCancel: "This sale can no longer be cancelled.",
} as const;

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

/** Who is acting; always from the server-side session, never from the request body. */
export interface Actor {
  id: string;
}

/** One of the caller's OWN sales, as the staff page may see it. */
export interface StaffSale {
  id: string;
  itemText: string;
  amountSatang: number;
  payment: Payment;
  /** "HH:mm", Asia/Bangkok. */
  time: string;
  cancelled: boolean;
  canCancel: boolean;
}

export interface StaffPage {
  hasOpeningFloat: boolean;
  recent: StaffSale[];
}

/** The day as `/api/daily-summary` returns it (non-cancelled sales only, oldest first). */
export interface DaySummary {
  date: string;
  openingFloatSatang: number | null;
  totalSatang: number;
  cashSatang: number;
  qrSatang: number;
  count: number;
  cancelledCount: number;
  sales: { time: string; itemText: string; amountSatang: number; payment: Payment }[];
}

/** The day as the owner page shows it: every sale, cancelled ones included, with staff names. */
export interface OwnerDay extends Omit<DaySummary, "sales"> {
  expectedCashSatang: number;
  sales: {
    id: string;
    time: string;
    itemText: string;
    amountSatang: number;
    payment: Payment;
    staffName: string;
    cancelled: boolean;
  }[];
}

const amountText = z.string().max(64);
const openingInput = z.object({ amountText }).strict();
const saleInput = z
  .object({ itemText: z.string().max(1000), amountText, payment: z.enum(PAYMENTS) })
  .strict();
const SALE_ID = /^qs_[0-9a-f-]{36}$/;
/** Control characters (line breaks, tabs, NUL, …) are refused rather than stripped. */
const hasControl = (text: string) =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });

async function db<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    throw new DatabaseUnavailableError("unavailable");
  }
}

const isDuplicateKey = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && e.code === 11000;

export function createQuickSalesService(conn: Connection, deps: { now?: () => Date } = {}) {
  const OpeningFloats = openingFloatModel(conn);
  const Sales = quickSaleModel(conn);
  const Users = userModel(conn);
  const now = deps.now ?? (() => new Date());

  /** The ONLY shape a staff response may contain for a sale. Built field by field. */
  const toStaffSale = (s: QuickSaleDoc, at: Date): StaffSale => ({
    id: s._id,
    itemText: s.itemText,
    amountSatang: s.amountSatang,
    payment: s.payment,
    time: bangkokTime(s.createdAt),
    cancelled: s.cancelled,
    canCancel: !s.cancelled && at.getTime() - s.createdAt.getTime() < CANCEL_WINDOW_MS,
  });

  async function loadDay(day: string) {
    const [opening, sales] = await Promise.all([
      db(() => OpeningFloats.findById(day).lean()),
      db(() => Sales.find({ businessDay: day }).sort({ createdAt: 1, _id: 1 }).lean()),
    ]);
    let cashSatang = 0;
    let qrSatang = 0;
    let count = 0;
    let cancelledCount = 0;
    for (const s of sales) {
      if (s.cancelled) {
        cancelledCount++;
        continue;
      }
      count++;
      if (s.payment === "cash") cashSatang += s.amountSatang;
      else qrSatang += s.amountSatang;
    }
    return {
      sales,
      totals: {
        date: day,
        openingFloatSatang: opening ? opening.amountSatang : null,
        totalSatang: cashSatang + qrSatang,
        cashSatang,
        qrSatang,
        count,
        cancelledCount,
      },
    };
  }

  return {
    /** Today's business day on the server clock, "YYYY-MM-DD" (Asia/Bangkok). */
    today: () => bangkokDay(now()),

    /** STAFF: whether today's opening change exists, and the caller's OWN recent entries. */
    async staffPage(actor: Actor): Promise<StaffPage> {
      const at = now();
      const [opening, recent] = await Promise.all([
        db(() => OpeningFloats.exists({ _id: bangkokDay(at) })),
        db(() =>
          Sales.find({
            userId: actor.id,
            createdAt: { $gt: new Date(at.getTime() - CANCEL_WINDOW_MS) },
          })
            .sort({ createdAt: -1, _id: -1 })
            .limit(RECENT_LIMIT)
            .lean(),
        ),
      ]);
      return { hasOpeningFloat: opening !== null, recent: recent.map((s) => toStaffSale(s, at)) };
    },

    /** STAFF: today's opening change money. A second one for the same day is refused. */
    async recordOpeningFloat(actor: Actor, input: unknown): Promise<{ ok: true } | Fail> {
      const parsed = openingInput.safeParse(input);
      if (!parsed.success) return fail(QUICK_SALE_ERRORS.input);
      const amount = parseBahtToSatang(parsed.data.amountText);
      if (!amount.ok) return fail(amount.error);
      const at = now();
      try {
        await OpeningFloats.create({
          _id: bangkokDay(at),
          amountSatang: amount.satang,
          userId: actor.id,
          createdAt: at,
        });
        return { ok: true };
      } catch (e) {
        if (isDuplicateKey(e)) return fail(QUICK_SALE_ERRORS.openingExists);
        throw new DatabaseUnavailableError("unavailable");
      }
    },

    /** STAFF: one notebook line. Needs today's opening change first. */
    async addSale(actor: Actor, input: unknown): Promise<{ ok: true; sale: StaffSale } | Fail> {
      const parsed = saleInput.safeParse(input);
      if (!parsed.success) return fail(QUICK_SALE_ERRORS.input);
      const itemText = parsed.data.itemText.trim();
      if (itemText.length < 1 || itemText.length > ITEM_TEXT_MAX || hasControl(itemText))
        return fail(QUICK_SALE_ERRORS.item);
      const amount = parseBahtToSatang(parsed.data.amountText);
      if (!amount.ok) return fail(amount.error);
      if (amount.satang < 1) return fail(QUICK_SALE_ERRORS.amountZero);
      const at = now();
      const businessDay = bangkokDay(at);
      if (!(await db(() => OpeningFloats.exists({ _id: businessDay }))))
        return fail(QUICK_SALE_ERRORS.openingMissing);
      const doc = await db(() =>
        Sales.create({
          _id: `qs_${randomUUID()}`,
          itemText,
          amountSatang: amount.satang,
          payment: parsed.data.payment,
          userId: actor.id,
          businessDay,
          cancelled: false,
          cancelledAt: null,
          createdAt: at,
        }),
      );
      return { ok: true, sale: toStaffSale(doc.toObject(), at) };
    },

    /**
     * STAFF: cancels the caller's OWN sale if it is less than 10 minutes old. One atomic update;
     * someone else's sale, an old one, an unknown id or an already cancelled one all get the same
     * answer, so nothing is revealed about other people's sales.
     */
    async cancelOwnSale(actor: Actor, saleId: unknown): Promise<{ ok: true } | Fail> {
      if (typeof saleId !== "string" || !SALE_ID.test(saleId))
        return fail(QUICK_SALE_ERRORS.cannotCancel);
      const at = now();
      const updated = await db(() =>
        Sales.findOneAndUpdate(
          {
            _id: saleId,
            userId: actor.id,
            cancelled: false,
            createdAt: { $gt: new Date(at.getTime() - CANCEL_WINDOW_MS) },
          },
          { $set: { cancelled: true, cancelledAt: at } },
          { returnDocument: "after", projection: { _id: 1 } },
        ).lean(),
      );
      return updated ? { ok: true } : fail(QUICK_SALE_ERRORS.cannotCancel);
    },

    /** OWNER / API: the day's totals and its non-cancelled sales, oldest first. */
    async daySummary(day: string): Promise<DaySummary> {
      const { sales, totals } = await loadDay(day);
      return {
        ...totals,
        sales: sales
          .filter((s) => !s.cancelled)
          .map((s) => ({
            time: bangkokTime(s.createdAt),
            itemText: s.itemText,
            amountSatang: s.amountSatang,
            payment: s.payment,
          })),
      };
    },

    /** OWNER: the day with expected cash and every sale (cancelled included), with staff names. */
    async ownerDay(day: string): Promise<OwnerDay> {
      const { sales, totals } = await loadDay(day);
      const ids = [...new Set(sales.map((s) => s.userId))];
      const users = ids.length
        ? await db(() =>
            Users.find({ _id: { $in: ids } })
              .select({ name: 1 })
              .lean(),
          )
        : [];
      const names = new Map(users.map((u) => [u._id, u.name]));
      return {
        ...totals,
        expectedCashSatang: (totals.openingFloatSatang ?? 0) + totals.cashSatang,
        sales: sales.map((s) => ({
          id: s._id,
          time: bangkokTime(s.createdAt),
          itemText: s.itemText,
          amountSatang: s.amountSatang,
          payment: s.payment,
          staffName: names.get(s.userId) ?? "Unknown",
          cancelled: s.cancelled,
        })),
      };
    },
  };
}
