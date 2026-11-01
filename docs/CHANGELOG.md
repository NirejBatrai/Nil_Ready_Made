# Changelog

Dated record of completed work, decisions, test evidence and corrections. Newest first.
Commit hashes refer to this repository. Each heading names the commit that contains the work;
"uncommitted" would mean it exists only in the working tree (see [PROJECT_STATUS.md](PROJECT_STATUS.md)).

## 2026-11-01 — Demo hidden by default in production

- **`DEMO_ENABLED`** (host environment, read on the server at call time,
  `src/server/demo-setting.server.ts`): `"true"` on, `"false"` off; unset means **OFF in
  production builds**, ON in `vite dev` and tests. An unreadable environment, or a failed check
  in the browser, means OFF (fail safe). Server function `getDemoEnabled` (`safeErrors`) and the
  guards `demoIsOn` / `requireDemo` in `src/lib/demo.ts`.
- **Demo OFF:** `/` shows only one primary **Sign in** button. Every demo screen (the `_shell`
  layout: `/sales`, `/pos`, `/dashboard`, …) redirects to `/login`.
- **Demo ON:** **Sign in** is the primary button at the top. The demo accounts follow under
  "Demo (practice only — nothing is saved)", with the existing simulation notice.
- **Renamed:** "Owner sign-in (real account)" is now **Sign in**, because staff use it too. The
  `/login` heading and title are now "Sign in", and its footer link is "← Back to start".
- **Files:**
  - New: `src/server/demo-setting.server.ts`, `src/lib/demo.ts`, `src/test/demo-setting.test.ts`.
  - Changed: `src/routes/index.tsx` (layout and setting), `src/routes/_shell.tsx` (redirect
    when OFF; the staff guard is unchanged), `src/routes/login.tsx` (text only),
    `src/test/auth.e2e.test.ts`, `.env.example`, and the docs.
  - The demo screens, auth and Quick Sales are unchanged.
- **Tests:**
  - Unit (`demo-setting.test.ts`): the defaults, the overrides, unreadable environment → OFF,
    and a source check.
  - E2E, dev server (demo ON): Sign in sits above the demo heading and is primary; `/pos` and
    the demo products page work.
  - E2E, built production server with no setting: `/` has no demo buttons, `/pos`, `/sales`,
    `/dashboard`, `/products` and `/settings` answer 307 → `/login`, and a browser visit to
    `/sales` ends on `/login`.
  - E2E, the same build with `DEMO_ENABLED=true`: the demo is shown and `/pos` answers 200.
- **Results:**
  - `bun run test`: 336 passed, 0 failed, 57 skipped.
  - `bun run test:e2e`: 55 passed, 0 failed, 1 skipped.
  - Typecheck and format check: exit 0.
  - Lint: 0 errors.
- **Mutation check:** I changed the production default from OFF to ON (`return true`). The unit
  test failed, and the E2E built-server check failed with "demo-section" on `/`. The file was
  restored byte-identical; the control run passed.

## 2026-11-01 — Interim Quick Sales (decision 0004, temporary)

A temporary sales notebook for about two weeks, until products and stock are ready. **Retires
when slice S9 lands** ([decision 0004](decisions/0004-interim-quick-sales.md)). It is separate
from the accepted 0002 design, which is unchanged. **All money is integer satang; never floats.**

- **Staff role:** `users.role` now allows `staff`. `bun run auth:create-staff`
  (`scripts/create-staff.ts`, same safety as `auth:create-owner`; the owner runs it).
  `createStaff` refuses existing emails. Staff sign in at `/login` and always land on
  `/quick-sales`; they are redirected away from `/login`, `/`, the demo screens and every
  `/owner` page.
- **Permissions:** `src/lib/permissions.ts` (owner/staff table, deny by default) and
  `requirePermission(permission)` in `src/lib/auth.ts`. Staff may only: see their own page,
  record today's opening change, add a quick sale, and cancel their own sale within 10 minutes.
  The product functions keep `requireOwner` (refuses staff).
- **Data:** `opening_floats` (`_id` = Bangkok business day, so one per day) and `quick_sales`
  (`itemText` 1–100, `amountSatang` > 0, `payment` `cash`/`qr`, `userId`, server-set
  `createdAt` and `businessDay`, `cancelled`, `cancelledAt`). Cancel is one atomic update (own,
  < 10 minutes, not cancelled). Business day = calendar date in `Asia/Bangkok`
  (`src/lib/bangkok-time.ts`). Amounts are parsed on the server with `parseBahtToSatang`.
- **Pages:**
  - `/quick-sales` (staff, mobile-first): opening-change form until today's exists, then Item,
    Amount (฿), Cash / QR, Add, "Saved ✓", and the last 5 own entries of the past 10 minutes
    with Cancel. No totals, no history, no links.
  - `/owner/today` (owner only): date picker (default today in Bangkok), opening change, total,
    Cash, QR, count, cancelled, expected cash = opening + Cash, and every sale (time, item,
    amount, payment, staff, status). Linked from the owner's signed-in card on `/login`.
- **API:** `GET /api/daily-summary?date=YYYY-MM-DD` (`src/server/summary-api.server.ts`). Bearer
  `SUMMARY_API_TOKEN` only; constant-time comparison; fails closed (503) when missing or shorter
  than 32 characters; no cookies; failures rate-limited per address with the MongoDB limiter
  (kind `summary_api`, 10 per 15 minutes). `.env.example` documents `openssl rand -base64 32`.
- **Staff URL:** the spec asked for `/sales`, but the demo already owns `/sales`; with the
  owner's choice the staff page is `/quick-sales`, and the demo is unchanged.
- **Existing files touched:**
  - `src/server/models/user.server.ts`: the `staff` role.
  - `src/server/auth/auth.server.ts`: `requirePermission` and `createStaff`.
  - `src/server/auth/session-context.server.ts`: `requirePermissionFromCookie`.
  - `src/lib/auth.ts`: the `requirePermission` middleware.
  - `src/server/auth/login-limiter.server.ts`: the `summary_api` limiter kind (type only).
  - `src/routes/login.tsx`: staff are sent to `/quick-sales`; owner link to `/owner/today`.
  - `src/routes/index.tsx`, `src/routes/_shell.tsx`: staff are redirected away from the demo.
  - `src/routes/owner.products_.new.tsx`: non-owners are sent to `/login`. Before, staff saw
    the empty form; the server already refused the create.
  - `src/routeTree.gen.ts`: regenerated in an isolated copy.
  - `package.json`: the `auth:create-staff` script; no dependency changes.
  - `.env.example`: `SUMMARY_API_TOKEN=`.
  - `src/test/auth.e2e.test.ts`: the Quick Sales block, the staff accounts and a throwaway
    token.
  - Docs: SECURITY, DEPLOY-VERCEL, ROADMAP, ARCHITECTURE, TESTING, PROJECT_STATUS and this file.
- **Tests:**
  - `quick-sales.test.ts`, `quick-sales-server-fns.test.ts` and `summary-api.test.ts`: 41 new
    tests.
  - 11 new E2E tests.
  - `bun run test`: 332 passed, 0 failed, 57 skipped.
  - `bun run test:e2e`: 55 passed, 0 failed, 1 skipped.
  - Typecheck and format check: exit 0.
  - Lint: 0 errors (11 old warnings).
- **Mutation checks** (each restored byte-identical, all caught): staff granted `viewDay`,
  `requirePermission` skipping the table, token comparison always true, no 32-character minimum,
  `userId` removed from the cancel filter, the staff list not limited to own sales, and totals
  added to the staff page. Details: [TESTING.md](TESTING.md#proving-protections-required-for-security-changes).
- **Not done by agents:** no staff account, no token set, nothing deployed, nothing run against a
  real database.

## 2026-11-01 — Money in integer satang

**All money is integer satang; never floats.** Required before slice S9 (decision 0002).

- **Money fields found** (real backend only): `price`, `minimumSellingPrice`, `cost`.
  - These exist on the product model, the service's create/update schemas and public mapper, and
    `getProductForOwner`; the server functions pass them through.
  - They are used by the create and edit forms and the `/owner/products` list.
  - They appear in the tests (`products.server`, `products-server-fns`, `auth`, `setup-indexes`,
    E2E).
  - No other money fields exist in the backend (no sales yet).
  - The demo's money fields (`src/types/domain.ts`, `src/lib/calc.ts`: `price`, `unitPrice`,
    `total`, `amount`, …) are browser-only and unchanged.
- **Renamed** to `priceSatang`, `minimumSellingPriceSatang`, `costSatang` (integer satang;
  ฿1,800.50 → 180050). The strict schemas reject the old names. The real backend now has its own
  `OwnerProduct` / `PublicProduct` types instead of the demo's `Product`.
- **`src/lib/money.ts`:**
  - `parseBahtToSatang` accepts "1800", "1,800" and "1800.50", using string and integer
    operations only. It rejects:
    - more than 2 decimals;
    - negatives;
    - junk, wrong comma grouping, leading zeros, exponents and non-ASCII digits;
    - anything above **฿10,000,000.00** (1 000 000 000 satang).
  - `formatSatang` always shows **two decimals** (`฿1,800.00`, `฿1,800.50`) on every
    real-backend page.
  - `productPricingErrorSatang` is the server rule (whole satang, bounds, minimum ≤ price).
  - The Mongoose schema also enforces whole satang and the bound.
- **Forms:** the browser parses each amount and sends nothing if one is invalid, showing a
  message such as "Selling price: Use at most 2 decimal places (satang)." The server validates
  again. The edit form is prefilled with "1500.00".
- **Migration:** `bun run db:migrate-money-satang` (`scripts/migrate-money-satang.ts`).
  - Dry run by default (counts only); `--apply` writes.
  - Each product is converted ×100 into the new fields and the old fields are removed, in one
    atomic update per product.
  - Idempotent: the update filter only matches products that still have an old field, so it is
    also safe to resume after an interruption.
  - It refuses, changing nothing, when values are not whole baht, are out of range, have a
    minimum above the price, or when a product has old and new fields at once.
  - It never prints product data or the connection string. Tested only against
    mongodb-memory-server; **not run on any real database** (owner-run).
- **Docs:** "All money is integer satang; never floats." added to ARCHITECTURE (new Money
  section), decision 0002 (topic text only, slices unchanged), SECURITY, AGENTS.md conventions
  and DEPLOY-VERCEL (when to run the migration).
- **Tests:**
  - new `money.test.ts` (12) and `migrate-money-satang.test.ts` (6);
  - converted backend tests, plus new tests: exact storage of 180050, the ฿10,000,000.00 bound,
    old field names rejected;
  - E2E: create with "1,200.50" / "900.25" / cost "7,777.77" (stored 120050 / 90025 / 777777),
    and edit to "1,800.50" / "1200.25". Shown as `฿1,800.50`; browser-side rejection of
    "12.505", "-1", "10,000,000.01" and "1.800,50" with no request sent.
- **Mutation checks**, each restored byte-identical and each caught by unit tests:
  - the 2-decimal rule ("1.005" accepted as 105);
  - fraction scaling;
  - the migration's idempotency guard;
  - dry-run-by-default;
  - the migration's blocking check.
- **Checks:** typecheck, lint (0 errors, 11 known warnings), format check, `bun run test` (291
  passed, 46 skipped), `bun run test:e2e` (44 passed, 1 skipped).

## 2026-10-31 — Step 5c: Vercel variant for personal testing (not deployed)

Decision: [0003](decisions/0003-vercel-for-personal-testing.md). Vercel Hobby is for personal,
non-commercial testing only; Atlas would need `0.0.0.0/0`.

- **Client address** (`client-address.server.ts`):
  - On Vercel (runtime `VERCEL=1`, never request data): the first entry of
    `x-vercel-forwarded-for`, validated as today. A missing or invalid first entry means no
    address. Later entries and the socket are never used there.
  - Off Vercel and off Workers: unchanged (socket only, every header ignored).
  - Platform passed explicitly in tests (`"server" | "vercel" | "workers"`).
- **Login limits in MongoDB** (`login-limiter.server.ts`, `models/login-attempt.server.ts`,
  collection `login_attempts`): same three limits, thresholds, windows and messages.
  - Each check-and-count is one atomic single-document update pipeline with upsert, and keeps a
    sliding window.
  - Undo by random attempt id, and `reset` on success.
  - TTL index `login_attempt_expiry` on `expiresAt`, created by `ensureAuthIndexes`, so by
    `db:setup-indexes` and `auth:create-owner`.
  - **Fail closed**: limiter errors refuse login with "Database unavailable." and no password
    check. Undo is best effort.
  - The in-memory limiter, its 10 000-key cap and the module-level limiter instances are
    removed. The hashing bound stays in memory.
- **Build**:
  - `nitroPreset()` (`build-preset.server.ts`): `node-server` by default; `vercel` via
    `NITRO_PRESET=vercel` or Vercel's `VERCEL=1`; other presets fail the build.
  - Checked by building an isolated copy (no `.env`) with `NITRO_PRESET=vercel`. The output was
    `.vercel/output/{config.json, static/, functions/__server.func}` (Node.js 24 function). The
    default build still writes `.output/server/index.mjs`.
- **Headers verdict (Vercel output):**
  - As Nitro first generated it, the route rules did **not** apply reliably.
    - Its `config.json` had a header-only `/assets/(.*)` cache route, then a header-only
      `/(.*)` baseline route, both without `continue: true`.
    - Vercel's Build Output API documents that routing stops at a matched route unless
      `continue` is true. So hashed assets would get only the cache header, and the baseline
      catch-all would stop routing before the app function.
  - Fixed in `nitro.config.ts` (`nitroSettings("vercel")`): the baseline is the first route for
    `/(.*)` with `continue: true`, with no `/**` route rule on Vercel. The rebuilt output has
    that order.
  - Not verified on Vercel itself:
    - doubled headers on pages;
    - Nitro's assets route still serving files;
    - the HSTS scheme.
  - These are in the owner's smoke test.
- **Docs**: decision 0003, owner checklist [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md), and updates to
  SECURITY (Vercel IP trust, MongoDB limits and the fail-closed tradeoff, the Atlas `0.0.0.0/0`
  risk), ARCHITECTURE, TESTING, PROJECT_STATUS and ROADMAP.
- **Tests**:
  - New `login-limiter.test.ts` (10 tests; TTL monitor at 1 s), `build-preset.test.ts` (4) and
    Vercel cases in `client-address.test.ts`.
  - Two `nitroSettings` tests in `security-headers.test.ts`.
  - `auth.test.ts`: two new tests (fail closed with unreachable counters, one shared collection
    keyed by kind) replace the two memory-cap tests. Its clock now starts at the real time.
- **Mutation checks**: 13 protections removed one at a time; each was caught by a failing unit
  test and restored byte-identical. They are listed in [TESTING.md](TESTING.md).
- **Checks**: typecheck, lint (0 errors, 11 known warnings), format check, `bun run test` (268
  passed, 46 skipped), `bun run test:e2e` (44 passed, 1 skipped).

## 2026-10-31 — Owner product edit and archive UI

- Server functions in `src/lib/products.ts`, all `safeErrors` + `requireOwner`:
  `getProductForEditing` (GET; the product **without cost**, archived ones included),
  `updateProductForOwner`, `archiveProductForOwner`, `restoreProductForOwner` (all POST). They
  pass the untrusted input to the existing product service (`updateProduct`,
  `setProductActive`), which validates everything again. No service changes; no delete exists.
- `/owner/products/$productId/edit` (`owner.products_.$productId.edit.tsx`): same styling,
  fields and messages as the create form. SKU and variants are shown read-only because the
  service does not allow changing them; stock is never edited. Cost stays write-only: never
  loaded; an empty field keeps it, "Remove the stored cost" sends `null`. Blocking loader; after
  a save it calls `router.invalidate()` and then navigates to the list.
- `/owner/products`: Active (default) and Archived views (`?view=archived`; the server returns
  all products with `includeArchived: true` and the page keeps the archived ones), an Edit link,
  Archive behind a confirmation dialog, and Restore. Archive/restore call `router.invalidate()`
  and finish only after the fresh list has loaded.
- Behaviour kept from the service: money is **whole baht stored as integers** (not satang);
  SKU uniqueness cannot be hit by an edit (SKU is not editable; a duplicate-key error would show
  "That SKU or barcode is already used by another product."); overlapping saves of one product
  fail with "This product was changed at the same time. Reload it and try again."
  (optimistic concurrency). A form opened before someone else saved is **not** detected: the
  later save wins (the service takes no expected version).
- Tests: `products-server-fns.test.ts` (20 tests) runs the server functions through TanStack
  Start's real server-side middleware chain against mongodb-memory-server (only the cookie value
  and `withDatabase` are replaced): refusal without a cookie, with a forged token, for an
  inactive owner and after logout; validation, server-controlled fields, malformed input,
  concurrent edits, archive/restore, list filter, no delete function. E2E: 7 new tests (edit
  page redirect, prefilled form without cost, new values shown with no stale render observed,
  validation, archive confirmation/cancel, archived view + restore, endpoint session/CSRF/field
  checks).
- Mutation checks, each restored byte-identical: `requireOwner` removed from each of
  `listProductsForOwner`, `getProductForEditing`, `updateProductForOwner`,
  `archiveProductForOwner`, `restoreProductForOwner` (unit test failed each time: "expected
  'undefined' to be 'Not signed in.'"); from `updateProductForOwner` in the E2E run (anonymous
  replay accepted); the service's `{ active: true }` filter removed (1 unit and 4 E2E failures,
  e.g. "expected [ 'E2E Archived Bag', …(2) ] to deeply equal [ 'E2E Sun Hat', 'E2E Towel' ]").
- Checks: typecheck, lint (0 errors, 11 known warnings), format check, `bun run test` (250
  passed, 46 skipped), `bun run test:e2e` (44 passed, 1 skipped).

## 2026-10-28 — Step 7a: session revocation and login session hygiene

- `revokeAllSessions(userId)` (deletes every session of the user via the `userId` index) and a
  `signOutEverywhere` server function (POST, needs a valid session, revokes all of that user's
  sessions including the current one, clears the cookie). "Sign out everywhere" button on the
  signed-in card of `/login` (existing button styling), which then shows `/login`'s sign-in form.
- Login: the session cookie presented at login is deleted after the new session is created; each
  user keeps at most 5 sessions (oldest deleted; the new one always kept; soft cap under
  simultaneous logins); sessions store `createdIp` (or `null`), `userAgent` (≤ 256 characters)
  and `lastSeenAt` (written at most every 5 minutes). Never logged. No idle timeout (Step 7b).
- Unchanged: token generation/hashing, 7-day absolute expiry, per-request role re-read, rate
  limits, generic errors, CSRF.
- Old sessions without the new fields keep working (fields optional; no migration; tested).
- Tests: 11 new unit tests (`auth.test.ts`), an E2E "sign out everywhere" test with a second
  browser context, and a CSRF check (403 cross-site / no origin, 200 same-origin) against the
  built Node server. Mutation checks: 9 protections removed one at a time, each caught, each file
  restored byte-identical. A first version also had a database-side throttle filter for
  `lastSeenAt`; no test could observe it (the in-code check already prevents the write), so it
  was removed.
- Docs: SECURITY session lifecycle + PDPA note (IP/User-Agent stored for security, deleted with
  the session, never logged); ROADMAP: run `db:setup-indexes` on every deploy (required before
  any real deployment) and Step 7b (idle timeout / PIN lock) planned.
- Checks: typecheck, lint (0 errors, 11 known warnings), format check, `bun run test` (230 passed,
  39 skipped), `bun run test:e2e` (37 passed, 1 skipped).

## 2026-10-28 — Step 5b: build target Node server

- `vite.config.ts`: `nitro: { preset: "node-server" }` (installed Nitro `3.0.260603-beta`),
  overriding the Lovable default `cloudflare-module`. Start with `node .output/server/index.mjs`;
  `PORT`/`HOST` are read from the environment; without `HOST` it listens on all interfaces.
- Static files: the Node server serves `.output/public` before `src/server.ts`, so they had no
  security headers, and `public/_headers` (Cloudflare-only) was ignored **and published** as
  `/_headers`. Replaced by a `routeRules` entry in `nitro.config.ts` that adds
  `BASELINE_SECURITY_HEADERS` (imported from the server module) to every response;
  `public/_headers` removed. Hashed `/assets/*` keep `public, max-age=31536000, immutable`; each
  header appears once on dynamic responses.
- Tests: the unit test now checks the route rule instead of `public/_headers`; the E2E
  production-build test starts the built server with `node` and checks headers on `/login`,
  `favicon.ico` and a hashed asset, and that `/_headers` is 404. Removing the route rule made
  both fail; restored byte-identical.
- `.env.example`: production settings go in the Node host's environment, not Worker secrets.
- Smoke test (isolated copy, throwaway local `mongod` on 127.0.0.1, Node v24.14.0): signed-out
  redirect; login 352 ms (`__Host-luxe_session`, HttpOnly, Secure, SameSite=Lax); empty list;
  create → row in 167 ms; row after reload; headers as above.
- Checks: typecheck, lint (0 errors, 11 known warnings), format check, `bun run test` (219
  passed, 38 skipped), `bun run test:e2e` (36 passed, 1 skipped).
- Kept unchanged (candidates for removal): Workers detection by `navigator.userAgent`, the
  `punycode/` alias.

## 2026-10-28 — Steps 4 and 5a: Workers runtime test and decision to run on a Node server

- Step 4: time-boxed local test of the app under Cloudflare's runtime (`wrangler dev --local`,
  workerd, throwaway `mongod` on 127.0.0.1) on the throwaway branch `spike/workers-runtime`
  (worktree `../Nil_Ready_made-spike-workers`; not merged, no code copied into this branch).
  The branch and worktree were throwaway and have since been removed by the owner.
  Results: the app as built cannot load the MongoDB driver under workerd
  (`No such module "node:process"`); connections cannot be reused across requests; one scrypt
  hash costs ~275–340 ms (Free plan CPU limit: 10 ms); locally a client-supplied
  `CF-Connecting-IP` bypassed the per-address limit. Full table:
  [decisions/0001](decisions/0001-runtime-node-not-workers.md).
- Step 5a (owner decision): production runs as a **Node.js server** (Node LTS). Recorded in
  `docs/decisions/0001-runtime-node-not-workers.md`; ROADMAP, ARCHITECTURE, SECURITY, TESTING and
  PROJECT_STATUS now name the Node target and mark Workers-specific statements historical.
  ROADMAP gains "Required before any real deployment: trusted-proxy handling".

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
  hardening), while the docs still called it uncommitted. `main` (`49aba5c`) and the backup
  refs (`8d1fcda`, `46b1fe8`) unchanged.
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

## 2026-10-24/25 — Baseline security headers (commit `4711be0`)

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

## 2026-10-24 — Login hardening (commit `42518cc`)

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

## 2026-10-24 — Foundation work committed

- `ced5535` `feat: add secure owner authentication and product management foundation` (28 files):
  product model/service and Backend Steps 2a–3b, with their tests.
- `4da3c13` `docs: add AI agent handbook and harden test isolation` (10 files): `AGENTS.md`,
  `docs/`, `envDir: false`, `safeErrors` on `getDatabaseHealth`, new source check.
- Staged by explicit file paths after checking both file lists against the working tree; no `.env`
  or secrets included. Working tree clean afterwards on `feature/mongodb-foundation`.
- No history was amended or rewritten; `main` and the local backup refs were not changed. This
  status update is a separate docs-only commit.

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

## 2026-10-23 — Backend Step 1: MongoDB connection foundation (`722d86f`)

- Mongoose `9.11.3`, server-only `db.server.ts`, dev-only health check, `.env.example`,
  `nitro.config.ts` punycode alias for the Cloudflare build.
- Connections are released with `destroy()` (only it removes them from `mongoose.connections`).
- An intermittent Atlas failure was diagnosed as network timeouts, not a code regression.

## 2026-10-23 — Repository and demo work (on `main`)

- `49aba5c` Prepare repository for private GitHub hosting (`.env*` ignored, README/AGENTS updated).
- `e7af41a` Enforce minimum selling price at checkout and in the sale-creation layer.
- `b786c32` Mobile usability fixes, `closedBy` on cash sessions, damaged-movement classification.
- `468b611` Fix drawer/audit actor mismatch, non-deterministic demo reset, chart metric drift.
- `af83d01` Checkpoint: project state before Phase One fixes.
- History was rewritten **before the first push** to use the owner's GitHub noreply author;
  pre-rewrite backups exist outside the repository (paths known to the owner), and the local-only
  refs `refs/original/*` and `refs/original-2/*` still hold the old history (never push them).
