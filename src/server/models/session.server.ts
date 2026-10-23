/**
 * SERVER-ONLY login session model. `_id` is the SHA-256 hash of the session token; the token
 * itself is only ever in the user's HttpOnly cookie, so a database leak yields no usable session.
 * Expiry is checked in code on every request; the TTL index only cleans up old records.
 */
import { Schema, type Connection } from "mongoose";

export interface SessionDoc {
  _id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export const sessionSchema = new Schema<SessionDoc>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { strict: "throw", timestamps: { createdAt: true, updatedAt: false } },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });

export const sessionModel = (conn: Connection) => conn.model<SessionDoc>("Session", sessionSchema);
