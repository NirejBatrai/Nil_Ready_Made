/**
 * SERVER-ONLY login session model. `_id` is the SHA-256 hash of the session token; the token
 * itself is only ever in the user's HttpOnly cookie, so a database leak yields no usable session.
 * Expiry is checked in code on every request; the TTL index only cleans up old records.
 *
 * `createdIp`, `userAgent` and `lastSeenAt` are stored for security (session review, revocation,
 * a later idle timeout) and are never logged. They are optional: sessions created before they
 * existed keep working, and every field disappears with its session (TTL index, logout, revocation).
 */
import { Schema, type Connection } from "mongoose";

export interface SessionDoc {
  _id: string;
  userId: string;
  expiresAt: Date;
  /** Client address at login (see client-address.server.ts); null when none was known. */
  createdIp?: string | null | undefined;
  /** User-Agent header at login, at most 256 characters. */
  userAgent?: string | undefined;
  /** Last request using this session, updated at most once every 5 minutes. */
  lastSeenAt?: Date | undefined;
  createdAt: Date;
}

export const sessionSchema = new Schema<SessionDoc>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    createdIp: { type: String, default: undefined },
    userAgent: { type: String, maxlength: 256, default: undefined },
    lastSeenAt: { type: Date, default: undefined },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });

export const sessionModel = (conn: Connection) => conn.model<SessionDoc>("Session", sessionSchema);
