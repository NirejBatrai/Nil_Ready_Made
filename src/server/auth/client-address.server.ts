/**
 * SERVER-ONLY: the client address that login attempts are counted against.
 *
 * - On Vercel the socket belongs to Vercel's proxy (every visitor would share it). Vercel's edge
 *   sets `x-vercel-forwarded-for` to the visitor's address and overwrites any value the client
 *   sent, so on Vercel only that header is used: its FIRST entry, which must be a valid IP
 *   address (later entries are never consulted). The socket address is never used there.
 * - On Cloudflare Workers (historical target, decision 0001) there is no socket; Cloudflare's
 *   edge sets `CF-Connecting-IP`, so it is used there only.
 * - Everywhere else (Node.js, Bun, `vite dev`) the socket address is used and every header is
 *   ignored: there, `x-vercel-forwarded-for`, `CF-Connecting-IP` and `X-Forwarded-For` are
 *   whatever the client typed. No proxy headers are trusted (there is no setting for that).
 * - The platform is detected from the runtime, never from the request: Workers by
 *   `navigator.userAgent === "Cloudflare-Workers"`, Vercel by the `VERCEL=1` environment
 *   variable that Vercel sets for its functions. Clients cannot influence either.
 * - Anything that is not an IP address gives `undefined`: there is never a shared fallback key
 *   such as "unknown". Without an address, login skips the address limits (see auth.server.ts).
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** True only inside the Cloudflare Workers runtime (workerd). */
export function isCloudflareWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/** True only when Vercel runs this code (it sets `VERCEL=1` in its functions' environment). */
export function isVercel(): boolean {
  return typeof process !== "undefined" && process.env["VERCEL"] === "1";
}

export type ClientAddressPlatform = "workers" | "vercel" | "server";

export const currentPlatform = (): ClientAddressPlatform =>
  isCloudflareWorkers() ? "workers" : isVercel() ? "vercel" : "server";

/** A plain IPv4 or IPv6 address (an IPv6 zone such as `%eth0` is allowed), else false. */
export function isIpAddress(value: string): boolean {
  if (IPV4.test(value)) return true;
  const addr = value.replace(/%[\w.-]{1,32}$/, "");
  if (!addr.includes(":") || addr.length > 45) return false;
  try {
    // The URL parser validates IPv6 literals strictly.
    new URL(`http://[${addr}]/`);
    return true;
  } catch {
    return false;
  }
}

export function loginClientAddress(
  source: {
    socketIp: string | undefined;
    cfConnectingIp: string | undefined;
    vercelForwardedFor: string | undefined;
  },
  platform: ClientAddressPlatform = currentPlatform(),
): string | undefined {
  const raw =
    platform === "workers"
      ? source.cfConnectingIp
      : platform === "vercel"
        ? source.vercelForwardedFor?.split(",")[0]
        : source.socketIp;
  const ip = raw?.trim();
  return ip && isIpAddress(ip) ? ip : undefined;
}
