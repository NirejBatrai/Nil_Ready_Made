# Testing

_Commands VERIFIED from `package.json` and by running them on 2026-10-23, 2026-10-24, 2026-10-25, 2026-10-27, 2026-10-28 and 2026-10-31 (twice: product edit/archive, Step 5c) and 2026-11-01 (money in satang; interim Quick Sales)._

## Prerequisites

- Node.js ≥ 20.19 (verified with v24.14.0) and Bun. If `bun` is not on `PATH`, use
  `npx -y bun@1 <args>` (e.g. `npx -y bun@1 run test`) — this is how the checks were run.
- Dependencies installed: `bun install --frozen-lockfile`.
- First isolated-database run downloads the free MongoDB server binary (~120 MB) into
  `~/.cache` (mongodb-memory-server). Later runs work offline.
- E2E only: Google Chrome at `/usr/bin/google-chrome` or `CHROME_PATH` (verified: Chrome 155).

## Isolated database rule (mandatory)

Tests use **mongodb-memory-server on `127.0.0.1` only** and refuse any other address, never touch
Atlas, and never use real shop data. Any new database test must follow the same pattern
(see `src/test/products.server.test.ts`).

How `.env` is kept out of tests (VERIFIED 2026-10-24):

- `vitest.config.ts` sets `envDir: false`, so Vite/Vitest load no `.env` files at startup
  (without it, Vite parses `.env` and exposes `VITE_*` values). Checked with a fake `.env` in a
  scratch folder: loaded by default, not loaded with `envDir: false`.
- `bun run test` starts Vitest under Node.js; Bun's automatic `.env` loading applies only to
  files Bun runs directly (`auth:create-owner`, `db:setup-indexes`). Checked with a fake `.env`.
- `setup-indexes.test.ts` and `reset-password.test.ts` run their scripts in an empty temp folder; the E2E suite runs in a copy
  without `.env`.
- The only exception is the opt-in `test:db`, which calls `loadEnv` itself for `MONGODB_*`.

## Commands

| Purpose                  | Command                                                   | Loads `.env`?          | Verified result (date)                                                                                                            |
| ------------------------ | --------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Type check               | `bun run typecheck` (`tsc --noEmit -p .`)                 | No                     | exit 0 (11-01, with interim Quick Sales)                                                                                          |
| Type check (fast)        | `npx -y -p @typescript/native-preview tsgo --noEmit -p .` | No                     | exit 0 (10-23)                                                                                                                    |
| Lint                     | `bun run lint`                                            | No                     | 0 errors, 11 warnings (pre-existing) (11-01, with interim Quick Sales)                                                            |
| Format check             | `bun run format:check` (`prettier --check .`)             | No                     | exit 0, all files formatted (11-01, with interim Quick Sales)                                                                     |
| Unit + integration       | `bun run test`                                            | No (`envDir: false`)   | 336 passed, 0 failed, 57 skipped (11-01, demo hidden by default in production)                                                    |
| Watch mode               | `bun run test:watch`                                      | No (`envDir: false`)   | not run                                                                                                                           |
| **E2E (opt-in)**         | `bun run test:e2e`                                        | **No** (isolated copy) | 55 passed, 0 failed, 1 skipped (11-01, demo hidden by default in production); former intermittent failure fixed, see Known limits |
| Live Atlas ping (opt-in) | `bun run test:db`                                         | **Yes**                | NOT run by agents; owner reported a pass                                                                                          |
| Production build         | `bun run build`                                           | **Yes**                | NOT run in the real project by agents                                                                                             |
| Dev server               | `bun run dev`                                             | **Yes**                | NOT run in the real project by agents                                                                                             |
| Preview build            | `bun run preview`                                         | Likely (NOT VERIFIED)  | NOT run by agents                                                                                                                 |
| Format files             | `bunx prettier --write <files>`                           | No                     | used on changed files                                                                                                             |

Do not run the `.env`-loading commands unless the owner asks; prefer that the owner runs them.
If `bunx` is not on `PATH`, `npx tsc --noEmit -p .` and `npx -y bun@1 x prettier …` are equivalent.

## What the suites cover

`bun run test` (Vitest, `src/test/*.test.ts[x]`, jsdom by default; DB tests use
`// @vitest-environment node`):

| File                                                                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calc.test.ts`, `pricing.test.ts`, `metrics.test.ts`, `demo-seed.test.ts`, `workflow.test.ts`, `app-routing.test.tsx` | Demo business rules (pricing/minimum price, metrics, fixtures, workflows, routing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `products-ui.test.tsx`                                                                                                | Demo Products screen shows the owner-only lock for employees (UI only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `db.test.ts`                                                                                                          | Connection module with fakes (reuse, cleanup, sanitized errors, health check)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `products.server.test.ts`                                                                                             | Product model/service on isolated DB: pricing, normalization, case-insensitive uniqueness (incl. raw writes), 10-way concurrent duplicates, fail-closed indexes, cost hiding, no index creation by app code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `products-server-fns.test.ts`                                                                                         | Product server functions through TanStack Start's real server-side middleware chain (isolated DB; only the cookie value and `withDatabase` are replaced): every function refuses without a valid owner session, edit validation and server-controlled fields, concurrent edits, archive/restore and the active-only list filter, no delete function                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `money.test.ts`                                                                                                       | Real-backend money: `parseBahtToSatang` ("1800", "1,800", "1800.50", "0.1" → 10 exactly, floating-point traps, whitespace, junk, wrong grouping, "1.005" and negatives rejected, ฿10,000,000.00 bound), `formatSatang` (always two decimals), round trips, `productPricingErrorSatang`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `migrate-money-satang.test.ts`                                                                                        | Runs `scripts/migrate-money-satang.ts` under Bun on isolated DBs: dry run changes nothing, `--apply` converts ×100 and removes the old fields, a second run changes nothing, resumes after interruption, refuses unsafe values changing nothing, prints counts only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `setup-indexes.test.ts`                                                                                               | Runs `scripts/setup-indexes.ts` under Bun on isolated DBs: creates, idempotent, refuses on conflicts/unnormalized data without changing it, stops on index-definition conflicts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `reset-password.test.ts`                                                                                              | `resetPassword` on an isolated DB, and `scripts/reset-password.ts` run under Bun from an empty temp folder: owner and staff, new password works and the old one fails, ALL that user's sessions revoked (others kept), roles/emails/`active` unchanged and still one owner, unknown email → "No such user." only, mismatched or weak passwords change nothing, no URI or password printed, generic database error                                                                                                                                                                                                                                                                                                                                                                |
| `quick-sales.test.ts`                                                                                                 | INTERIM Quick Sales service on an isolated DB: Bangkok business day at midnight (16:59:59.999 / 17:00 UTC), `parseBusinessDay`, the permission table (deny by default, prototype keys), `createStaff`/`requirePermission`, one opening change per day (5 simultaneous → 1), sale validation and refused client fields, the 10-minute own-cancel window (9:59.999 ok, 10:00 refused), someone else's sale refused, atomic cancel, the staff view (ALL own sales of today, newest first, not yesterday's or anyone else's, Cancel only under 10 minutes, no totals), payment required, owner cancel with a reason, soft-remove / restore (excluded from totals and lists, never deleted), re-recording a removed opening change (3 simultaneous → 1), day totals and expected cash |
| `quick-sales-server-fns.test.ts`                                                                                      | INTERIM Quick Sales server functions through the real middleware chain (harness of `products-server-fns`): staff refused on all seven product functions and `getDayForOwner`; signed out / forged / inactive refused; source check (`safeErrors` + `requirePermission` on all five); staff flow; userId from the session; leak test (no totals, names, ids or other users' sales in any staff response)                                                                                                                                                                                                                                                                                                                                                                          |
| `summary-api.test.ts`                                                                                                 | INTERIM `/api/daily-summary` handler with real Requests: fail closed without a ≥ 32-character token (no database touched), missing/other-scheme/short/wrong/near-miss tokens 401, session cookies ignored, SHA-256 + `timingSafeEqual`, failure rate limit per address (10 / 15 min, then 429 even with the token; IPv6 /64; no-address bucket), database down 503, exact JSON shape, default date at the Bangkok midnight boundary, bad dates 400                                                                                                                                                                                                                                                                                                                               |
| `auth.test.ts`                                                                                                        | Passwords, login, attempt limits (simultaneous attempts, per-address/email rotation, IPv6 /64, database-down and hashing-busy un-counting, per-account limit incl. emails without an account and address rotation, no shared bucket without an address), hashing concurrency bound, sessions/expiry, session revocation and login hygiene (revoke all, sign out everywhere, old session deleted at login, 5-session cap, `lastSeenAt` throttling with a write count, User-Agent truncation, legacy sessions without the new fields, no logging), owner authorization, single owner, cookie options, config checks                                                                                                                                                                |
| `client-address.test.ts`                                                                                              | Login client address: socket address on a plain server with spoofed `x-vercel-forwarded-for`/`CF-Connecting-IP` ignored; on Vercel (simulated `VERCEL=1`) the first `x-vercel-forwarded-for` entry only, never the socket or later entries; `CF-Connecting-IP` only on Workers; non-IP values give no address; detection by `VERCEL=1` / user agent                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `login-limiter.test.ts`                                                                                               | MongoDB login limiter on an isolated DB: limit and sliding window, kinds/keys independent and literal, 50 simultaneous attempts → exactly the limit, counts shared by two instances, undo removes exactly one attempt, TTL index present and real TTL deletion, database errors fail closed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `build-preset.test.ts`                                                                                                | Nitro preset: node-server default, vercel via `NITRO_PRESET` or `VERCEL=1`, other presets refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `security-headers.test.ts`                                                                                            | Security headers: values, no-store, redirect/Set-Cookie/stream copying, HSTS gating and setting parsing, every return path of `src/server.ts` (mocked entry), `nitro.config.ts` static-file route rule in sync                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `server-errors.test.ts`                                                                                               | `toSafeError` and the real serializer payload (no stack)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `db.integration.test.ts`                                                                                              | Opt-in live ping (skipped unless `RUN_DB_INTEGRATION=1`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `auth.e2e.test.ts`                                                                                                    | Opt-in E2E (skipped unless `RUN_AUTH_E2E=1`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

`bun run test:e2e` (`src/test/auth.e2e.test.ts`) — fails closed if isolation cannot be confirmed:

1. Copies the repo to a temp folder from `git ls-files --cached --others --exclude-standard`
   (ignored files such as `.env` are never copied; aborts if any env-like file appears).
2. `bun install --frozen-lockfile` in the copy; starts mongodb-memory-server on `127.0.0.1`.
3. Runs the real `vite dev` in the copy with a fresh environment whose only `MONGODB_URI` is the
   throwaway database; drives Chrome via playwright-core and replays captured requests.
4. Covers: `127.0.0.1` binding, login/logout/expiry, cookie attributes, CSRF (403), attempt limit
   (a real address is detected in dev; spoofed `CF-Connecting-IP` / `X-Forwarded-For` /
   `X-Real-IP` on a replayed login are ignored),
   `/login` UI, `/owner/products` (guards, no cost, loading/empty/error states),
   "Sign out everywhere" (a second browser context is signed out too; IP/User-Agent/`lastSeenAt` stored), `/owner/products/new` (creation, no stale list rendered afterwards, validation, duplicates, 5-way concurrent replays,
   server-controlled fields rejected), edit and archive (edit page redirect, prefilled form
   without cost, new values shown with no stale render, validation, archive confirmation and
   cancel, archived view and restore, session/CSRF/field checks on the endpoints), demo unchanged, leak scan of every response, security
   headers on pages, 404s, redirects, signed-in owner pages, server functions, CSRF 403s and
   database-down pages (exact values; no HSTS over http; `favicon.ico` bypasses the app), and a production build
   of the copy (Nitro `node-server`) with a browser-bundle scan; the built server is started with
   `node .output/server/index.mjs` (no database setting) and checked for security headers on
   `/login`, `favicon.ico` and a hashed `/assets/*` file, a 404 for `/_headers`, and CSRF: its own
   login request replayed cross-site or without origin headers gets 403, same-origin gets 200.
   **INTERIM Quick Sales** (decision 0004; the dev server gets a throwaway random
   `SUMMARY_API_TOKEN`): staff sign in and land on `/quick-sales`; the first view is the
   opening-change form only, with no links; a second opening change is refused (replayed, and for
   a second staff member); sales with decimals ("1,800.50", "Saved ✓"); "1.005" and a missing
   payment are refused; own cancel; replayed cancels of another staff member's sale and of an
   11-minute-old sale are refused; staff pages and responses contain no totals or other people's
   sales; staff are sent back to `/quick-sales` from every `/owner` page, `/` and demo screens;
   all seven product functions replayed with a staff cookie answer "Not allowed.";
   `/owner/today` (totals, expected cash, every row with staff and status, date picker);
   `/api/daily-summary` is refused without a valid token (also with an owner cookie), returns the
   exact JSON with it, then answers 429 after 10 failures; staff log out.
5. Cleans up the copy, dev server and database (verified: nothing left running).

## Proving protections (required for security changes)

Temporarily remove one protection, run the specific test with `-t "<name>"` (include any setup
tests it depends on, e.g. "/login wrong password" opens the browser tab), confirm it fails for
the right reason, restore, and confirm a passing control run. Performed while building Steps
2a–3b (recorded in [CHANGELOG.md](CHANGELOG.md); not re-run on 2026-10-23) for: `requireOwner` on list
and create, archived filter, redirect allowlist, hydration guards, password clearing, index
check, index collation, normalization, cost in create response, client-supplied stock, session
expiry, owner-role check, attempt limit, inactive users, single-owner index, optimistic
concurrency. On 2026-10-24: `safeErrors` on `getDatabaseHealth` (source check in `db.test.ts`
failed when removed, passed when restored). Also on 2026-10-24, the ten login-hardening
protections listed in [CHANGELOG.md](CHANGELOG.md) (login-hardening commit `42518cc`), and on 2026-10-25 the ten
security-header protections listed there (security headers, commit `4711be0`). On 2026-10-27,
the seven client-address / per-account protections listed there (unit), plus trusting
`CF-Connecting-IP` off Workers (E2E: the spoofed replay signed in). On 2026-10-28, the
static-file route rule in `nitro.config.ts` (removed: the unit test failed with
`expected [] to deeply equal [ '/**' ]` and the E2E production-build test with
`built /favicon.ico: x-frame-options: expected null to be 'DENY'`; restored byte-identical). Also on 2026-10-28 (Step 7a), each restored byte-identical: revoke-all widened to every user,
sign-out-everywhere without revocation, the presented session kept at login, no session cap,
`lastSeenAt` written on every request, User-Agent not truncated, the legacy-session guard removed
(unit tests failed), the button wired to a plain logout and the CSRF middleware removed (E2E
failed: other device still signed in; built server answered 200 instead of 403). On 2026-10-31
(product edit/archive), each restored byte-identical: `requireOwner` removed from each of the
five list/edit/archive/restore functions (unit tests failed), from `updateProductForOwner` (E2E
endpoint test failed), and the `{ active: true }` list filter removed (unit and E2E failed).
Also on 2026-10-31 (Step 5c), each restored byte-identical, all caught by unit tests: the
atomic limit condition, window expiry, single-attempt cancel, undo on refusal, undo on a
verdict-less attempt, fail-closed on limiter errors, shared (not per-instance) keys, the TTL
index, trusting `x-vercel-forwarded-for` off Vercel, socket fallback on Vercel, loose `VERCEL`
detection, consulting later header entries, and `continue: true` on the Vercel baseline route.
On 2026-11-01 (money in satang), each restored byte-identical, all caught by unit tests: the
parser's 2-decimal rule ("1.005" was accepted as 105), the fraction scaling (padStart: "1800.5"
→ 180005), the migration's idempotency guard (update every product), dry run by default, and
the migration's blocking check.

On 2026-11-01 (interim Quick Sales), each restored byte-identical (checked with `cmp`), all
caught by unit tests: the staff permission guard (staff granted `quickSales.viewDay` in the
table: 3 tests failed; `requirePermission` skipping the table: 2 failed), the token check (the
comparison always true: 5 failed; the 32-character minimum removed: the fail-closed test
failed), the cancel-ownership rule (`userId` removed from the atomic filter: 2 failed), and the
leak guard (the staff list not limited to own sales: 2 failed; the day totals added to the staff
page: 4 failed). Control run: 41/41 passed. The E2E suite also caught a real gap while being
written: `/owner/products/new` rendered its empty form for staff (fixed: non-owners are sent to
`/login`, which sends staff to `/quick-sales`).

Also on 2026-11-01 (demo hidden by default): the production OFF default of `DEMO_ENABLED`
(changed to ON): the unit test and the E2E built-server check (`demo-section` on `/`) failed;
restored byte-identical. The E2E built server runs without the setting (OFF) and a second time
with `DEMO_ENABLED=true` (ON).

## Regenerating `src/routeTree.gen.ts` without loading `.env`

The router plugin regenerates it during `vite dev`/`vite build`, which load `.env` in the real
project. Instead: copy the project with
`git ls-files -z --cached --others --exclude-standard` into a temp folder (confirm no `.env*`
except `.env.example`), run `bun install --frozen-lockfile` and `node node_modules/vite/bin/vite.js build`
there with a minimal environment, then copy back only `src/routeTree.gen.ts`.

## Known test limitations

- E2E needs Chrome and ~95–105 s; it is opt-in.
- Transient UI states (e.g. a stale list shown for a few milliseconds) are invisible to one-off
  checks. Record them with a `MutationObserver` installed before the action, as the product
  creation test does (2026-10-27: a one-off check missed a 40/40 stale render 0/40 times).
- The per-address limit tests run up to ~40 real scrypt checks each, so they use a 60 s timeout.
  Each auth test starts with an empty `login_attempts` collection and a clock at the real current
  time (so TTL indexes never delete test records early); tests that share the process-wide
  hashing bound must not leave slots busy.
- `login-limiter.test.ts` starts its own mongodb-memory-server with `ttlMonitorSleepSecs=1`, so
  real TTL deletion is observed within seconds.
- The Vercel build is checked by building an isolated copy with `NITRO_PRESET=vercel` and reading
  `.vercel/output/config.json` (by hand, 2026-10-31); Vercel's routing itself is not exercised.
- Browser `SameSite` enforcement is shown via cookie attributes and CSRF replays, not a real
  cross-site page.
- Tests run under Node.js, the production runtime (decision
  [0001](decisions/0001-runtime-node-not-workers.md)). The real Atlas database is not exercised.
  HSTS is only unit-tested (E2E runs over http).
- _Historical (Workers target):_ the Workers branch of the client address is unit-tested by
  simulating `navigator.userAgent` only. The Cloudflare Workers runtime was checked once by
  hand in Step 4 (local workerd, 2026-10-28; see the decision record), not by the test suite.
- `server-errors.test.ts` imports `seroval`, a transitive dependency of TanStack Start.
- Normal `vite dev`/`vite build` in the real project are not run by agents (they load `.env`).
