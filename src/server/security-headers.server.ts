/**
 * SERVER-ONLY baseline security headers for every dynamic response (pages, redirects, errors,
 * server functions). Applied once in src/server.ts. Static files never pass through it: Vite
 * serves them in dev, and the production Node server serves them before the app runs, so a
 * Nitro route rule in nitro.config.ts adds this same baseline to them (built-server E2E check).
 *
 * - Content-Security-Policy is `frame-ancestors 'none'` ONLY (anti-framing). A full CSP needs
 *   nonces for the hydration scripts and is a separate step.
 * - Cache-Control: no-store on every dynamic response, so owner pages and server-function data are
 *   never cached by the browser or a shared cache.
 * - HSTS is OFF unless the build is production, the request arrived over https, and the owner
 *   sets SECURITY_HSTS_MAX_AGE (whole seconds, 1 to 63072000) on the server.
 */

/** Sent on dynamic responses and, through the nitro.config.ts route rule, on static files. */
export const BASELINE_SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The app uses none of these. A camera barcode scanner would need camera=(self).
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), geolocation=(), " +
    "gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), " +
    "usb=(), xr-spatial-tracking=()",
} as const;

export const NO_STORE = "no-store";
export const HSTS_MAX_AGE_LIMIT = 63_072_000; // two years

/** Whole seconds from 1 to two years, or undefined (HSTS off). Never throws. */
export function parseHstsMaxAge(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d{0,7}$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return seconds <= HSTS_MAX_AGE_LIMIT ? seconds : undefined;
}

export interface SecurityHeaderOptions {
  /** Production build (import.meta.env.PROD). */
  production: boolean;
  /** Parsed SECURITY_HSTS_MAX_AGE; undefined keeps HSTS off. */
  hstsMaxAge: number | undefined;
}

/**
 * A copy of `response` with the security headers set. Copies instead of changing it in place
 * because redirect responses have immutable headers; body, status and every Set-Cookie are kept.
 */
export function applySecurityHeaders(
  request: Request,
  response: Response,
  options: SecurityHeaderOptions,
): Response {
  // The Response constructor only accepts 200–599 (e.g. a 101 upgrade cannot be copied).
  if (response.status < 200 || response.status > 599) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) headers.set(name, value);
  const { pathname, protocol } = new URL(request.url);
  // Hashed build assets keep their own long-lived caching if they ever pass through here.
  if (!(pathname.startsWith("/assets/") && headers.has("Cache-Control")))
    headers.set("Cache-Control", NO_STORE);
  if (options.production && protocol === "https:" && options.hstsMaxAge !== undefined)
    headers.set("Strict-Transport-Security", `max-age=${options.hstsMaxAge}`);
  else headers.delete("Strict-Transport-Security");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The options for this server, read at call time like the other server settings. Never throws:
 * it also runs on the error-page path, so a runtime without a usable `process.env` keeps HSTS off.
 */
export function securityHeaderOptions(
  env: () => Record<string, string | undefined> = () => process.env,
): SecurityHeaderOptions {
  let hstsMaxAge: number | undefined;
  try {
    hstsMaxAge = parseHstsMaxAge(env()["SECURITY_HSTS_MAX_AGE"]);
  } catch {
    hstsMaxAge = undefined;
  }
  return { production: import.meta.env.PROD, hstsMaxAge };
}
