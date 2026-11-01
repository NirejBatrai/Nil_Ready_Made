/**
 * SERVER-ONLY `DEMO_ENABLED` setting: whether the browser demo (the `_shell` screens and the demo
 * accounts on `/`) is offered.
 *
 * - `"true"` turns it on, `"false"` turns it off; anything else (unset included) means the
 *   default: **OFF in production builds**, ON in dev (`vite dev`) and tests.
 * - Read at call time from the host environment. If the environment cannot be read, the demo is
 *   OFF (fail safe).
 *
 * The demo holds only fictional browser data, so this is about not offering it to staff and
 * customers by default, not about protecting data.
 */

/** The decision for one raw value; `production` is `import.meta.env.PROD`. */
export function demoEnabledFrom(value: unknown, production: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return !production;
}

export function readDemoEnabled(
  env: () => Record<string, string | undefined> = () => process.env,
  production: boolean = import.meta.env.PROD,
): boolean {
  try {
    return demoEnabledFrom(env()["DEMO_ENABLED"], production);
  } catch {
    return false;
  }
}
