/**
 * SERVER-ONLY password hashing with Node.js crypto.scrypt.
 *
 * Parameters: N=2^15, r=8, p=3 (≈32 MiB per hash), listed by OWASP as equivalent to its scrypt
 * minimum. They are stored inside each hash ("scrypt$N$r$p$salt$key"), so they can be raised
 * later; automatic re-hashing is postponed.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// scrypt needs roughly 128·N·r bytes; Node's default limit (32 MiB) is exactly that, so raise it.
const MAX_MEMORY = 64 * 1024 * 1024;

const derive = (password: string, salt: Buffer, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { ...opts, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

const normalize = (password: string) => password.normalize("NFKC");

/** Policy for new passwords. Returns a user-facing message, or undefined when acceptable. */
export function passwordPolicyError(password: string): string | undefined {
  const length = [...normalize(password)].length;
  if (length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(normalize(password), salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/**
 * Constant-time check. Malformed hashes, or parameters outside sane bounds (a stored hash must
 * not be able to make the server burn memory), return false instead of throwing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nText, rText, pText, saltText, keyText] = parts;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  const validN = Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 17 && (N & (N - 1)) === 0;
  if (!validN || !(r >= 1 && r <= 16) || !(p >= 1 && p <= 8)) return false;
  if (!Number.isInteger(r) || !Number.isInteger(p) || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  if (password.length > PASSWORD_MAX * 4) return false;
  try {
    const actual = await derive(normalize(password), Buffer.from(saltText, "base64url"), {
      N,
      r,
      p,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/**
 * A real hash of a random password, computed once. Login verifies against it when the email is
 * unknown, so response times do not reveal which emails have accounts.
 */
export const getDummyHash = () =>
  (dummyHash ??= hashPassword(randomBytes(24).toString("base64url")));
