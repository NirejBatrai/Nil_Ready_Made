# Security

_VERIFIED against the source and tests on 2026-10-23 (updated 2026-10-24) unless marked otherwise._
The prohibited-actions list in [../AGENTS.md](../AGENTS.md) applies to every task.

## Threat boundaries

- **The demo is not secure and never will be.** Its roles (`repo.setDemoRole`, `<OwnerOnly>`)
  and data live in the browser; anyone can change them. Never use demo state for access control.
- **Real protections exist only on the server**: TanStack Start server functions plus MongoDB.
  Route guards (`beforeLoad` redirects) are convenience only; `requireOwner` is the enforcement.
- Hosting is not set up. Everything below is verified locally with an isolated database.

## Authentication

| Item             | Implementation                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts         | One owner (`users.role` enum is `["owner"]`); DB index `single_owner` allows only one                                                                                           |
| Owner creation   | **Local only**: `bun run auth:create-owner` (hidden password prompt; refuses if an owner exists). No public registration route or server function exists.                       |
| Password hashing | Node `crypto.scrypt`, N=2^15, r=8, p=3, 16-byte salt, 64-byte key, `timingSafeEqual`; stored as `scrypt$N$r$p$salt$key`; out-of-bounds stored params rejected                   |
| Password policy  | 10–128 characters (NFKC-normalized)                                                                                                                                             |
| Login errors     | Always "Email or password is incorrect."; unknown emails are checked against a dummy hash (timing)                                                                              |
| Attempt limit    | Two in-memory limits (reset on restart; one process), both per 15 minutes: **5 per email + address** and **20 per address across all emails** (stops email rotation). See below |
| Hash concurrency | At most **2** scrypt derivations at once (≈64 MiB) and **8** waiting, per process; beyond that login answers "Too many attempts" without hashing                                |
| Inactive users   | Cannot log in; existing sessions stop working immediately                                                                                                                       |

### Login attempt limits (`src/server/auth/auth.server.ts`, VERIFIED 2026-10-24)

- **Address**: the socket IP (`X-Forwarded-For` is ignored because clients can forge it). IPv6
  is counted per **/64** (one user usually controls a whole /64); IPv4-mapped IPv6 counts as its
  IPv4 address; unparseable values (e.g. `unknown`) are counted exactly as given.
- **Counted before hashing, atomically**: both limits are checked and the attempt is counted in
  one synchronous step before any `await`, so simultaneous requests cannot all pass (30 at once
  → exactly 5 password checks). If the per-email limit refuses, the address count is undone.
- **Wrong password, unknown email, inactive account**: stays counted in both limits.
- **Correct password**: clears the per-email + address count and does not count against the
  address (failures by others from that address stay counted).
- **No verdict** (database error, or hashing busy): un-counted in both limits, so an outage or
  overload does not lock the owner out later. Hashing busy answers "Too many attempts. Try again
  later."; a database error answers "Database unavailable.".
- **Effect of an attack**: one address gets at most 20 password checks per 15 minutes in total
  and 5 per email. The owner signing in from a **different** address is unaffected; from the
  attacking address they must wait for the window to pass.
- The hashing limit releases its slot in `finally`, so failed derivations never leak a slot.

## Sessions and cookies

- Random 32-byte token in the cookie; MongoDB stores only its **SHA-256 hash** (`sessions._id`).
- Fixed lifetime **7 days** from login; expiry checked in code on every request (TTL index only
  cleans up). The user record is re-read on every request.
- Logout deletes the session and clears the cookie (also cleared if the DB is unreachable).
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`. Production: name `__Host-luxe_session`, `Secure`
  (requires HTTPS). Local dev (`http://127.0.0.1`): `luxe_session`, not `Secure`. Decided at
  build time (`import.meta.env.PROD`).
- No session secret exists (nothing to configure); passwords and tokens are never stored in
  `localStorage`/`sessionStorage` (E2E-tested).

## Authorization

- `requireOwner` (in `src/lib/auth.ts`) must be on every sensitive server function, **after**
  `safeErrors`: `.middleware([safeErrors, requireOwner])`. It throws "Not signed in." /
  "Not allowed.".
- Currently protected: `getProductForOwner`, `listProductsForOwner`, `createProductForOwner`.
- Product **cost** is owner-only: `select: false` in the schema; public mappers build results
  field by field; only `getProductForOwner` returns cost. The `/owner/products` pages never
  request or show cost; create responses never contain it (E2E-checked with a distinctive value).

## CSRF and request safety

- `src/start.ts` applies `createCsrfMiddleware` to all server functions
  (`handlerType === "serverFn"`): requests must be same-origin by `Sec-Fetch-Site`, `Origin`,
  or `Referer`; requests with none of these are rejected (403). Never set
  `allowRequestsWithoutOriginCheck`.
- State-changing server functions use `POST` (`login`, `logout`, `createProductForOwner`).
- Forms use `method="post"` and keep their submit button disabled until React hydrates, so a
  native submit can never put values (e.g. passwords) into a URL.
- `/login?redirect=` accepts **only** `/owner/products`; anything else is dropped (no open redirect).

## Security headers

_VERIFIED 2026-10-25 in source and unit tests (`security-headers.test.ts`); E2E coverage
(dev server over `http`, `auth.e2e.test.ts`) is listed separately below._

- **Verified by E2E** (exact values): the five baseline headers and `Cache-Control: no-store` on
  pages, 404s, signed-out redirects, signed-in owner pages, owner server functions, a CSRF 403
  and the database-down owner page; **no** HSTS over `http`; static `favicon.ico` bypasses
  `src/server.ts` (none of the headers); the production build's `.output/public/_headers`
  contains the baseline.
- **Unit tests only** (not E2E): **HSTS** (production + `https:` + setting; parsing; removal),
  keeping `Cache-Control` on hashed `/assets/*` responses, `no-store` for other path spellings,
  copying redirects / `Set-Cookie` / streamed bodies, both error-page paths in `src/server.ts`
  (mocked entry), an unreadable environment, and `public/_headers` holding exactly the baseline.
- **Not verified** (source/docs only): Cloudflare applying `public/_headers`, reading
  `SECURITY_HSTS_MAX_AGE` on Workers, and the request URL scheme on Workers.

| Header                      | Value                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `X-Frame-Options`           | `DENY`                                                                                                                             |
| `Content-Security-Policy`   | `frame-ancestors 'none'` **only** (anti-framing; no script/style policy)                                                           |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                          |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                  |
| `Permissions-Policy`        | camera, microphone, geolocation, payment, USB, serial, Bluetooth, HID, sensors, MIDI, autoplay, display capture, XR all `()` (off) |
| `Cache-Control`             | `no-store` on **every dynamic response** (static files unaffected)                                                                 |
| `Strict-Transport-Security` | Off by default; see below                                                                                                          |

- Applied in `src/server.ts` to every dynamic response: pages, redirects, 404s, server
  functions, CSRF 403s and both error-page paths. The response is copied (redirect headers are
  immutable); body, status and every `Set-Cookie` are kept. Values are set, never appended.
- `no-store` applies by rule, not by a path list, so owner pages and server-function data cannot
  be cached under another spelling of the path (case or percent-encoding). Hashed `/assets/*`
  responses that already carry their own `Cache-Control` keep it.
- Static files get the same baseline (without `no-store` or HSTS) from `public/_headers`; a
  unit test keeps it equal to the server constants. Cloudflare applying it is NOT VERIFIED.
- **HSTS** (unit-tested only; E2E runs over `http`) is sent only when all three hold: a production build (`import.meta.env.PROD`), the
  request URL is `https:`, and the server setting `SECURITY_HSTS_MAX_AGE` is a whole number of
  seconds from 1 to 63072000. Anything else, including an unreadable environment, means off;
  reading the setting never throws. Otherwise any HSTS header is removed. No
  `includeSubDomains`/`preload`. Owner rollout after HTTPS on the real domain is verified:
  300 → 86400 → 31536000. Removing the setting does not clear what browsers already stored; to
  back out, set a small value (e.g. `1`) so returning HTTPS visits replace it. Reading the
  setting on Workers via `process.env` is NOT VERIFIED (same mechanism as `MONGODB_URI`).
- **Behind a TLS-terminating proxy** that forwards plain `http` to the app (e.g. a Node.js host
  behind a load balancer), the request URL is `http:`, so HSTS is **never** sent, even with the
  setting. This fails safe; enabling HSTS there would need trusted-proxy handling (not built) or
  HSTS set at the proxy. On Cloudflare Workers the request URL is the visitor's `https:` URL
  (NOT VERIFIED on a deployment).
- A full Content-Security-Policy (scripts/styles) is **not** set: the hydration scripts, the
  error page's inline style and `onclick`, and Google Fonts would need nonces or allowlists.
- A future camera barcode scanner needs `camera=(self)` in both the constant and `public/_headers`.

## Error handling

- TanStack Start serializes thrown server-function errors **with their stack trace**. Therefore
  `safeErrors` must be the **first** middleware on every server function; it rethrows a
  stack-less error with one of: "Not signed in.", "Not allowed.", "Database unavailable.",
  "Something went wrong.".
- Input validators must never throw (they may run outside middleware); return `null`/defaults.
- `db.server.ts` replaces driver errors with `DatabaseUnavailableError` (no host, user or URI).
- E2E scans every browser-visible server-function response for stack traces, file paths,
  `node_modules`, `.server.ts` and `mongodb://`.
- Every server function, including the dev-only `getDatabaseHealth` (since 2026-10-24), uses
  `safeErrors`; a source check in `db.test.ts` guards the health function.

## Input validation (products)

- Zod `.strict()` schemas reject unknown fields; IDs, `active`, timestamps and **stock** are
  server-controlled (new products and variants always start at stock 0).
- Money is whole baht. `productPricingError`: price > 0, minimum ≥ 0 and ≤ price, cost ≥ 0.
  **Each product has its own minimum; there is no universal minimum price.**
- SKU: trim → upper-case → `^[A-Z0-9._-]{1,64}$`. Barcode: trim → upper-case → `^[A-Z0-9]{4,64}$`.
  Invalid characters are rejected, never stripped (different codes are never merged).
- Pricing fields can only change through document `save()`; query-style updates touching
  `price`/`minimumSellingPrice`/`cost` throw. Concurrent edits use optimistic concurrency.

## Database indexes and uniqueness

- Unique, case-insensitive (collation `en`, strength 2): `product_sku_unique_ci`,
  `variant_sku_unique_ci`, `variant_barcode_unique_ci` (partial).
- Created **only** by `bun run db:setup-indexes` (run by the owner). It first checks existing
  data read-only and refuses, changing nothing, if values collide or are not normalized; it never
  drops indexes or rewrites data.
- `createProduct` calls the read-only `verifyProductIndexes` and **refuses** ("Product setup is
  incomplete…") if any index is missing or has the wrong definition. Requests never create indexes.
- Auth indexes (unique email, `single_owner`, session TTL) are created by the setup/owner scripts.

## Secrets and configuration

- `.env*` and `.dev.vars` are git-ignored; `.env.example` (committed) lists `MONGODB_URI=`,
  `DB_HEALTHCHECK_ENABLED=` and `SECURITY_HSTS_MAX_AGE=` with **no values**.
- Never prefix secrets with `VITE_` — the build config exposes `VITE_*` values to the browser.
- In application code, `MONGODB_URI` is read only in `src/server/db.server.ts` at call time and
  never logged. The opt-in `test:db` test (`db.integration.test.ts`) also reads it from the
  environment or `.env`. Other tests load no `.env` (`envDir: false`, see TESTING.md).
- Production secrets would be set in the host's secret store (not configured yet).

## Development access

- `vite.config.ts` binds the dev server to `127.0.0.1` (overriding the Lovable default `::`), so
  server functions are not reachable from the local network. E2E verifies `::1` and the LAN
  address are refused.
- `/dev/db-health` and `/dev/auth` are diagnostics: unlinked and `noindex`. In production builds
  `/dev/auth` renders only "Not available."; `/dev/db-health` still renders, but its server
  function returns `disabled` unless `DB_HEALTHCHECK_ENABLED=true` is set on the server.

## Known security limitations (open)

- In-memory login limits and hashing bound: reset on restart and are per process (on Cloudflare
  Workers, per isolate), so several instances each allow their own quota. A shared store is not
  built.
- The login address is `getRequestIP()`, or the shared key `"unknown"` when it returns nothing
  (`session-context.server.ts`). If that happens for every request on the real host, all
  visitors share one address limit (20 per 15 minutes), so anyone could block the owner's
  login. What it returns on Cloudflare Workers is NOT VERIFIED.
- Many different addresses (a botnet) each get their own quota; there is deliberately no global
  per-email limit, because it would let anyone lock the owner out.
- An attacker who keeps the hashing limit full makes every login answer "Too many attempts"
  until the attack stops (resources stay bounded; availability does not).
- Every login request, including throttled ones, opens the database connection first
  (`withDatabase` wraps the whole login); on Workers that is one connection per request.
- No full Content-Security-Policy (only `frame-ancestors`); HSTS not enabled anywhere yet; static
  file headers on Cloudflare not verified.
- No audit log of logins or product changes yet.
- No password reset; no employee accounts.
- Production cookie needs HTTPS; hosting, Atlas network access and backups are undecided.
- Driver-level writes (`Model.collection.*`, `bulkWrite`) bypass Mongoose hooks; app code does
  not use them for products (tests use them only to simulate bad data).
