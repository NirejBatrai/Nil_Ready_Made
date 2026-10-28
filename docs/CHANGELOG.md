# Changelog

Dated record of completed work, decisions, test evidence and corrections. Newest first.
Commit hashes refer to this repository. Each heading names the commit that contains the work;
"uncommitted" would mean it exists only in the working tree (see [PROJECT_STATUS.md](PROJECT_STATUS.md)).

## 2026-10-28 — Steps 4 and 5a: Workers runtime test and decision to run on a Node server

- Step 4: time-boxed local test of the app under Cloudflare's runtime (`wrangler dev --local`,
  workerd, throwaway `mongod` on 127.0.0.1) on the throwaway branch `spike/workers-runtime`
  (worktree `../Nil_Ready_made-spike-workers`; not merged, no code copied into this branch).
  Results: the app as built cannot load the MongoDB driver under workerd
  (`No such module "node:process"`); connections cannot be reused across requests; one scrypt
  hash costs ~275–340 ms (Free plan CPU limit: 10 ms); locally a client-supplied
  `CF-Connecting-IP` bypassed the per-address limit. Full table:
  [decisions/0001](decisions/0001-runtime-node-not-workers.md).
- Step 5a (owner decision): production runs as a **Node.js server** (Node LTS). Recorded in
  `docs/decisions/0001-runtime-node-not-workers.md`; ROADMAP, ARCHITECTURE, SECURITY, TESTING and
  PROJECT_STATUS now name the Node target and mark Workers-specific statements historical.
  ROADMAP gains "Required before any real deployment: trusted-proxy handling".
- The owner pushed `feature/mongodb-foundation` to GitHub (2026-10-28).

## 2026-10-27/28 — Step 3: stale product list after creation, root cause and fix (committed 2026-10-28; hash in `git log`)

- Re-verified 2026-10-28 by a new agent (the earlier loop evidence was deleted):
  - Mutation check: with only the `staleReloadMode: "blocking"` line removed from
    `src/routes/owner.products.tsx`, the creation E2E test failed
    (`expected { armed: true, shown: true } to deeply equal { armed: true, shown: false }`);
    file restored, SHA-256 identical to before.
  - With the fix: the creation test and the four tests it depends on (`vitest -t`), 15 separate
    runs, each with a fresh isolated copy, database and dev server: **15/15 passed**.
  - Full checks with Step 3: typecheck, lint (0 errors, 11 known warnings), format check,
    `bun run test` (219 passed, 38 skipped), `bun run test:e2e` (36 passed, 1 skipped).
  - `/owner/products/new` does **not** call `router.invalidate()` after a successful create
    (it only navigates); left unchanged. Documented as a convention in
    [ARCHITECTURE.md](ARCHITECTURE.md#router-data-after-mutations).
- Docs: `PROJECT_STATUS.md` no longer records commit hashes (state by step name; see `git log`).

- Symptom: the E2E check "the earlier (now stale, empty) list may never be shown" failed
  intermittently (about 1 in 7 full runs on 2026-10-27).
- Reproduced with a temporary loop (40 iterations of the exact scenario in one browser session,
  with a `MutationObserver` on the page and every server-function request/response recorded;
  file deleted afterwards): the stale empty list was **rendered after every create, 40/40**,
  for 11–38 ms (median 17.5 ms) before the fresh rows replaced it. The original one-off check
  ran ~140 ms after submit, so it caught the window **0/40** times in that loop: the bug was
  deterministic, its detection was not.
- Root cause (app, TanStack Router `@tanstack/router-core` 1.170.x, `load-client.js`): leaving
  `/owner/products` for `/owner/products/new` caches the list match (as a preload, line 1139);
  coming back finds it stale (`defaultPreloadStaleTime: 0`, lines 330–331) with status
  `success`, so the loader reloads in the **background** (line 346) and the cached data renders
  first. `router.invalidate()` would not help: invalidated cached matches keep status
  `success` and still reload in the background (`router.js` `invalidate`).
- Ruled out with the recorded traces: navigation before the create resolved (the form awaits
  `createProductForOwner` before `navigate`; in all 40 runs the list request was sent after
  the create response); the database (one list request after the create, its response rendered
  the new row; DB count 1 every time; same MongoDB); a test-only race (the stale render happens
  in the app; the test's intent was right, only its one-off check was timing-dependent).
- Fix: `src/routes/owner.products.tsx` loader uses `staleReloadMode: "blocking"`, so returning
  to the list waits for fresh data (the existing loading state appears after 200 ms) instead of
  showing cached data. No other route changed; no cache times changed.
- Test: the E2E creation test now records with a `MutationObserver` whether the empty list is
  ever rendered between submit and the new row (deterministic) instead of a one-off check.
  Mutation check: route restored to the committed version → the test failed (`shown: true`);
  fix restored byte-identical (SHA-256).
- Loop results: before 40/40 stale renders; after **0/40**, median submit→rows 129 ms (before:
  127.5 ms). This corrects the 2026-10-23 note below ("disproved"): the earlier suspicion was
  right; that test had also only checked once.

## 2026-10-27 — Step 2: login client address and per-account limit (commit `306916c`)

- Problem: `session-context.server.ts` used `getRequestIP() ?? "unknown"`, so if no address was
  available every client shared one bucket and 20 failures from anyone blocked everyone.
- Inspected (installed code): off Workers, `getRequestIP()` (h3) returns srvx's `request.ip`,
  the socket address (srvx trusts no proxy unless `trustProxy` is set; it is not). In the
  Cloudflare build, Nitro's handler copies `CF-Connecting-IP` into `request.ip`.
- New `src/server/auth/client-address.server.ts`: `CF-Connecting-IP` only when
  `navigator.userAgent === "Cloudflare-Workers"` (runtime property; on by default for
  compatibility dates after 2022-03-21; Node.js reports `Node.js/<version>`), otherwise the
  socket address; headers never trusted off Workers; no proxy-trust setting; anything that is
  not an IP address gives no address.
- `auth.server.ts`: `login(input, ip: string | undefined)`. Without an address the per-address
  and per-email + address limits are skipped. New per-account limit `LOGIN_ACCOUNT_LIMIT` (50
  per normalized email per 15 min, also for emails without an account) through the existing
  `createLoginLimiter` (10 000-key cap). Same atomic count-before-await; a refusal un-counts the
  limits already passed; no-verdict attempts un-count all three; a correct password does not
  count against the account. Generic errors and scrypt parameters unchanged.
- Decision: fixed threshold (50, at least 10 addresses needed to block the owner) instead of
  progressive backoff; trusted proxies not supported (documented as a limitation for a Node.js
  host behind a load balancer).
- Tests: `client-address.test.ts` (5), 11 new tests in `auth.test.ts` (per-account limit, no
  shared bucket, source check of the login bridge), E2E replay of the captured login with
  spoofed `CF-Connecting-IP` / `X-Forwarded-For` / `X-Real-IP` while 127.0.0.1 is blocked.
- Mutation tests (each applied → targeted test failed → restored byte-identical, SHA-256):
  header trusted off Workers (unit + **E2E: the spoofed replay signed in as the owner**);
  shared `"unknown"` key in `login`; per-account check disabled; account refusal not
  un-counting address/email limits; database error counted against the account; correct
  password counted against the account; `"unknown"` fallback in the login bridge.
- Results: `bun run typecheck` exit 0; lint 0 errors / 11 warnings; `bun run format:check`
  exit 0; `bun run test` 219 passed, 0 failed, 38 skipped; `bun run test:e2e` run twice: 36
  passed, 0 failed, 1 skipped both times (the known flake at the product list did not recur).
- NOT VERIFIED: anything on workerd / Cloudflare (`navigator.userAgent`, `CF-Connecting-IP`).

## 2026-10-27 — Status review and documentation/tooling hygiene (commit `cd76d76`)

- Read-only status review found the docs out of date: the security-headers work had been
  committed on 2026-10-25 as `4711be0` (message "nil comit"), on top of `42518cc` (login
  hardening), while the docs still called it uncommitted. Both commits are local only, not
  pushed. `main` (`49aba5c`) and the backup refs (`8d1fcda`, `46b1fe8`) unchanged.
- Docs corrected: PROJECT_STATUS (Git state, results, limitations), ROADMAP (completed rows for
  `42518cc`/`4711be0`, four new candidate rows), TESTING (results, new scripts, flaky test),
  SECURITY (security-headers section separates E2E-verified from unit-only items; HSTS is
  unit-only). Stale comment in `src/lib/db-health.ts` ("real authentication does not exist
  yet") corrected; comment only.
- `package.json`: new scripts `typecheck` (`tsc --noEmit -p .`) and `format:check`
  (`prettier --check .`). No dependency changes.
- `roadmap.md` and `src/routes/README.md` reformatted with Prettier (formatting only); they were
  the only files failing `prettier --check .` (unformatted since `af83d01`). The docs edited in
  this step were also run through Prettier (affects only the new text).
- Results after these changes (2026-10-27): `bun run typecheck` exit 0; `bun run lint` 0 errors
  / 11 warnings; `bun run format:check` exit 0; `bun run test` 203 passed, 0 failed, 37
  skipped. E2E not re-run (no code or test changes).
- Review results before these changes (2026-10-27): `tsc` exit 0; lint 0 errors / 11
  warnings; `bun run test` 203 passed, 0 failed, 37 skipped; `bun run test:e2e` run twice —
  first run 34 passed / **1 failed** / 1 skipped (intermittent: `auth.e2e.test.ts:734`, the
  product list showed its empty state right after a product was created), second run 35
  passed, 0 failed, 1 skipped. Not root-caused; ROADMAP lists the investigation.
- Findings recorded as limitations (answered from code, not tested): the login limiter is
  in-memory per process/isolate; the client address falls back to the shared key `"unknown"`
  when `getRequestIP()` returns nothing (behaviour on Workers NOT VERIFIED); Mongoose and scrypt
  have never run under workerd; scrypt CPU cost per login not measured.

## 2026-10-24/25 — Baseline security headers (commit `4711be0`, local, not pushed)

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

## 2026-10-24 — Login hardening (commit `42518cc`, local, not pushed)

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
