# Security

_VERIFIED against the source and tests on 2026-10-23 (updated 2026-10-24; interim Quick Sales 2026-11-01) unless marked otherwise._
The prohibited-actions list in [../AGENTS.md](../AGENTS.md) applies to every task.

## Threat boundaries

- **The demo is not secure and never will be.** Its roles (`repo.setDemoRole`, `<OwnerOnly>`)
  and data live in the browser; anyone can change them. Never use demo state for access control.
- **The demo is OFF by default in production builds** (`DEMO_ENABLED`, read on the server in
  `src/server/demo-setting.server.ts`; `"true"` turns it on, `"false"` off; unset means OFF in
  production, ON in `vite dev` and tests; an unreadable environment means OFF). When OFF, `/`
  shows only **Sign in** and every demo screen (`_shell`) redirects to `/login`; any failure to
  read the setting in the browser also counts as OFF. This keeps staff and customers away from
  fictional data; it is not access control (the demo has no real data). Leave it unset in
  production (E2E: built server OFF by default, ON with `DEMO_ENABLED=true`; mutation-checked).
- **Real protections exist only on the server**: TanStack Start server functions plus MongoDB.
  Route guards (`beforeLoad` redirects) are convenience only; `requireOwner` is the enforcement.
- Hosting is not set up. Everything below is verified locally with an isolated database.
- **Production target: a Node.js server** (decision
  [0001](decisions/0001-runtime-node-not-workers.md)). Statements about Cloudflare Workers below
  are **historical**: kept for the record, not a deployment target.
- **Vercel (Hobby) is allowed for the owner's personal, non-commercial testing only** (decision
  [0003](decisions/0003-vercel-for-personal-testing.md), checklist
  [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)). Not deployed by agents; nothing about it is verified on
  a real deployment.

## Authentication

| Item             | Implementation                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts         | One owner (`users.role` enum is `["owner", "staff"]`); DB index `single_owner` allows only one owner. `staff` is the INTERIM Quick Sales role (decision 0004), see below                                                                   |
| Owner creation   | **Local only**: `bun run auth:create-owner` (hidden password prompt; refuses if an owner exists). No public registration route or server function exists.                                                                                  |
| Password hashing | Node `crypto.scrypt`, N=2^15, r=8, p=3, 16-byte salt, 64-byte key, `timingSafeEqual`; stored as `scrypt$N$r$p$salt$key`; out-of-bounds stored params rejected                                                                              |
| Password policy  | 10–128 characters (NFKC-normalized)                                                                                                                                                                                                        |
| Login errors     | Always "Email or password is incorrect."; unknown emails are checked against a dummy hash (timing)                                                                                                                                         |
| Attempt limit    | Three limits stored in **MongoDB** (`login_attempts`; survive restarts, shared by all instances), all per 15 minutes: **5 per email + address**, **20 per address across all emails** and **50 per email across all addresses**. See below |
| Hash concurrency | At most **2** scrypt derivations at once (≈64 MiB) and **8** waiting, per process; beyond that login answers "Too many attempts" without hashing                                                                                           |
| Inactive users   | Cannot log in; existing sessions stop working immediately                                                                                                                                                                                  |

### Login attempt limits (`src/server/auth/auth.server.ts`, `login-limiter.server.ts`, VERIFIED 2026-10-24, updated 2026-10-27 and 2026-10-31)

- **Address** (`src/server/auth/client-address.server.ts`, 2026-10-27; Vercel 2026-10-31):
  - **On Vercel** (detected by the runtime environment variable `VERCEL=1`, which Vercel sets
    for its functions; never by request data): only the **first entry** of
    `x-vercel-forwarded-for`, which Vercel's edge sets to the visitor's address. That entry must
    be a valid IP address, or there is no address; later entries are never consulted. The
    socket address (Vercel's proxy, shared by everyone) is never used there. That Vercel's edge
    overwrites a client-sent value is Vercel's documented behaviour, **NOT VERIFIED** on a
    deployment (smoke test in [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)). Unit-tested with a
    simulated `VERCEL=1`.
  - _Historical (Workers target, decision 0001):_ **on Cloudflare Workers** (detected by
    `navigator.userAgent === "Cloudflare-Workers"`, a property of the runtime that requests
    cannot change): `CF-Connecting-IP`, which Cloudflare's edge sets and overwrites. Step 4
    (local workerd, 2026-10-28) confirmed the detection, but local `wrangler dev` passes a
    client's own `CF-Connecting-IP` through (a spoofed value bypassed the limit locally); the
    edge overwrite is NOT VERIFIED. The code path remains (candidate for removal).
  - **Everywhere else, including the production Node.js server** (Node.js, Bun, `vite dev`):
    the socket address from `getRequestIP()`
    (no options, so `X-Forwarded-For` is not read; srvx trusts no proxy by default). Every
    header is ignored, including `x-vercel-forwarded-for`, `CF-Connecting-IP`,
    `X-Forwarded-For` and `X-Real-IP` (unit- and E2E-tested). There is **no setting** to trust
    proxy headers.
  - A value that is not an IPv4/IPv6 address counts as **no address**. There is never a shared
    fallback key (the old `"unknown"` fallback is gone).
  - IPv6 is counted per **/64** (one user usually controls a whole /64); IPv4-mapped IPv6 counts
    as its IPv4 address.
- **No address known**: the per-address and per-email + address limits are skipped; only the
  per-email (account) limit applies. One unknown-address client therefore cannot lock out
  another (unit-tested).
- **Per-email (account) limit, 50 per 15 minutes**: keyed on the normalized email (trimmed,
  lower-case), counted for emails with no account exactly as for real ones (same responses, so
  it reveals nothing). Same limiter as the others.
  **Tradeoff:** any per-account limit lets an attacker block that account. A fixed threshold
  well above the address limit was chosen over progressive backoff (simpler, same race-safe
  counting): one address adds at most 5 per email, so blocking the owner needs **at least 10
  different addresses** (IPv6: /64s) within 15 minutes, and the block ends 15 minutes after the
  attack stops. In return a botnet gets at most 50 password checks per 15 minutes on the owner
  account (before: unlimited across addresses).
- **Storage (2026-10-31)**: collection `login_attempts`, one document per limit key
  (`address|…`, `email_address|…|…`, `account|…`) holding the attempts inside the window.
  - **Shared and persistent**: the counts live in the database, so they survive restarts and hold
    across all server instances (two limiter instances on one database are unit-tested).
  - **Counted before hashing, atomically**: each limit is checked and counted in **one atomic
    single-document update** (update pipeline with upsert): attempts older than the window are
    dropped and this attempt is recorded only if fewer than the limit remain. Simultaneous
    requests cannot all pass, on one instance or many (30 at once → exactly 5 password checks;
    50 at once on a new key → exactly the limit).
  - The limits are taken in order (address, email + address, account). If a later one refuses,
    the earlier counts are undone, each by its own random attempt id, so a simultaneous attempt
    is never removed by mistake. Between counting and undoing, a concurrent request may briefly
    see the higher count and be refused (the safe direction).
  - **TTL cleanup**: `expiresAt` = newest attempt + window; the TTL index
    `login_attempt_expiry` (created by `db:setup-indexes`) deletes a document once all its
    attempts have expired (MongoDB's monitor runs about once a minute). Expiry is also applied
    inside every update, so limits stay correct before cleanup runs or without the index (then
    documents are only never deleted).
  - **Fail closed**: if the counters cannot be read or written, login is refused with the
    generic "Database unavailable." and **no password is checked**. Undoing a count is best
    effort: if it fails, the attempt stays counted.
  - **Tradeoff**: an outage of the counters blocks every login, even with the right password.
    Login needs the same database for the user and the session anyway, so this adds little.
    Failing open would allow unlimited guessing exactly when the database is degraded.
    Cost: 3–5 small extra writes per login.
  - Keys contain the normalized email and the client address (personal data), kept only for the
    window plus the TTL delay and never logged.
- **Wrong password, unknown email, inactive account**: stays counted in all limits.
- **Correct password**: clears the per-email + address count and does not count against the
  address or the account (failures by others stay counted, so signing in does not reset an
  attacker's count).
- **No verdict** (user lookup or hashing fails after counting, or hashing busy): un-counted in
  all limits, so an outage or overload does not lock the owner out later. Hashing busy answers "Too many attempts. Try again
  later."; a database error answers "Database unavailable.".
- **Effect of an attack**: one address gets at most 20 password checks per 15 minutes in total
  and 5 per email; all addresses together get at most 50 per email. The owner signing in from a **different** address is unaffected; from the
  attacking address they must wait for the window to pass.
- The hashing limit releases its slot in `finally`, so failed derivations never leak a slot.

## Sessions and cookies

- Random 32-byte token in the cookie; MongoDB stores only its **SHA-256 hash** (`sessions._id`).
- Fixed lifetime **7 days** from login; expiry checked in code on every request (TTL index only
  cleans up). The user record is re-read on every request.
- Logout deletes the session and clears the cookie (also cleared if the DB is unreachable; the
  database record then stays valid until it expires).

### Session lifecycle (`src/server/auth/auth.server.ts`, VERIFIED 2026-10-28)

1. **Login** creates a new session (new random token; the client never chooses an id) storing
   `userId`, `expiresAt` (login + 7 days), `createdIp` (the login client address from
   `client-address.server.ts`, or `null`), `userAgent` (truncated to 256 characters; not stored
   if missing) and `lastSeenAt`.
2. Then, **after** the new session exists: the session whose cookie was presented at login (any
   user's) is deleted, and the user's sessions are trimmed to the **newest 5** (by expiry; the
   new one is always kept). The cap is **soft** under simultaneous logins: each login trims only
   what it can see, so the count can briefly exceed 5 and settles once they finish.
3. **Every request** re-reads the session and user; expired sessions are refused and deleted.
   `lastSeenAt` is written at most **once every 5 minutes** per session, not per request. There
   is **no idle timeout** yet (Step 7b).
4. **Logout** deletes this session. **"Sign out everywhere"** (`signOutEverywhere`, POST, on the
   signed-in card of `/login`) requires a valid session, deletes **every** session of that user
   (`revokeAllSessions`, `deleteMany` on the indexed `userId`), clears the cookie and returns to
   `/login`. On a database error nothing is revoked and the cookie is kept, so the user can retry.
5. **Expiry cleanup:** the TTL index on `expiresAt` deletes expired records (created by
   `bun run db:setup-indexes` / `auth:create-owner`; run it on every deploy, see
   [ROADMAP.md](ROADMAP.md)).

Sessions created before 2026-10-28 have none of the new fields; they keep working and get
`lastSeenAt` on first use (no migration; unit-tested).

**Personal data (Thailand PDPA):** the login IP address and browser User-Agent are stored on the
session only for account security (spotting unfamiliar sessions, revocation, a later idle
timeout). They are never logged or shown to other users, are not used for anything else, and are
deleted together with the session: on logout, "sign out everywhere", the 5-session cap, or by
the TTL index when the session expires (at most 7 days after login).

- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`. Production: name `__Host-luxe_session`, `Secure`
  (requires HTTPS). Local dev (`http://127.0.0.1`): `luxe_session`, not `Secure`. Decided at
  build time (`import.meta.env.PROD`).
- No session secret exists (nothing to configure); passwords and tokens are never stored in
  `localStorage`/`sessionStorage` (E2E-tested).

## Authorization

- **INTERIM Quick Sales** (decision 0004) uses `requirePermission(<permission>)` instead; see
  [Interim Quick Sales](#interim-quick-sales-staff-role-and-api-token-decision-0004).
- `requireOwner` (in `src/lib/auth.ts`) must be on every sensitive server function, **after**
  `safeErrors`: `.middleware([safeErrors, requireOwner])`. It throws "Not signed in." /
  "Not allowed.".
- Currently protected: `getProductForOwner`, `listProductsForOwner`, `createProductForOwner`,
  `getProductForEditing`, `updateProductForOwner`, `archiveProductForOwner`,
  `restoreProductForOwner` (unit- and E2E-tested, mutation-checked 2026-10-31).
  `signOutEverywhere` needs any valid session (not owner-only) and acts only on that user.
- Product **cost** is owner-only: `select: false` in the schema; public mappers build results
  field by field; only `getProductForOwner` returns cost. The `/owner/products` pages never
  request or show cost; create and edit responses never contain it, and the edit form never loads
  it (E2E-checked with distinctive values). Products are archived, never deleted (no delete
  server function exists; unit-tested).

## Interim Quick Sales: staff role and API token (decision 0004)

_VERIFIED 2026-11-01 in source, unit tests (`quick-sales.test.ts`,
`quick-sales-server-fns.test.ts`, `summary-api.test.ts`) and E2E. Temporary: retires when slice
S9 of decision 0002 lands._

**Staff role**

- `users.role` allows `staff`. Staff accounts are created only by the owner on their own computer
  with `bun run auth:create-staff` (hidden password prompt, same password policy and scrypt hash
  as the owner, refuses an existing email). There is no web route or server function for it.
- Staff sign in at `/login` with email and password (same limits, sessions and cookie as the
  owner) and are always sent to `/quick-sales`: after signing in, and whenever they open
  `/login`, `/`, any demo screen or any `/owner` page.
- **Permission table** (`src/lib/permissions.ts`), checked by `requirePermission` on every call
  (session and user re-read, like `requireOwner`). **Deny by default**: an unknown role or a
  permission not listed is refused with "Not allowed.".

  | Permission                      | owner | staff |
  | ------------------------------- | ----- | ----- |
  | `quickSales.useOwn`             | yes   | yes   |
  | `quickSales.recordOpeningFloat` | yes   | yes   |
  | `quickSales.add`                | yes   | yes   |
  | `quickSales.cancelOwn`          | yes   | yes   |
  | `quickSales.viewDay`            | yes   | no    |

- Every product server function keeps `requireOwner`, which refuses every role except `owner`:
  staff get "Not allowed." from all seven (unit-tested and E2E-replayed with a staff cookie).
- **Staff responses never contain totals, other people's sales, user ids or names.** The staff
  page's data is built field by field (`toStaffSale`) from the caller's own sales only (query
  filter `userId` from the session). Leak tests use distinctive values for other users' sales
  and the day's totals.
- The user, the time and the Bangkok business day are always set by the server. Inputs with any
  other field (`userId`, `businessDay`, `createdAt`, `cancelled`, …) are refused (Zod
  `.strict()`). Amounts are parsed on the server from the typed text (`parseBahtToSatang`).
- **Cancel** is one atomic `findOneAndUpdate` whose filter requires: this id, this user, not
  cancelled, created less than 10 minutes ago. Someone else's sale, an old one, an unknown id
  and an already cancelled one all get the same message ("This sale can no longer be
  cancelled."), so nothing is revealed.
- **Opening change money**: `_id` is the business day, so MongoDB's own unique `_id` refuses a
  second one, also under simultaneous requests (unit-tested with 5 at once).
- Staff are kept out of the browser demo by a redirect on `/` and the demo layout
  (`src/lib/staff-guard.ts`). It fails closed (to `/quick-sales`) if the session cannot be
  checked. This is navigation, not access control: the demo has no real data.
- A staff account is disabled by setting `active: false` in the database (no page yet); its
  sessions stop working immediately.

**`GET /api/daily-summary` (for n8n, later)**

- Authorization is **only** `Authorization: Bearer <SUMMARY_API_TOKEN>`. Cookies and sessions are
  never read (a signed-in owner without the token gets 401; source-checked).
- **Fails closed**: if `SUMMARY_API_TOKEN` is missing, not a string or shorter than 32
  characters, every request gets 503 "Not configured." without touching the database.
- **Constant-time comparison**: SHA-256 of both values, compared with `timingSafeEqual` (equal
  32-byte digests, so neither content nor length leaks through timing).
- **Rate limit on failures**: every attempt is counted before the comparison, atomically, in the
  existing MongoDB limiter (`login_attempts`, kind `summary_api`, own keys). A correct token
  un-counts its attempt, so only failures accumulate: **10 per 15 minutes per client address**
  (IPv4, or IPv6 /64, address as for login). Then 429 for that address, the correct token
  included, until the window passes. Requests without a known address share one key. Limiter or
  database errors answer 503 (fail closed).
- It is a server route, not a server function: the CSRF middleware does not apply. It is `GET`,
  changes nothing except the attempt counters, and needs the token. Responses carry the security
  headers and `Cache-Control: no-store` (E2E-checked) and never echo the token.
- Generate the token with `openssl rand -base64 32` (44 characters). Set it only in the host's
  environment (Vercel: **Production only, Sensitive**). Never commit it; `.env.example` lists the
  name with no value.

## CSRF and request safety

- `src/start.ts` applies `createCsrfMiddleware` to all server functions
  (`handlerType === "serverFn"`): requests must be same-origin by `Sec-Fetch-Site`, `Origin`,
  or `Referer`; requests with none of these are rejected (403). Never set
  `allowRequestsWithoutOriginCheck`.
- State-changing server functions use `POST` (`login`, `logout`, `signOutEverywhere`,
  `createProductForOwner`, `updateProductForOwner`, `archiveProductForOwner`,
  `restoreProductForOwner`, and the interim `recordOpeningFloat`, `addQuickSale`,
  `cancelQuickSale`).
- Forms use `method="post"` and keep their submit button disabled until React hydrates, so a
  native submit can never put values (e.g. passwords) into a URL.
- `/login?redirect=` accepts **only** `/owner/products`; anything else is dropped (no open redirect).

## Security headers

_VERIFIED 2026-10-25 in source and unit tests (`security-headers.test.ts`); E2E coverage
(dev server over `http`, `auth.e2e.test.ts`) is listed separately below._

- **Verified by E2E** (exact values): the five baseline headers and `Cache-Control: no-store` on
  pages, 404s, signed-out redirects, signed-in owner pages, owner server functions, a CSRF 403
  and the database-down owner page; **no** HSTS over `http`; static `favicon.ico` bypasses
  `src/server.ts` (none of the headers). The **built Node server** (E2E production-build test,
  started with `node`): baseline + `no-store` on `/login`; baseline on `favicon.ico` and a hashed
  `/assets/*` file (which keeps `public, max-age=31536000, immutable`); `/_headers` is 404.
- **Unit tests only** (not E2E): **HSTS** (production + `https:` + setting; parsing; removal),
  keeping `Cache-Control` on hashed `/assets/*` responses, `no-store` for other path spellings,
  copying redirects / `Set-Cookie` / streamed bodies, both error-page paths in `src/server.ts`
  (mocked entry), an unreadable environment, and the `nitro.config.ts` route rule holding exactly
  the baseline.
- _Historical (Workers target):_ Cloudflare applying `public/_headers`, reading
  `SECURITY_HSTS_MAX_AGE` on Workers and the request URL scheme on Workers were never verified on
  a deployment; Step 4 saw all three work under local workerd.

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
- Static files get the same baseline (without `no-store` or HSTS) from the route rule in
  `nitro.config.ts`, which imports the server constants (one source of truth; a unit test checks
  it). `public/_headers` (Cloudflare-only) was removed in Step 5b; the Node server would have
  served it as a public file.
- **HSTS** (unit-tested only; E2E runs over `http`) is sent only when all three hold: a production build (`import.meta.env.PROD`), the
  request URL is `https:`, and the server setting `SECURITY_HSTS_MAX_AGE` is a whole number of
  seconds from 1 to 63072000. Anything else, including an unreadable environment, means off;
  reading the setting never throws. Otherwise any HSTS header is removed. No
  `includeSubDomains`/`preload`. Owner rollout after HTTPS on the real domain is verified:
  300 → 86400 → 31536000. Removing the setting does not clear what browsers already stored; to
  back out, set a small value (e.g. `1`) so returning HTTPS visits replace it. Reading the
  setting on Workers via `process.env` was only checked under local workerd (historical).
- **Behind a TLS-terminating proxy** that forwards plain `http` to the app (the likely setup for
  the Node.js server: reverse proxy, load balancer, Cloudflare proxy or Tunnel), the request URL
  is `http:`, so HSTS is **never** sent, even with the setting. This fails safe; enabling HSTS
  there needs trusted-proxy handling (not built; required before any real deployment, see
  [ROADMAP.md](ROADMAP.md)) or HSTS set at the proxy.
- A full Content-Security-Policy (scripts/styles) is **not** set: the hydration scripts, the
  error page's inline style and `onclick`, and Google Fonts would need nonces or allowlists.
- A future camera barcode scanner needs `camera=(self)` in the constant (static files follow it).

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
- **All money is integer satang; never floats** (`priceSatang`, `minimumSellingPriceSatang`,
  `costSatang`). `productPricingErrorSatang`, run on the server for every write:
  - every amount is a whole number of satang, at most ฿10,000,000.00;
  - price ≥ 1 satang, minimum ≥ 0 and ≤ price, cost ≥ 0.

  The browser's parse is a convenience; nothing from the client is trusted. The old whole-baht
  field names are rejected as unknown keys. **Each product has its own minimum; there is no
  universal minimum price.**

- SKU: trim → upper-case → `^[A-Z0-9._-]{1,64}$`. Barcode: trim → upper-case → `^[A-Z0-9]{4,64}$`.
  Invalid characters are rejected, never stripped (different codes are never merged).
- Pricing fields can only change through document `save()`; query-style updates touching
  `price`/`minimumSellingPrice`/`cost` throw. Concurrent edits use optimistic concurrency
  (overlapping saves are refused); an edit form opened before another save is not detected (the
  later save wins). Edits cannot change SKU, variants, stock, `active` or ids (rejected as unknown
  keys).

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
  `DB_HEALTHCHECK_ENABLED=`, `SECURITY_HSTS_MAX_AGE=` and `SUMMARY_API_TOKEN=` with **no values**.
- `SUMMARY_API_TOKEN` is read only in `src/server/summary-api.server.ts`, at call time, and never
  logged.
- Never prefix secrets with `VITE_` — the build config exposes `VITE_*` values to the browser.
- In application code, `MONGODB_URI` is read only in `src/server/db.server.ts` at call time and
  never logged. The opt-in `test:db` test (`db.integration.test.ts`) also reads it from the
  environment or `.env`. Other tests load no `.env` (`envDir: false`, see TESTING.md).
- Production secrets would be set in the host's secret store (not configured yet).

## Development access

- `vite.config.ts` binds the dev server to `127.0.0.1` (overriding the Lovable default `::`), so
  server functions are not reachable from the local network. E2E verifies `::1` and the LAN
  address are refused.
- The **production** Node server (`node .output/server/index.mjs`) listens on **all interfaces**
  unless `HOST` is set (VERIFIED 2026-10-28). Set `HOST` (e.g. `127.0.0.1` behind a reverse
  proxy) or firewall the port.
- `/dev/db-health` and `/dev/auth` are diagnostics: unlinked and `noindex`. In production builds
  `/dev/auth` renders only "Not available."; `/dev/db-health` still renders, but its server
  function returns `disabled` unless `DB_HEALTHCHECK_ENABLED=true` is set on the server.

## Known security limitations (open)

- Login limits are shared in MongoDB (2026-10-31). The **hashing bound** (2 at once, 8 waiting)
  is still in memory, per process or instance.
- **Vercel test deployment (decision 0003), accepted risks:**
  - **Atlas network access is `0.0.0.0/0`** (Vercel has no fixed outgoing IP), so the database
    is protected only by its credentials and TLS. Hence: test data only, a dedicated user with
    `readWrite` on the app database only, and a long random password used nowhere else. Rotate
    or delete that user when testing ends.
  - The Hobby plan is for personal, non-commercial use only.
  - On a real Vercel deployment, these are NOT VERIFIED (smoke test in
    [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)):
    - the Vercel routing of static-file headers;
    - possible doubled headers on pages;
    - the request URL scheme (HSTS);
    - the `x-vercel-forwarded-for` overwrite.
- **Required before any real deployment — trusted-proxy handling:** behind a reverse proxy, load
  balancer, Cloudflare proxy or Cloudflare Tunnel, the socket address is the proxy's, so all
  visitors share one address and the per-address limit (20 per 15 minutes) becomes a **global
  lockout**. Trusted-proxy handling is not built (no setting exists); its design depends on the
  hosting choice and needs its own approved step.
- _Historical (Workers target):_ client address on Cloudflare Workers (`CF-Connecting-IP`) was
  never verified on a deployment; locally a client-supplied value was passed through (Step 4).
- The per-account limit (50 per 15 minutes) lets attackers with at least 10 addresses block the
  owner's login while the attack lasts. Without an address, an attacker can also push the
  owner's count out of the 10 000-key cap by flooding other emails (bounded by the hashing
  limit), regaining part of the allowance.
- An attacker who keeps the hashing limit full makes every login answer "Too many attempts"
  until the attack stops (resources stay bounded; availability does not).
- Every login request, including throttled ones, opens the database connection first
  (`withDatabase` wraps the whole login); on the Node.js server it reuses the shared connection
  (on Workers it would have been one connection per request; historical).
- No full Content-Security-Policy (only `frame-ancestors`); HSTS not enabled anywhere yet.
- No audit log of logins or product changes yet.
- No password reset; no employee accounts (0002). The interim `staff` accounts (decision 0004)
  have no disable page, no audit log and normal 7-day sessions.
- Quick Sales item text is free text typed by staff; totals are only as good as what is typed.
- Production cookie needs HTTPS; hosting, Atlas network access and backups are undecided.
- Driver-level writes (`Model.collection.*`, `bulkWrite`) bypass Mongoose hooks; app code does
  not use them for products (tests use them only to simulate bad data).
