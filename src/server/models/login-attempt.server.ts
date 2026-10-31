/**
 * SERVER-ONLY login-attempt counters (collection `login_attempts`), shared by every server
 * instance that uses the same database. One document per limiter key, e.g.
 * `address|203.0.113.7` or `account|owner@example.com`, holding the attempts still inside the
 * window. Written only by the login limiter (src/server/auth/login-limiter.server.ts) with
 * atomic single-document updates.
 *
 * `expiresAt` is the end of the newest attempt's window; the TTL index deletes a document once
 * every attempt in it has expired. Expiry is also applied in the update itself, so limits are
 * correct even before the TTL monitor runs (it runs about once a minute) or if the index is
 * missing. The index is created by `bun run db:setup-indexes` / `auth:create-owner`.
 *
 * Keys contain the email and the client address (personal data): kept only for the limit
 * window (at most 15 minutes after the last attempt, plus TTL delay), never logged.
 */
import { Schema, type Connection } from "mongoose";

export interface LoginAttemptEntry {
  /** Random id, so one attempt can be un-counted without touching a simultaneous one. */
  id: string;
  at: Date;
}

export interface LoginAttemptDoc {
  _id: string;
  entries: LoginAttemptEntry[];
  expiresAt: Date;
}

export const LOGIN_ATTEMPT_TTL_INDEX = "login_attempt_expiry";

const entrySchema = new Schema<LoginAttemptEntry>(
  { id: { type: String, required: true }, at: { type: Date, required: true } },
  // `id` is a real field here, so disable Mongoose's `id` virtual (as for product variants).
  { _id: false, id: false, strict: "throw" },
);

export const loginAttemptSchema = new Schema<LoginAttemptDoc>(
  {
    _id: { type: String, required: true },
    entries: { type: [entrySchema], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { strict: "throw", collection: "login_attempts" },
);

loginAttemptSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: LOGIN_ATTEMPT_TTL_INDEX },
);

export const loginAttemptModel = (conn: Connection) =>
  conn.model<LoginAttemptDoc>("LoginAttempt", loginAttemptSchema);
