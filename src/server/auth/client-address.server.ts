/**
 * SERVER-ONLY: the client address that login attempts are counted against.
 *
 * - On Cloudflare Workers there is no socket; Cloudflare's edge sets `CF-Connecting-IP` to the
 *   visitor's address and overwrites any value the client sent, so it is used there only.
 * - Everywhere else (Node.js, Bun, `vite dev`) the socket address is used and every header is
 *   ignored: off Cloudflare, `CF-Connecting-IP` and `X-Forwarded-For` are whatever the client
 *   typed. No proxy headers are trusted (there is no setting to enable that).
 * - Workers are detected by `navigator.userAgent === "Cloudflare-Workers"`, a property of the
 *   runtime itself (not of the request), which clients cannot influence.
 * - Anything that is not an IP address gives `undefined`: there is never a shared fallback key
 *   such as "unknown". Without an address, login skips the address limits (see auth.server.ts).
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** True only inside the Cloudflare Workers runtime (workerd). */
export function isCloudflareWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

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
  source: { socketIp: string | undefined; cfConnectingIp: string | undefined },
  onWorkers: boolean = isCloudflareWorkers(),
): string | undefined {
  const ip = (onWorkers ? source.cfConnectingIp : source.socketIp)?.trim();
  return ip && isIpAddress(ip) ? ip : undefined;
}
