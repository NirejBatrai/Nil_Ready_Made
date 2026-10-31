/**
 * SERVER-ONLY login-attempt limiter backed by MongoDB (collection `login_attempts`), so counts
 * survive restarts and are shared by every server instance using the same database (several
 * Vercel function instances, or several Node processes). Uses relative imports so the local
 * setup scripts can load it outside Vite.
 *
 * - `tryAttempt` is ONE atomic single-document update (an update pipeline with upsert): it drops
 *   attempts older than the window and records this attempt only if fewer than `maxFailures`
 *   remain. Simultaneous requests therefore can never all pass: exactly the remaining allowance
 *   is counted, however many arrive at once, on however many instances.
 * - A refused attempt is not recorded (as before).
 * - `cancel` removes exactly one recorded attempt (by its random id), for attempts that got no
 *   verdict or must not count; `reset` clears a key.
 * - Database errors become DatabaseUnavailableError. The caller fails CLOSED: no limiter answer
 *   means no password check (see auth.server.ts).
 */
import { randomUUID } from "node:crypto";
import type { Connection } from "mongoose";
import { DatabaseUnavailableError } from "../db.server";
import { loginAttemptModel, type LoginAttemptDoc } from "../models/login-attempt.server";

export interface LoginLimit {
  maxFailures: number;
  windowMs: number;
}

/** Keeps the three limits' keys apart inside the one collection. */
export type LoginLimiterKind = "email_address" | "address" | "account";

const isDuplicateKey = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && e.code === 11000;

const hasAttempt = (doc: unknown, attempt: string): boolean =>
  typeof doc === "object" &&
  doc !== null &&
  "entries" in doc &&
  Array.isArray(doc.entries) &&
  doc.entries.some(
    (e: unknown) => typeof e === "object" && e !== null && "id" in e && e.id === attempt,
  );

async function guarded<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    throw new DatabaseUnavailableError("unavailable");
  }
}

export function createLoginLimiter(conn: Connection, kind: LoginLimiterKind, limit: LoginLimit) {
  // The driver collection, typed with string ids (the model only defines the schema and index).
  const attempts = () => {
    if (!conn.db) throw new Error("not connected");
    return conn.db.collection<LoginAttemptDoc>(loginAttemptModel(conn).collection.collectionName);
  };
  const docId = (key: string) => `${kind}|${key}`;

  return {
    kind,
    limit,

    /**
     * Counts this attempt if the key is under its limit, atomically. Returns the attempt's id
     * (needed to cancel it), or `undefined` when the limit is reached (nothing was counted).
     */
    async tryAttempt(key: string, now: number): Promise<string | undefined> {
      const attempt = randomUUID();
      const at = new Date(now);
      const cutoff = new Date(now - limit.windowMs);
      // No request data reaches the pipeline except through the `_id` equality filter.
      const pipeline = [
        {
          $set: {
            entries: {
              $filter: {
                input: { $ifNull: ["$entries", []] },
                cond: { $gt: ["$$this.at", cutoff] },
              },
            },
          },
        },
        {
          $set: {
            entries: {
              $cond: [
                { $lt: [{ $size: "$entries" }, limit.maxFailures] },
                { $concatArrays: ["$entries", [{ id: attempt, at }]] },
                "$entries",
              ],
            },
          },
        },
        { $set: { expiresAt: { $add: [{ $max: "$entries.at" }, limit.windowMs] } } },
      ];
      return guarded(async () => {
        // Two first attempts on a new key can race to insert it; the loser retries as an update
        // (MongoDB also retries such upserts itself).
        for (let tries = 0; ; tries++) {
          try {
            const doc: unknown = await attempts().findOneAndUpdate({ _id: docId(key) }, pipeline, {
              upsert: true,
              returnDocument: "after",
              projection: { entries: 1 },
            });
            return hasAttempt(doc, attempt) ? attempt : undefined;
          } catch (e) {
            if (!isDuplicateKey(e) || tries >= 3) throw e;
          }
        }
      });
    },

    /** Un-counts one attempt recorded by `tryAttempt`. */
    async cancel(key: string, attempt: string): Promise<void> {
      await guarded(async () => {
        await attempts().updateOne({ _id: docId(key) }, { $pull: { entries: { id: attempt } } });
        // Atomic condition: a key that just got a new attempt is not deleted.
        await attempts().deleteOne({ _id: docId(key), entries: { $size: 0 } });
      });
    },

    /** Clears every attempt of this key. */
    async reset(key: string): Promise<void> {
      await guarded(() => attempts().deleteOne({ _id: docId(key) }));
    },

    /** Attempts currently inside the window (diagnostics and tests). */
    async count(key: string, now: number): Promise<number> {
      const doc = await guarded(() => attempts().findOne({ _id: docId(key) }));
      return (doc?.entries ?? []).filter((e) => now - e.at.getTime() < limit.windowMs).length;
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
