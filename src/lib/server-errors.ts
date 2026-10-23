/**
 * Error sanitizing for server functions. TanStack Start serializes a thrown error to the browser
 * with Seroval, including its stack trace (internal file paths). `safeErrors` must therefore be
 * the FIRST middleware on every server function: it replaces whatever was thrown with a new error
 * that has one fixed message and no stack.
 *
 * This file is importable by browser code (server functions reference it), so it cannot import
 * the server-only error classes; it recognizes them by name and exact message instead.
 */
import { createMiddleware } from "@tanstack/react-start";

export const SAFE_MESSAGES = {
  notSignedIn: "Not signed in.",
  notAllowed: "Not allowed.",
  unavailable: "Database unavailable.",
  generic: "Something went wrong.",
} as const;

const AUTH_MESSAGES: readonly string[] = [SAFE_MESSAGES.notSignedIn, SAFE_MESSAGES.notAllowed];

/** Maps anything thrown to a stackless Error with one of the SAFE_MESSAGES. */
export function toSafeError(error: unknown): Error {
  let message: string = SAFE_MESSAGES.generic;
  if (error instanceof Error) {
    if (error.name === "AuthError" && AUTH_MESSAGES.includes(error.message))
      message = error.message;
    else if (error.name === "DatabaseUnavailableError") message = SAFE_MESSAGES.unavailable;
  }
  const safe = new Error(message);
  // Seroval serializes `stack` when present; deleting it removes it from the payload entirely.
  delete safe.stack;
  return safe;
}

export const safeErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // A thrown Response is returned to the client as-is by the framework; keep that behavior.
    if (error instanceof Response) throw error;
    throw toSafeError(error);
  }
});
