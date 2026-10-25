# Changelog

Dated record of completed work, decisions, test evidence and corrections. Newest first.
Commit hashes refer to this repository. Each heading names the commit that contains the work;
"uncommitted" would mean it exists only in the working tree (see [PROJECT_STATUS.md](PROJECT_STATUS.md)).

## 2026-10-24/25 — Baseline security headers (uncommitted, awaiting owner review)

- `src/server/security-headers.server.ts` (new) + `src/server.ts`: every dynamic response
  (pages, redirects, 404s, server functions, CSRF 403s, both error-page paths) gets
  `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` (only),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a
  restrictive `Permissions-Policy`, and `Cache-Control: no-store`. The response is copied
  (redirect headers are immutable); body, status and all `Set-Cookie` are kept.
- Owner decisions: `no-store` on all dynamic responses (not a path list); HSTS through the
  runtime setting `SECURITY_HSTS_MAX_AGE`, off by default, sent only by production builds on
  `https:` requests; added to `.env.example` with no value (`.env` not read or changed).
- `public/_headers` (new): same baseline for static files in Cloudflare `_headers` format; Nitro
  merges it into `.output/public/_headers` (E2E-checked). Cloudflare applying it: NOT VERIFIED.
- Tests: `src/test/security-headers.test.ts` (28 tests); E2E header checks on `/`, `/login`,
  `/dev/auth`, a 404, signed-out redirects for both owner pages, signed-in `/owner/products`,
  owner server functions, a CSRF 403, the database-down owner page, static `favicon.ico` not
  `no-store`, and the build's `_headers`.
- Mutation tests (each applied → test failed for the expected reason → restored byte-identical →
  control passed): X-Frame-Options removed (unit + E2E); frame-ancestors removed; catch branch
  unsecured; normal/swallowed-error path unsecured (unit + E2E); `no-store` removed (unit + E2E
  CSRF 403); HSTS without the https check; a line removed from `public/_headers`; headers changed
  in place instead of copied (redirect throws "immutable"). Correction: the first M5 E2E run used
  the filter `-t CSRF`, which also selected a test depending on earlier setup, so its control
  failed too; redone with the sign-in test plus the exact CSRF test name.
- Pre-commit review fixes (2026-10-25): `securityHeaderOptions` never throws (the environment
  reader is injectable; an unreadable environment keeps HSTS off), so the error-page path cannot
  fail on it; E2E now checks the exact `Permissions-Policy` value and that `favicon.ico` carries
  none of the security headers (proves static files bypass `src/server.ts` in dev); docs mark the
  Cloudflare asset path as NOT VERIFIED separately from what is verified, and note that HSTS is
  never sent behind a TLS-terminating proxy that forwards plain http.
- Mutation tests rerun 2026-10-25 after the fixes, all ten failing for the expected reason,
  restored byte-identical (SHA-256) and passing their control: the eight above, plus the setting
  read allowed to throw (`ReferenceError: process is not defined`) and a `Permissions-Policy`
  entry removed from both the constant and `public/_headers` (unit + E2E exact-value check).
- Results (2026-10-25): `tsc` exit 0; lint 0 errors / 11 warnings; `bun run test` 203 passed,
  0 failed, 37 skipped; `bun run test:e2e` 35 passed, 0 failed, 1 skipped (one earlier full run
  that day failed in setup with every test skipped; the error was not captured and it did not
  recur in two further full runs); nothing left running.

## 2026-10-24 — Login hardening (commit `fix: harden login rate limiting and password hashing`, local, not pushed)

- Fixes the audit's High finding: simultaneous wrong passwords all reached scrypt (30 of 30),
  because the limit was checked before hashing but failures were recorded after.
- `auth.server.ts`: `tryAttempt` checks and counts in one synchronous step before any `await`;
  new **per-address limit of 20 attempts / 15 min across all emails** (`LOGIN_ADDRESS_LIMIT`),
  applied together with the existing 5 per email + address; `loginAddressKey` counts IPv6 per
  /64 and IPv4-mapped IPv6 as IPv4. Attempts without a verdict (database error, hashing busy)
  are un-counted in both limits; a correct password does not count against the address.
- `password.server.ts`: every scrypt derivation goes through `createConcurrencyLimit` (2 at
  once, 8 waiting, the rest refused with `PasswordHashingBusyError` → "Too many attempts");
  slots are released in `finally`; a failed dummy-hash creation is not cached.
- The atomic counting and hashing bound already existed uncommitted at the start of this task
  (author not recorded); they were reviewed and kept. Added this session: the per-address
  limit, IPv6 /64 grouping, database-down test, per-test limiter injection, 60 s timeouts for
  the slow limit tests.
- Mutation tests (each removed → targeted test failed → restored byte-identical → control passed):
  atomic per-email counting; hashing bound; slot release on failure; per-email un-count without
  verdict; per-address limit; atomic per-address counting; address un-count when the per-email
  limit refuses; address un-count without verdict; correct password not counted; IPv6 /64.
- Results: `tsc` exit 0; lint 0 errors / 11 warnings; `bun run test` 175 passed, 0 failed,
  36 skipped; `bun run test:e2e` 34 passed, 0 failed, 1 skipped; nothing left running.

## 2026-10-24 — Foundation work committed (local, not pushed)

- `ced5535` `feat: add secure owner authentication and product management foundation` (28 files):
  product model/service and Backend Steps 2a–3b, with their tests.
- `4da3c13` `docs: add AI agent handbook and harden test isolation` (10 files): `AGENTS.md`,
  `docs/`, `envDir: false`, `safeErrors` on `getDatabaseHealth`, new source check.
- Staged by explicit file paths after checking both file lists against the working tree; no `.env`
  or secrets included. Working tree clean afterwards on `feature/mongodb-foundation`.
- Neither commit was pushed; no history was amended or rewritten; `main` and the local backup refs
  were not changed. GitHub was not checked. This status update is a separate docs-only commit.

## 2026-10-24 — Handbook audit corrections and hardening (committed in `4da3c13`)

- Audit of `AGENTS.md` and `docs/` against code, tests, `package.json` and Git: implementation
  claims for Steps 2a–3b matched; ten wording discrepancies corrected (`.env` loading by tests,
  `preview` marked NOT VERIFIED, remote state wording, local backup refs and push scope,
  `/dev/*` production behavior, where `MONGODB_URI` is read, explicit Step 3c row).
- `vitest.config.ts`: `envDir: false` — the test runner no longer parses `.env` (before, Vite
  parsed it and exposed only `VITE_*` values). Verified with a fake `.env` probe in a scratch folder.
- `src/lib/db-health.ts`: `getDatabaseHealth` now uses `safeErrors` (closes the documented gap);
  new source check in `src/test/db.test.ts`, mutation-tested (removed → failed → restored → passed).
- Results: `tsc` exit 0; lint 0 errors / 11 warnings; `bun run test` 161 passed, 0 failed,
  36 skipped; `bun run test:e2e` 34 passed, 0 failed, 1 skipped; nothing left running.

## 2026-10-23 — Documentation system (committed in `4da3c13`)

- Added `AGENTS.md` (rewritten as the agent entry point) and `docs/` (`PROJECT_STATUS`,
  `ARCHITECTURE`, `SECURITY`, `TESTING`, `ROADMAP`, `CHANGELOG`). Documentation only.
- Re-verified: `tsc`/`tsgo` exit 0; lint 0 errors / 11 warnings; `bun run test` 160 passed,
  0 failed, 36 skipped; `bun run test:e2e` 34 passed, 0 failed, 1 skipped.

## 2026-10-23 — Backend Step 3b: owner-only product creation (committed in `ced5535`)

- `createProductForOwner` (POST, `safeErrors` + `requireOwner`) and `/owner/products/new`
  (multi-variant form, optional write-only cost, no stock fields).
- Decisions: new products/variants always start at stock 0; SKU = trim + upper-case,
  `^[A-Z0-9._-]{1,64}$`; barcode = trim + upper-case, `^[A-Z0-9]{4,64}$`, invalid characters
  rejected (never stripped); case-insensitive unique indexes (collation `en`/2) named
  `product_sku_unique_ci`, `variant_sku_unique_ci`, `variant_barcode_unique_ci`.
- Creation fails closed unless `verifyProductIndexes` confirms the indexes; only
  `bun run db:setup-indexes` creates them (read-only conflict pre-check; never modifies data).
- Evidence: 10-way concurrent duplicate creates → exactly 1 saved; raw lower-case duplicate
  writes refused by MongoDB; 5-way concurrent replays in E2E → exactly 1 saved; cost never in
  responses. Each protection was mutation-tested (removed → test failed → restored).
- Correction: a suspected "stale product list" bug was disproved by a stricter test (the test had
  read the page during its loading state); the cache change made for it was reverted.

## 2026-10-23 — Backend Step 3a: read-only owner product list (committed in `ced5535`)

- `/owner/products` + `listProductsForOwner` (never returns cost); `/login?redirect=` allowlists
  exactly `/owner/products`; "Manage products (real data)" link.
- Correction: a first combined mutation run was invalid (filtered tests skipped their setup);
  redone one protection at a time with control runs.

## 2026-10-23 — Backend Step 2c: login UI (committed in `ced5535`)

- `/login` (POST form, hydration-guarded submit, password cleared each attempt, friendly
  database errors) and a landing-page "Owner sign-in (real account)" link.
- Correction: the first hydration-guard test always passed because Button CSS classes contain
  the word "disabled"; fixed to check the `disabled=""` attribute.

## 2026-10-23 — Backend Step 2b: request-flow integration (committed in `ced5535`)

- Found: thrown server-function errors reach the browser with stack traces (Seroval). Added
  `safeErrors` as the first middleware everywhere; validators never throw.
- `getProductForOwner` (owner-only), `/dev/auth`, opt-in isolated E2E (`bun run test:e2e`);
  dev-dependency `playwright-core@1.64.1`.

## 2026-10-23 — Product model and server-only product service (committed in `ced5535`)

- `src/server/models/product.server.ts` and `src/server/products.server.ts`: Zod-validated
  input, `productPricingError` (per-product minimum; owner confirmed there is **no** universal
  ฿350 minimum), cost `select: false`, optimistic concurrency, pricing changes only via `save()`.
- Dev-dependency `mongodb-memory-server@11.3.0` for isolated database tests.

## 2026-10-23 — Backend Step 2a: owner authentication core (committed in `ced5535`)

- scrypt hashing, MongoDB sessions (token hash only, 7-day TTL), in-memory attempt limit
  (5 / email+IP / 15 min), `single_owner` index, local `bun run auth:create-owner`, dev server
  bound to `127.0.0.1`. Employee accounts, audit, password reset postponed by the owner.

## 2026-10-23 — Backend Step 1: MongoDB connection foundation (`722d86f`, local branch, not pushed)

- Mongoose `9.11.3`, server-only `db.server.ts`, dev-only health check, `.env.example`,
  `nitro.config.ts` punycode alias for the Cloudflare build.
- Connections are released with `destroy()` (only it removes them from `mongoose.connections`).
- An intermittent Atlas failure was diagnosed as network timeouts, not a code regression.

## 2026-10-23 — Repository and demo work (on `main`; matches `origin/main` per the local tracking ref)

- `49aba5c` Prepare repository for private GitHub hosting (`.env*` ignored, README/AGENTS updated).
- `e7af41a` Enforce minimum selling price at checkout and in the sale-creation layer.
- `b786c32` Mobile usability fixes, `closedBy` on cash sessions, damaged-movement classification.
- `468b611` Fix drawer/audit actor mismatch, non-deterministic demo reset, chart metric drift.
- `af83d01` Checkpoint: project state before Phase One fixes.
- History was rewritten **before the first push** to use the owner's GitHub noreply author;
  pre-rewrite backups exist outside the repository (paths known to the owner), and the local-only
  refs `refs/original/*` and `refs/original-2/*` still hold the old history (never push them).
