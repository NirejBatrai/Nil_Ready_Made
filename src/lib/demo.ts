/**
 * Whether the browser demo is offered (`DEMO_ENABLED`, read on the server; OFF by default in
 * production builds, ON in dev and tests). See src/server/demo-setting.server.ts.
 *
 * - `getDemoEnabled`: server function (GET, `safeErrors`), true/false only.
 * - `demoIsOn()`: for `beforeLoad`. Any failure counts as OFF (fail safe). The browser caches a
 *   successful answer for the page's lifetime (the setting is the same for every visitor); the
 *   server asks every time.
 * - `requireDemo()`: `beforeLoad` for the demo layout: redirects to /login when the demo is OFF.
 */
import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { safeErrors } from "./server-errors";

export const getDemoEnabled = createServerFn({ method: "GET" })
  .middleware([safeErrors])
  .handler(async () => {
    const { readDemoEnabled } = await import("@/server/demo-setting.server");
    return readDemoEnabled() === true;
  });

let cached: boolean | undefined;

export async function demoIsOn(): Promise<boolean> {
  const browser = typeof window !== "undefined";
  if (browser && cached !== undefined) return cached;
  try {
    const on = (await getDemoEnabled()) === true;
    if (browser) cached = on;
    return on;
  } catch {
    return false;
  }
}

export async function requireDemo(): Promise<void> {
  if (!(await demoIsOn())) throw redirect({ to: "/login" });
}
