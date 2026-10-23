// @vitest-environment node
/**
 * safeErrors / toSafeError: what a thrown server-function error looks like after the framework
 * serializes it for the browser (Seroval, the serializer TanStack Start uses).
 */
import { toCrossJSONAsync } from "seroval";
import { describe, expect, it } from "vitest";
import { SAFE_MESSAGES, toSafeError } from "@/lib/server-errors";

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database unavailable.");
    this.name = "DatabaseUnavailableError";
  }
}

const browserPayload = async (e: unknown) =>
  JSON.stringify(await toCrossJSONAsync(e, { refs: new Map() }));

describe("toSafeError", () => {
  it.each([
    [new AuthError("Not signed in."), SAFE_MESSAGES.notSignedIn],
    [new AuthError("Not allowed."), SAFE_MESSAGES.notAllowed],
    [new AuthError("some other internal text"), SAFE_MESSAGES.generic],
    [new DatabaseUnavailableError(), SAFE_MESSAGES.unavailable],
    [new Error("connect ECONNREFUSED 10.0.0.5:27017 user=admin"), SAFE_MESSAGES.generic],
    [new TypeError("Cannot read properties of undefined (reading 'x')"), SAFE_MESSAGES.generic],
    ["a thrown string", SAFE_MESSAGES.generic],
    [{ message: "Not signed in.", name: "AuthError" }, SAFE_MESSAGES.generic], // not an Error
    [undefined, SAFE_MESSAGES.generic],
  ])("maps %o to a fixed message", (input, message) => {
    const safe = toSafeError(input);
    expect(safe.message).toBe(message);
    expect(Object.hasOwn(safe, "stack")).toBe(false);
    expect(safe.cause).toBeUndefined();
  });

  it("an unsanitized error WOULD send its stack to the browser (why safeErrors exists)", async () => {
    expect(await browserPayload(new AuthError("Not signed in."))).toMatch(/"stack"/);
  });

  it("a sanitized error's browser payload has the message but no stack, paths or details", async () => {
    for (const input of [
      new AuthError("Not signed in."),
      new DatabaseUnavailableError(),
      new Error("bad auth mongodb+srv://user:pw@cluster.example.invalid at /home/x/app.ts:1:2"),
    ]) {
      const json = await browserPayload(toSafeError(input));
      expect(json).not.toMatch(/"stack"|\bat\s|\/home\/|\.ts:|mongodb|pw@/);
      expect(Object.values(SAFE_MESSAGES).some((m) => json.includes(m))).toBe(true);
    }
  });
});
