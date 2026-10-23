/**
 * LOCAL SETUP ONLY: creates the first owner account. Run on your own computer:
 *
 *   bun run auth:create-owner
 *
 * - Connects with MONGODB_URI (Bun loads it from .env automatically); nothing is printed about it.
 * - Asks for email, name and password; the password is never shown or printed.
 * - Refuses if an owner already exists. There is no web or server-function equivalent.
 * - Creates the auth indexes (unique email, single owner, session expiry) if missing.
 * - Non-interactive use: pipe four lines (email, name, password, password again) to stdin.
 */
import { createAuthService, ensureAuthIndexes } from "../src/server/auth/auth.server";
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
  let name: string;
  let password: string;
  let confirm: string;
  if (stdin.isTTY) {
    email = await promptTty("Owner email: ", false);
    name = await promptTty("Owner name: ", false);
    password = await promptTty("Password (not shown): ", true);
    confirm = await promptTty("Repeat password: ", true);
  } else {
    [email = "", name = "", password = "", confirm = ""] = await readPiped();
  }
  if (password !== confirm) {
    console.error("Passwords do not match. Nothing was created.");
    return 1;
  }
  try {
    const result = await database.withDatabase(async (conn) => {
      await ensureAuthIndexes(conn);
      return createAuthService(conn).createFirstOwner({ email, name, password });
    });
    if (!result.ok) {
      console.error(`${result.error} Nothing was created.`);
      return 1;
    }
    console.log("Owner account created.");
    return 0;
  } catch (e) {
    console.error(
      e instanceof DatabaseUnavailableError
        ? `Could not use the database (${e.reason.replace("_", " ")}). Nothing was created.`
        : "Unexpected error. Nothing was created.",
    );
    return 1;
  } finally {
    await database.shutdown();
  }
}

main().then(
  (code) => process.exit(code),
  () => {
    console.error("Cancelled. Nothing was created.");
    process.exit(1);
  },
);
