# Architecture

_VERIFIED against the source on 2026-10-23 (updated 2026-10-24) unless marked otherwise._

## Stack

| Layer           | Technology (version from `package.json`)                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| Framework       | TanStack Start `1.168.60` (React `^19.2.0`, TanStack Router file routes, server functions) |
| Build           | Vite `8.1.5` via `@lovable.dev/vite-tanstack-config` `2.26.5`; Nitro server bundle         |
| Package manager | Bun (`bun.lock`; `bunfig.toml` refuses packages published < 24 h ago)                      |
| Database        | MongoDB (Atlas in real use) via Mongoose `9.11.3` (driver `mongodb` 7.7)                   |
| Validation      | Zod `^3.25.76`                                                                             |
| Tests           | Vitest `^4.1.10`, mongodb-memory-server `11.3.0`, playwright-core `1.64.1` (dev only)      |

**Runtime target: a Node.js server (Node LTS)**, not Cloudflare Workers. See
[decisions/0001-runtime-node-not-workers.md](decisions/0001-runtime-node-not-workers.md). The
hosting provider is not chosen; see [PROJECT_STATUS.md](PROJECT_STATUS.md).

Build target (Step 5b, VERIFIED 2026-10-28): `vite.config.ts` sets `nitro: { preset:
"node-server" }`, overriding the Lovable default `cloudflare-module`. The build writes
`.output/server/index.mjs` (plus traced dependencies in `.output/server/node_modules`) and
`.output/public`. Start it with `node .output/server/index.mjs`; it reads `PORT` (default 3000)
and `HOST`. **Without `HOST` it listens on all interfaces** (VERIFIED), so production must set
`HOST` (e.g. `127.0.0.1` behind a reverse proxy) or firewall the port. The `punycode/` alias in
`nitro.config.ts` was needed only for the former Workers target (historical; harmless; candidate
for removal), as is the Workers detection in `db.server.ts` and `client-address.server.ts`.

Vercel build (Step 5c, decision 0003, personal testing only; VERIFIED 2026-10-31 by a local
build of an isolated copy, NOT on Vercel): the preset comes from `nitroPreset()` in
`src/server/build-preset.server.ts`. `NITRO_PRESET=vercel`, or `VERCEL=1` (set by Vercel while
building), selects `vercel`. Any other `NITRO_PRESET` value fails the build, and the default is
`node-server`. The Vercel build writes `.vercel/output`:

- `config.json`, whose routes are, in order:
  1. the baseline security headers for `/(.*)` with `continue: true`, from
     `nitroSettings("vercel")` in `nitro.config.ts`;
  2. Nitro's `/assets/(.*)` immutable cache header;
  3. `handle: filesystem`;
  4. everything else → `/__server`.
- `static/`;
- `functions/__server.func`, the Node.js 24 function.

Vercel stops at the first matching route without `continue`, which is why the baseline is
emitted first and not as a route rule there (see decision 0003).

## Directory map

```
src/
  server.ts               Server entry: HTML error page fallback + security headers on every dynamic response
  start.ts                Request middleware: error handling, CSRF for server functions
  routes/                 File-based routes (TanStack Router). routeTree.gen.ts is GENERATED.
    __root.tsx            Root shell, head, error/not-found components
    index.tsx             Landing page: demo role cards + "Owner sign-in (real account)" link
    _shell.tsx            Demo layout (AppShell, simulated role switch)
    _shell.*.tsx          Demo screens (browser-only data)
    login.tsx             REAL owner sign-in            → /login
    owner.products.tsx    REAL product list, archive/restore → /owner/products (?view=archived)
    owner.products_.new.tsx REAL product creation       → /owner/products/new (trailing _ = not nested)
    owner.products_.$productId.edit.tsx REAL product edit → /owner/products/$productId/edit
    quick-sales.tsx       INTERIM staff Quick Sales page → /quick-sales (decision 0004)
    owner.today.tsx       INTERIM owner day view    → /owner/today (?date=YYYY-MM-DD)
    api.daily-summary.ts  INTERIM server route      → GET /api/daily-summary (bearer token, n8n)
    dev.auth.tsx          Dev-only auth diagnostic      → /dev/auth (only "Not available." in production)
    dev.db-health.tsx     Dev-only DB diagnostic        → /dev/db-health
  lib/                    Browser-importable code
    auth.ts               Server functions: login, logout, getCurrentUser; requireOwner middleware
    products.ts           Server functions: get/list/create/edit/archive/restore products (owner only)
    quick-sales.ts        INTERIM server functions: staff page, opening change, add, cancel; owner day view
    permissions.ts        INTERIM permission table (owner/staff, deny by default) for requirePermission
    bangkok-time.ts       Asia/Bangkok business day ("YYYY-MM-DD") and HH:mm, via Intl
    staff-guard.ts        INTERIM: redirects staff sessions from the demo to /quick-sales
    server-errors.ts      safeErrors middleware + toSafeError
    db-health.ts          getDatabaseHealth (dev-only diagnostic)
    money.ts              REAL backend money: integer satang parser, ฿1,800.00 display, pricing rule
    calc.ts               DEMO money/pricing rules (whole baht); not used by the real backend
    repository/           DEMO data layer (localStorage) — not the real backend
  server/                 SERVER-ONLY (*.server.ts; blocked from browser bundles)
    db.server.ts          Connection access (runtime MONGODB_URI, sanitized errors)
    health.server.ts      Health check core
    security-headers.server.ts Baseline security headers, no-store, opt-in HSTS
    products.server.ts    Product service (validation, create, reads)
    quick-sales.server.ts INTERIM Quick Sales service (opening change, sales, atomic own cancel, day totals)
    summary-api.server.ts INTERIM /api/daily-summary: fail-closed bearer token, rate limit, JSON
    models/               Mongoose models: product, user, session, login-attempt, quick-sale (opening_floats, quick_sales)
    auth/                 password (scrypt), auth core, login limiter (MongoDB), client address, cookie options, session-context (HTTP bridge)
    build-preset.server.ts Nitro preset for the build (node-server default, vercel for decision 0003)
  types/domain.ts         Shared domain types
  test/                   Vitest tests (see TESTING.md)
scripts/                  Local-only CLI scripts run with Bun by the owner
  create-owner.ts         bun run auth:create-owner
  create-staff.ts         bun run auth:create-staff (INTERIM Quick Sales staff accounts)
  setup-indexes.ts        bun run db:setup-indexes
```

## Demo vs real backend (critical separation)

|          | Demo                                                                      | Real backend                                                                                                             |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Routes   | `/`, `/_shell/*` screens (`/pos`, `/products`, `/sales`, …)               | `/login`, `/owner/products` (+ `/new`, `/$productId/edit`); interim `/quick-sales`, `/owner/today`, `/api/daily-summary` |
| Data     | `localStorage` (`src/lib/repository`, `src/data/demo-seed.ts`), fictional | MongoDB via `src/server/*`                                                                                               |
| "Roles"  | Simulated Owner/Employee switch; `<OwnerOnly>` is **UI-only**             | Real session cookie checked by `requireOwner` on the server                                                              |
| Security | None (any user can edit browser data)                                     | Server-enforced auth, validation, CSRF, unique indexes                                                                   |

The two never mix: real pages do not read demo data, demo screens do not call real server
functions, and choosing a demo role creates no session (tested in E2E).

## Server boundary

- `*.server.ts` files are blocked from browser imports by TanStack Start import protection.
- Server functions (`createServerFn`) are defined in `src/lib/*.ts` (browser-importable). Their
  handler bodies become RPC stubs in the client bundle; they load server-only modules with a
  dynamic `import()` inside the handler. A production-build scan in the E2E suite confirms no
  Mongoose, scrypt, `MONGODB_URI`, password-hash or session-cookie code reaches the browser.
- A server function is only bundled if something imports it (why `/dev/*` pages exist).

### Response headers

- VERIFIED 2026-10-25 in source, unit tests and E2E (dev server): every dynamic response (pages, `beforeLoad` redirects, 404s, server functions, CSRF 403s,
  error pages) leaves through `src/server.ts`, which copies it with `applySecurityHeaders`
  (`src/server/security-headers.server.ts`). `vite dev` uses the same entry. Headers and HSTS
  rules: [SECURITY.md](SECURITY.md#security-headers).
- Static files do **not** pass through it in dev: Vite serves `public/` and modules itself
  (VERIFIED in E2E: `favicon.ico` carries none of the security headers).
- On the production Node server, Nitro serves `.output/public` (favicon, `robots.txt`, hashed
  `/assets/*`) itself, before `src/server.ts`. The route rule
  `routeRules: { "/**": { headers: BASELINE_SECURITY_HEADERS } }` in `nitro.config.ts` adds the
  baseline to every response, static files included (dynamic responses still carry each header
  once). Hashed `/assets/*` keep Nitro's `Cache-Control: public, max-age=31536000, immutable`.
  VERIFIED 2026-10-28 by the E2E production-build test (starts the built server with `node`).
- _Historical (Workers target, decision 0001):_ on Cloudflare (NOT VERIFIED on a deployment; checked only in the installed Nitro source): the
  `cloudflare-module` handler sends public asset URLs to the `ASSETS` binding before the app,
  and Nitro writes a `wrangler.json` with that binding by default (`deployConfig` defaults to
  true). Cloudflare's documentation says it can also serve assets without running the Worker
  (NOT VERIFIED).
- _Historical (Workers target):_ static-file headers came from `public/_headers`, which Nitro merges into
  `.output/public/_headers` (VERIFIED in the E2E production build of the isolated copy). Whether
  Cloudflare applies it: NOT VERIFIED (needs a real deployment or `wrangler`).

### Server functions (VERIFIED)

| Function                 | Method | Middleware                                                           | Purpose                                                                        |
| ------------------------ | ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `login`                  | POST   | `safeErrors`                                                         | Verify credentials, set session cookie                                         |
| `logout`                 | POST   | `safeErrors`                                                         | Delete session, clear cookie                                                   |
| `signOutEverywhere`      | POST   | `safeErrors` + valid session                                         | Delete all of the user's sessions, clear cookie                                |
| `getCurrentUser`         | GET    | `safeErrors`                                                         | Name and role only, or `null`                                                  |
| `getProductForOwner`     | GET    | `safeErrors`, `requireOwner`                                         | One product **including cost** (used only by `/dev/auth`)                      |
| `listProductsForOwner`   | GET    | `safeErrors`, `requireOwner`                                         | Active products, **never cost**                                                |
| `createProductForOwner`  | POST   | `safeErrors`, `requireOwner`                                         | Create product; returns it **without cost**                                    |
| `getProductForEditing`   | GET    | `safeErrors`, `requireOwner`                                         | One product for the edit form, **without cost**                                |
| `updateProductForOwner`  | POST   | `safeErrors`, `requireOwner`                                         | Edit allowed fields; returns it **without cost**                               |
| `archiveProductForOwner` | POST   | `safeErrors`, `requireOwner`                                         | Set `active: false` (no delete exists)                                         |
| `restoreProductForOwner` | POST   | `safeErrors`, `requireOwner`                                         | Set `active: true`                                                             |
| `getDatabaseHealth`      | GET    | `safeErrors`                                                         | Dev-only status word                                                           |
| `getQuickSalesPage`      | GET    | `safeErrors`, `requirePermission("quickSales.useOwn")`               | INTERIM: today's opening change exists? + own entries of the last 10 min (≤ 5) |
| `recordOpeningFloat`     | POST   | `safeErrors`, `requirePermission("quickSales.recordOpeningFloat")`   | INTERIM: today's change money, once per business day                           |
| `addQuickSale`           | POST   | `safeErrors`, `requirePermission("quickSales.add")`                  | INTERIM: item text, amount text, `cash`/`qr`                                   |
| `cancelQuickSale`        | POST   | `safeErrors`, `requirePermission("quickSales.cancelOwn")`            | INTERIM: own sale, < 10 min, one atomic update                                 |
| `getDayForOwner`         | GET    | `safeErrors`, `requirePermission("quickSales.viewDay")` (owner only) | INTERIM: one day's totals, expected cash, every sale with staff name           |

`GET /api/daily-summary` is a **server route** (`server.handlers.GET`), not a server function:
no cookies, no CSRF middleware; bearer token only (see [SECURITY.md](SECURITY.md)).

## Authentication flow

1. Owner account created **locally** by the owner with `bun run auth:create-owner` (no web route).
2. `/login` → `login` server function → `auth.server.ts` verifies the scrypt hash, applies the
   attempt limits (client address from `client-address.server.ts`), creates a session (stores SHA-256 of a random token), and `session-context`
   sets the HttpOnly cookie.
3. Protected pages use `beforeLoad` → `getCurrentUser` to redirect signed-out visitors (cosmetic).
4. Every protected server function runs `requireOwner`, which re-reads the session **and** the
   user on each call (real enforcement).
5. `logout` deletes the session record and clears the cookie.

Details and parameters: [SECURITY.md](SECURITY.md).

## Database models (VERIFIED)

| Collection       | Model file                       | Key points                                                                                                                                                                                                                                                            |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | `models/user.server.ts`          | `role` enum is `owner`, `staff` (interim); `passwordHash` `select:false`; unique email; `single_owner` partial unique index                                                                                                                                           |
| `login_attempts` | `models/login-attempt.server.ts` | `_id` = `<kind>\|<key>`; `entries` (attempt id + time) inside the window; `expiresAt` with TTL index `login_attempt_expiry`; written only by atomic updates in `login-limiter.server.ts`                                                                              |
| `sessions`       | `models/session.server.ts`       | `_id` = SHA-256 of token; `expiresAt` with TTL cleanup index; `userId` index; optional `createdIp`, `userAgent` (≤ 256), `lastSeenAt`; at most 5 per user                                                                                                             |
| `opening_floats` | `models/quick-sale.server.ts`    | INTERIM: `_id` = Bangkok business day (one per day by the built-in unique `_id`), `amountSatang` ≥ 0, `userId`, `createdAt`                                                                                                                                           |
| `quick_sales`    | `models/quick-sale.server.ts`    | INTERIM: `itemText` (1–100), `amountSatang` > 0, `payment` `cash`/`qr`, `userId`, server-set `createdAt` and `businessDay`, `cancelled`, `cancelledAt`; no secondary indexes; kept 5 years                                                                            |
| `products`       | `models/product.server.ts`       | Integer-satang money (`priceSatang`, per-product `minimumSellingPriceSatang`, `costSatang` `select:false`, each ≤ ฿10,000,000.00); embedded variants (`sku`, `barcode`, `openingStock`, `stock`); optimistic concurrency; query updates touching pricing are rejected |

Product indexes (case-insensitive collation `{ locale: "en", strength: 2 }`, all unique):
`product_sku_unique_ci`, `variant_sku_unique_ci`, `variant_barcode_unique_ci` (partial). They
are created **only** by `bun run db:setup-indexes`; requests never create indexes.

## Money

**All money is integer satang; never floats.**

- Fields carry the unit in their name (`priceSatang`, `minimumSellingPriceSatang`,
  `costSatang`), so values stored before 2026-11-01 (whole baht in `price`,
  `minimumSellingPrice`, `cost`) can never be read as satang. The strict schemas reject the old
  names. `bun run db:migrate-money-satang` (owner-run; dry run by default, `--apply` to write)
  converts them ×100 and removes the old fields, idempotently.
- Input: the owner forms parse the typed string ("1800", "1,800", "1800.50") with
  `parseBahtToSatang` (string and integer operations only; at most 2 decimals; no negatives;
  at most ฿10,000,000.00). The server re-checks every amount with `productPricingErrorSatang`
  (whole satang, bounds, minimum ≤ price) and the Mongoose schema.
- Display: `formatSatang`, always two decimals (`฿1,800.00`, `฿1,800.50`).
- The demo (`src/lib/calc.ts`, `src/types/domain.ts`) keeps whole baht in the browser only.
- Interim Quick Sales (decision 0004): the browser sends the typed text (`amountText`) and the
  **server** parses it with `parseBahtToSatang`; stored as `amountSatang`; totals are integer sums.

## Data flow: interim Quick Sales (decision 0004)

`/login` (staff) → `/quick-sales` → `getQuickSalesPage` → `recordOpeningFloat` (until today's
exists) → `addQuickSale` / `cancelQuickSale` (each: POST, CSRF, `safeErrors` →
`requirePermission` → `createQuickSalesService(conn)`, user from the session, time and business
day from the server clock). `/owner/today` → `getDayForOwner`. n8n → `GET /api/daily-summary` →
`handleDailySummary` (token check, `summary_api` limiter, `daySummary`). The business day is the
calendar date in `Asia/Bangkok` (`src/lib/bangkok-time.ts`); it changes at midnight Bangkok
time.

## Data flow: creating a product

Browser form (`/owner/products/new`) → `createProductForOwner` (POST; CSRF check;
`safeErrors` → `requireOwner`) → `createProductService(conn).createProduct(input)`:
Zod strict parse (normalizes SKU/barcode, rejects unknown/stock fields) → `productPricingErrorSatang`
→ `verifyProductIndexes` (fail closed) → Mongoose `create` (schema validation; unique indexes
decide duplicates, including concurrent ones) → cost-free `PublicProduct` returned.

## Data flow: editing and archiving a product

Edit form (`/owner/products/$productId/edit`, loaded with `getProductForEditing`, no cost) →
`updateProductForOwner` (POST; CSRF; `safeErrors` → `requireOwner`) →
`updateProduct(id, update)`: id check → Zod strict parse (only name, category, description,
price, minimum, cost/`null`, image URL, threshold) → `productPricingError` on the combined values
→ `save()` with optimistic concurrency (overlapping saves fail with "changed at the same time").
Archive/Restore → `archiveProductForOwner`/`restoreProductForOwner` → `setProductActive`.
The list's default filter `{ active: true }` lives in `listProducts`.

## Router data after mutations

Convention (2026-10-28): **after any server mutation, invalidate affected router data before or
during navigation; owner pages use blocking reload so they never render stale data.**

- Why: the router caches a page's loader data when you leave it (`defaultPreloadStaleTime: 0`
  in `src/router.tsx` marks it stale at once), and by default a stale cached match renders its
  old data first and reloads in the background.
- `/owner/products` sets `staleReloadMode: "blocking"` on its loader, so returning to it waits
  for fresh data (its pending state shows after 200 ms).
- The edit page (blocking loader) calls `router.invalidate()` after a save, then navigates to the
  list; archive/restore on the list call `router.invalidate()` and finish only once the fresh
  list has loaded (VERIFIED 2026-10-31, E2E).
- Current gap (VERIFIED 2026-10-28): `/owner/products/new` awaits `createProductForOwner` and
  then calls `navigate({ to: "/owner/products" })` without `router.invalidate()`; the list is
  fresh only because of the blocking loader. New owner pages need both.

## Connection behavior

`db.server.ts` reads `MONGODB_URI` at call time. On Node.js one connection is shared per
process (the production runtime). On Cloudflare Workers each call would open and destroy its own
connection: that code path remains but is historical (decision 0001; Step 4 confirmed that
workerd cannot reuse a connection across requests).
Options: small pool, `serverSelectionTimeoutMS` 5000, `bufferCommands: false`,
`autoIndex: false`, `autoCreate: false`. Errors become `DatabaseUnavailableError` with no
connection details.
