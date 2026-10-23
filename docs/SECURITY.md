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

| Item             | Implementation                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts         | One owner (`users.role` enum is `["owner"]`); DB index `single_owner` allows only one                                                                         |
| Owner creation   | **Local only**: `bun run auth:create-owner` (hidden password prompt; refuses if an owner exists). No public registration route or server function exists.     |
| Password hashing | Node `crypto.scrypt`, N=2^15, r=8, p=3, 16-byte salt, 64-byte key, `timingSafeEqual`; stored as `scrypt$N$r$p$salt$key`; out-of-bounds stored params rejected |
| Password policy  | 10–128 characters (NFKC-normalized)                                                                                                                           |
| Login errors     | Always "Email or password is incorrect."; unknown emails are checked against a dummy hash (timing)                                                            |
| Attempt limit    | 5 failures per email + IP per 15 minutes, **in memory** (resets on restart; one process). IP from the socket; `X-Forwarded-For` is ignored                    |
| Inactive users   | Cannot log in; existing sessions stop working immediately                                                                                                     |

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

- `.env*` and `.dev.vars` are git-ignored; `.env.example` (committed) lists `MONGODB_URI=` and
  `DB_HEALTHCHECK_ENABLED=` with **no values**.
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

- In-memory login limit; no account lockout persistence.
- No audit log of logins or product changes yet.
- No password reset; no employee accounts.
- Production cookie needs HTTPS; hosting, Atlas network access and backups are undecided.
- Driver-level writes (`Model.collection.*`, `bulkWrite`) bypass Mongoose hooks; app code does
  not use them for products (tests use them only to simulate bad data).
