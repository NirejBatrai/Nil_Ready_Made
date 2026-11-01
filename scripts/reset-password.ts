/**
 * LOCAL SETUP ONLY: sets a new password for an existing owner or staff account. Run on your own
 * computer:
 *
 *   bun run auth:reset-password
 *
 * - Connects with MONGODB_URI (Bun loads it from .env automatically); nothing is printed about it.
 * - Asks for the email and the new password twice; the password is never shown or printed.
 * - Same password rules and scrypt hashing as auth:create-owner. Changes only the password: the
 *   role, the email and the one-owner rule are untouched.
 * - Then signs the account out on EVERY device (revokes all its sessions).
 * - An unknown email gets only "No such user." There is no web or server-function equivalent.
 * - Non-interactive use: pipe three lines (email, password, password again) to stdin.
 */
import { createAuthService } from "../src/server/auth/auth.server";
import { database, DatabaseUnavailableError } from "../src/server/db.server";

const stdin = process.stdin;

/** Reads one line from a terminal; when `hidden`, typed characters are not echoed. */
function promptTty(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") return finish(new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string[]> {
  let text = "";
  for await (const chunk of stdin) text += String(chunk);
  return text.split(/\r?\n/);
}

async function main() {
  let email: string;
  let password: string;
  let confirm: string;
  if (stdin.isTTY) {
    email = await promptTty("Account email: ", false);
    password = await promptTty("New password (not shown): ", true);
    confirm = await promptTty("Repeat new password: ", true);
  } else {
    [email = "", password = "", confirm = ""] = await readPiped();
  }
  if (password !== confirm) {
    console.error("Passwords do not match. Nothing was changed.");
    return 1;
  }
  try {
    const result = await database.withDatabase((conn) =>
      createAuthService(conn).resetPassword({ email, password }),
    );
    if (!result.ok) {
      console.error(`${result.error} Nothing was changed.`);
      return 1;
    }
    console.log(
      `Password changed. Signed out on all devices (${result.sessionsRevoked} session(s) ended).`,
    );
    return 0;
  } catch (e) {
    console.error(
      e instanceof DatabaseUnavailableError
        ? `Could not use the database (${e.reason.replace("_", " ")}). Nothing was changed.`
        : "Unexpected error. Nothing was changed.",
    );
    return 1;
  } finally {
    await database.shutdown();
  }
}

main().then(
  (code) => process.exit(code),
  () => {
    console.error("Cancelled. Nothing was changed.");
    process.exit(1);
  },
);
