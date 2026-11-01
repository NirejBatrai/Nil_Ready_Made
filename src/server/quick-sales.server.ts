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
 * - OWNER actions (callers check `quickSales.cancelAny` / `quickSales.remove`, owner only): cancel
 *   any sale with a reason; soft-remove and restore any sale or the day's opening change with a
 *   reason. **Nothing is ever hard-deleted.** Removed entries are left out of every total, the
 *   owner list, the staff list and the API; the owner sees them only in `ownerDay().removed`.
 * - Database failures surface as DatabaseUnavailableError with no driver details.
 */
import { randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import { z } from "zod";
import { bangkokDay, bangkokTime, parseBusinessDay } from "../lib/bangkok-time";
import { parseBahtToSatang } from "../lib/money";
import { DatabaseUnavailableError } from "./db.server";
import {
  ITEM_TEXT_MAX,
  openingFloatModel,
  PAYMENTS,
  quickSaleModel,
  REASON_MAX,
  type Payment,
  type QuickSaleDoc,
} from "./models/quick-sale.server";
import { userModel } from "./models/user.server";

export const CANCEL_WINDOW_MS = 10 * 60 * 1000;

export const QUICK_SALE_ERRORS = {
  input: "Enter the item, the amount and Cash or QR.",
  item: `Enter the item (1–${ITEM_TEXT_MAX} characters, no line breaks).`,
  amountZero: "The amount must be more than ฿0.00.",
  openingExists: "Today's change money is already recorded.",
  openingMissing: "Record today's change money first.",
  cannotCancel: "This sale can no longer be cancelled.",
  reason: `Enter a reason (1–${REASON_MAX} characters, no line breaks).`,
  ownerCannotCancel: "This sale is already cancelled or removed.",
  cannotRemove: "This entry is already removed or does not exist.",
  cannotRestore: "This entry is not removed or cannot be restored.",
} as const;

/** Not soft-removed. Documents from before the field existed have no `removed` at all. */
const NOT_REMOVED = { removed: { $ne: true } } as const;

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
  /** ALL of the caller's OWN sales of today's Bangkok business day, newest first. No totals. */
  sales: StaffSale[];
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

/** Who removed an entry, when and why (owner page, "Show removed"). */
export interface RemovalInfo {
  removedByName: string;
  /** "YYYY-MM-DD HH:mm", Asia/Bangkok. */
  removedAt: string;
  reason: string;
}

/**
 * The day as the owner page shows it: every sale that is not removed (cancelled ones included),
 * with staff names; removed entries are listed separately and count toward nothing.
 */
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
    /** Owner cancels only; null for a staff member's own cancel. */
    cancelReason: string | null;
    cancelledByName: string | null;
  }[];
  removed: {
    /** The day's removed opening change(s). Only the current one (`canRestore`) can be restored. */
    openingFloats: ({
      amountSatang: number;
      time: string;
      staffName: string;
      canRestore: boolean;
    } & RemovalInfo)[];
    sales: ({
      id: string;
      time: string;
      itemText: string;
      amountSatang: number;
      payment: Payment;
      staffName: string;
      cancelled: boolean;
    } & RemovalInfo)[];
  };
}

const amountText = z.string().max(64);
const openingInput = z.object({ amountText }).strict();
const saleInput = z
  .object({ itemText: z.string().max(1000), amountText, payment: z.enum(PAYMENTS) })
  .strict();
const SALE_ID = /^qs_[0-9a-f-]{36}$/;
/** Checked by `cleanReason`, so a missing or non-text reason gets the reason message. */
const reasonText = z.unknown();
const ownerCancelInput = z.object({ saleId: z.string().max(64), reason: reasonText }).strict();
const removeInput = z
  .object({ kind: z.enum(["sale", "opening"]), id: z.string().max(64), reason: reasonText })
  .strict();
const restoreInput = z
  .object({ kind: z.enum(["sale", "opening"]), id: z.string().max(64) })
  .strict();
/** Control characters (line breaks, tabs, NUL, …) are refused rather than stripped. */
const hasControl = (text: string) =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });

/** A trimmed reason of 1–200 characters without control characters, or null. */
function cleanReason(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 1000) return null;
  const reason = text.trim();
  return reason.length >= 1 && reason.length <= REASON_MAX && !hasControl(reason) ? reason : null;
}

/** The entry's id if it is well-formed for its kind ("qs_…" or a real "YYYY-MM-DD"), else null. */
function entryId(kind: "sale" | "opening", id: string): string | null {
  if (kind === "sale") return SALE_ID.test(id) ? id : null;
  return parseBusinessDay(id);
}

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

  /**
   * One day: totals over the sales that are neither cancelled nor removed; the opening change
   * counts only if it is not removed. `sales` holds every sale that is NOT removed (cancelled
   * ones included); removed ones are returned apart and count toward nothing.
   */
  async function loadDay(day: string) {
    const [openingDoc, allSales] = await Promise.all([
      db(() => OpeningFloats.findById(day).lean()),
      db(() => Sales.find({ businessDay: day }).sort({ createdAt: 1, _id: 1 }).lean()),
    ]);
    const sales = allSales.filter((s) => s.removed !== true);
    const removedSales = allSales.filter((s) => s.removed === true);
    const opening = openingDoc && openingDoc.removed !== true ? openingDoc : null;
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
      removedSales,
      openingDoc,
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

    /**
     * STAFF: whether today's opening change exists, and ALL of the caller's OWN sales of today's
     * Bangkok business day (cancelled ones included), newest first. Owner decision, 0004: never
     * other people's sales, never totals or counts; `canCancel` only under 10 minutes.
     */
    async staffPage(actor: Actor): Promise<StaffPage> {
      const at = now();
      const day = bangkokDay(at);
      const [opening, sales] = await Promise.all([
        db(() => OpeningFloats.exists({ _id: day, ...NOT_REMOVED })),
        db(() =>
          Sales.find({ userId: actor.id, businessDay: day, ...NOT_REMOVED })
            .sort({ createdAt: -1, _id: -1 })
            .lean(),
        ),
      ]);
      return { hasOpeningFloat: opening !== null, sales: sales.map((s) => toStaffSale(s, at)) };
    },

    /**
     * STAFF: today's opening change money. A second one for the same day is refused, unless the
     * owner removed the day's one: then ONE atomic update moves the removed entry into
     * `replaced` (kept, never deleted) and records the new amount in its place.
     */
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
        if (!isDuplicateKey(e)) throw new DatabaseUnavailableError("unavailable");
      }
      // Only server values reach the pipeline, each wrapped in $literal.
      const result = await db(() =>
        OpeningFloats.updateOne(
          { _id: bangkokDay(at), removed: true },
          [
            {
              $set: {
                replaced: {
                  $concatArrays: [
                    { $ifNull: ["$replaced", []] },
                    [
                      {
                        amountSatang: "$amountSatang",
                        userId: "$userId",
                        createdAt: "$createdAt",
                        removedBy: "$removedBy",
                        removedAt: "$removedAt",
                        removeReason: "$removeReason",
                      },
                    ],
                  ],
                },
              },
            },
            {
              $set: {
                amountSatang: { $literal: amount.satang },
                userId: { $literal: actor.id },
                createdAt: { $literal: at },
                removed: false,
                removedBy: null,
                removedAt: null,
                removeReason: null,
                restoredBy: null,
                restoredAt: null,
              },
            },
          ],
          { updatePipeline: true },
        ),
      );
      return result.modifiedCount === 1 ? { ok: true } : fail(QUICK_SALE_ERRORS.openingExists);
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
      if (!(await db(() => OpeningFloats.exists({ _id: businessDay, ...NOT_REMOVED }))))
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
            ...NOT_REMOVED,
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

    /**
     * OWNER: the day with expected cash and every sale that is not removed (cancelled included),
     * with staff names; removed entries (sales and opening changes) are listed apart.
     */
    async ownerDay(day: string): Promise<OwnerDay> {
      const { sales, removedSales, openingDoc, totals } = await loadDay(day);
      const openingEntries = [
        ...(openingDoc?.replaced ?? []).map((r) => ({ ...r, canRestore: false })),
        ...(openingDoc?.removed === true
          ? [
              {
                amountSatang: openingDoc.amountSatang,
                userId: openingDoc.userId,
                createdAt: openingDoc.createdAt,
                removedBy: openingDoc.removedBy ?? null,
                removedAt: openingDoc.removedAt ?? null,
                removeReason: openingDoc.removeReason ?? null,
                canRestore: true,
              },
            ]
          : []),
      ];
      const ids = new Set<string>();
      for (const s of [...sales, ...removedSales]) {
        ids.add(s.userId);
        if (s.cancelledBy) ids.add(s.cancelledBy);
        if (s.removedBy) ids.add(s.removedBy);
      }
      for (const o of openingEntries) {
        ids.add(o.userId);
        if (o.removedBy) ids.add(o.removedBy);
      }
      const users = ids.size
        ? await db(() =>
            Users.find({ _id: { $in: [...ids] } })
              .select({ name: 1 })
              .lean(),
          )
        : [];
      const names = new Map(users.map((u) => [u._id, u.name]));
      const nameOf = (id: string | null | undefined) => (id && names.get(id)) || "Unknown";
      const removal = (r: {
        removedBy?: string | null | undefined;
        removedAt?: Date | null | undefined;
        removeReason?: string | null | undefined;
      }): RemovalInfo => ({
        removedByName: nameOf(r.removedBy),
        removedAt: r.removedAt ? `${bangkokDay(r.removedAt)} ${bangkokTime(r.removedAt)}` : "",
        reason: r.removeReason ?? "",
      });
      return {
        ...totals,
        expectedCashSatang: (totals.openingFloatSatang ?? 0) + totals.cashSatang,
        sales: sales.map((s) => ({
          id: s._id,
          time: bangkokTime(s.createdAt),
          itemText: s.itemText,
          amountSatang: s.amountSatang,
          payment: s.payment,
          staffName: nameOf(s.userId),
          cancelled: s.cancelled,
          cancelReason: s.cancelReason ?? null,
          cancelledByName: s.cancelledBy ? nameOf(s.cancelledBy) : null,
        })),
        removed: {
          openingFloats: openingEntries.map((o) => ({
            amountSatang: o.amountSatang,
            time: bangkokTime(o.createdAt),
            staffName: nameOf(o.userId),
            canRestore: o.canRestore,
            ...removal(o),
          })),
          sales: removedSales.map((s) => ({
            id: s._id,
            time: bangkokTime(s.createdAt),
            itemText: s.itemText,
            amountSatang: s.amountSatang,
            payment: s.payment,
            staffName: nameOf(s.userId),
            cancelled: s.cancelled,
            ...removal(s),
          })),
        },
      };
    },

    /**
     * OWNER: cancels ANY sale (any age, any staff member) with a reason. One atomic update: only
     * a sale that is not cancelled and not removed. Records who, when and why.
     */
    async ownerCancelSale(actor: Actor, input: unknown): Promise<{ ok: true } | Fail> {
      const parsed = ownerCancelInput.safeParse(input);
      if (!parsed.success || !SALE_ID.test(parsed.data.saleId))
        return fail(QUICK_SALE_ERRORS.ownerCannotCancel);
      const reason = cleanReason(parsed.data.reason);
      if (!reason) return fail(QUICK_SALE_ERRORS.reason);
      const at = now();
      const updated = await db(() =>
        Sales.findOneAndUpdate(
          { _id: parsed.data.saleId, cancelled: false, ...NOT_REMOVED },
          {
            $set: { cancelled: true, cancelledAt: at, cancelledBy: actor.id, cancelReason: reason },
          },
          { returnDocument: "after", projection: { _id: 1 } },
        ).lean(),
      );
      return updated ? { ok: true } : fail(QUICK_SALE_ERRORS.ownerCannotCancel);
    },

    /**
     * OWNER: soft-removes a sale (`kind: "sale"`, its id) or the day's opening change
     * (`kind: "opening"`, the day "YYYY-MM-DD") with a reason. Never deletes anything.
     */
    async removeEntry(actor: Actor, input: unknown): Promise<{ ok: true } | Fail> {
      const parsed = removeInput.safeParse(input);
      const id = parsed.success ? entryId(parsed.data.kind, parsed.data.id) : null;
      if (!parsed.success || !id) return fail(QUICK_SALE_ERRORS.cannotRemove);
      const reason = cleanReason(parsed.data.reason);
      if (!reason) return fail(QUICK_SALE_ERRORS.reason);
      const set = {
        $set: { removed: true, removedBy: actor.id, removedAt: now(), removeReason: reason },
      };
      const options = { returnDocument: "after", projection: { _id: 1 } } as const;
      const updated =
        parsed.data.kind === "sale"
          ? await db(() => Sales.findOneAndUpdate({ _id: id, ...NOT_REMOVED }, set, options).lean())
          : await db(() =>
              OpeningFloats.findOneAndUpdate({ _id: id, ...NOT_REMOVED }, set, options).lean(),
            );
      return updated ? { ok: true } : fail(QUICK_SALE_ERRORS.cannotRemove);
    },

    /**
     * OWNER: restores a removed sale or the day's removed opening change. The last removal's
     * who/when/why stay on the document; the restore records who and when. An opening change
     * that a newer one replaced cannot be restored (only one per day can count).
     */
    async restoreEntry(actor: Actor, input: unknown): Promise<{ ok: true } | Fail> {
      const parsed = restoreInput.safeParse(input);
      const id = parsed.success ? entryId(parsed.data.kind, parsed.data.id) : null;
      if (!parsed.success || !id) return fail(QUICK_SALE_ERRORS.cannotRestore);
      const set = { $set: { removed: false, restoredBy: actor.id, restoredAt: now() } };
      const options = { returnDocument: "after", projection: { _id: 1 } } as const;
      const updated =
        parsed.data.kind === "sale"
          ? await db(() => Sales.findOneAndUpdate({ _id: id, removed: true }, set, options).lean())
          : await db(() =>
              OpeningFloats.findOneAndUpdate({ _id: id, removed: true }, set, options).lean(),
            );
      return updated ? { ok: true } : fail(QUICK_SALE_ERRORS.cannotRestore);
    },
  };
}
