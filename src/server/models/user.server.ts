/**
 * SERVER-ONLY user account model. Only the owner role exists for now; the `role` field is kept so
 * employee accounts can be added later without migrating data.
 * `passwordHash` is `select: false`: no query returns it unless it asks for `+passwordHash`.
 */
import { Schema, type Connection, type HydratedDocument } from "mongoose";

export const ROLES = ["owner"] as const;
export type UserRole = (typeof ROLES)[number];

export interface UserDoc {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserDoc>;

export const userSchema = new Schema<UserDoc>(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, required: true, enum: ROLES },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, required: true, default: true },
  },
  { strict: "throw", timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
// One owner account for now, enforced by the database (closes the check-then-create race in the
// setup script). Drop this index if multiple owners are ever needed.
userSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: "owner" }, name: "single_owner" },
);

export const userModel = (conn: Connection) => conn.model<UserDoc>("User", userSchema);
