# Testing

_Commands VERIFIED from `package.json` and by running them on 2026-10-23 and 2026-10-24._

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
- `setup-indexes.test.ts` runs the script in an empty temp folder; the E2E suite runs in a copy
  without `.env`.
- The only exception is the opt-in `test:db`, which calls `loadEnv` itself for `MONGODB_*`.

## Commands

| Purpose                  | Command                                                   | Loads `.env`?          | Verified result (2026-10-23)             |
| ------------------------ | --------------------------------------------------------- | ---------------------- | ---------------------------------------- |
| Type check               | `bunx tsc --noEmit -p .`                                  | No                     | exit 0                                   |
| Type check (fast)        | `npx -y -p @typescript/native-preview tsgo --noEmit -p .` | No                     | exit 0                                   |
| Lint                     | `bun run lint`                                            | No                     | 0 errors, 11 warnings (pre-existing)     |
| Unit + integration       | `bun run test`                                            | No (`envDir: false`)   | 203 passed, 0 failed, 37 skipped (10-25) |
| Watch mode               | `bun run test:watch`                                      | No (`envDir: false`)   | not run                                  |
| **E2E (opt-in)**         | `bun run test:e2e`                                        | **No** (isolated copy) | 35 passed, 0 failed, 1 skipped (10-25)   |
| Live Atlas ping (opt-in) | `bun run test:db`                                         | **Yes**                | NOT run by agents; owner reported a pass |
| Production build         | `bun run build`                                           | **Yes**                | NOT run in the real project by agents    |
| Dev server               | `bun run dev`                                             | **Yes**                | NOT run in the real project by agents    |
| Preview build            | `bun run preview`                                         | Likely (NOT VERIFIED)  | NOT run by agents                        |
| Format files             | `bunx prettier --write <files>`                           | No                     | used on changed files                    |

Do not run the `.env`-loading commands unless the owner asks; prefer that the owner runs them.
If `bunx` is not on `PATH`, `npx tsc --noEmit -p .` and `npx -y bun@1 x prettier …` are equivalent.

## What the suites cover

`bun run test` (Vitest, `src/test/*.test.ts[x]`, jsdom by default; DB tests use
`// @vitest-environment node`):

| File                                                                                                                  | Covers                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calc.test.ts`, `pricing.test.ts`, `metrics.test.ts`, `demo-seed.test.ts`, `workflow.test.ts`, `app-routing.test.tsx` | Demo business rules (pricing/minimum price, metrics, fixtures, workflows, routing)                                                                                                                                                                       |
| `products-ui.test.tsx`                                                                                                | Demo Products screen shows the owner-only lock for employees (UI only)                                                                                                                                                                                   |
| `db.test.ts`                                                                                                          | Connection module with fakes (reuse, cleanup, sanitized errors, health check)                                                                                                                                                                            |
| `products.server.test.ts`                                                                                             | Product model/service on isolated DB: pricing, normalization, case-insensitive uniqueness (incl. raw writes), 10-way concurrent duplicates, fail-closed indexes, cost hiding, no index creation by app code                                              |
| `setup-indexes.test.ts`                                                                                               | Runs `scripts/setup-indexes.ts` under Bun on isolated DBs: creates, idempotent, refuses on conflicts/unnormalized data without changing it, stops on index-definition conflicts                                                                          |
| `auth.test.ts`                                                                                                        | Passwords, login, attempt limits (simultaneous attempts, per-address/email rotation, IPv6 /64, database-down and hashing-busy un-counting), hashing concurrency bound, sessions/expiry, owner authorization, single owner, cookie options, config checks |
| `security-headers.test.ts`                                                                                            | Security headers: values, no-store, redirect/Set-Cookie/stream copying, HSTS gating and setting parsing, every return path of `src/server.ts` (mocked entry), `public/_headers` in sync                                                                  |
| `server-errors.test.ts`                                                                                               | `toSafeError` and the real serializer payload (no stack)                                                                                                                                                                                                 |
| `db.integration.test.ts`                                                                                              | Opt-in live ping (skipped unless `RUN_DB_INTEGRATION=1`)                                                                                                                                                                                                 |
| `auth.e2e.test.ts`                                                                                                    | Opt-in E2E (skipped unless `RUN_AUTH_E2E=1`)                                                                                                                                                                                                             |

`bun run test:e2e` (`src/test/auth.e2e.test.ts`) — fails closed if isolation cannot be confirmed:

1. Copies the repo to a temp folder from `git ls-files --cached --others --exclude-standard`
   (ignored files such as `.env` are never copied; aborts if any env-like file appears).
2. `bun install --frozen-lockfile` in the copy; starts mongodb-memory-server on `127.0.0.1`.
3. Runs the real `vite dev` in the copy with a fresh environment whose only `MONGODB_URI` is the
   throwaway database; drives Chrome via playwright-core and replays captured requests.
4. Covers: `127.0.0.1` binding, login/logout/expiry, cookie attributes, CSRF (403), attempt limit,
   `/login` UI, `/owner/products` (guards, no cost, loading/empty/error states),
   `/owner/products/new` (creation, validation, duplicates, 5-way concurrent replays,
   server-controlled fields rejected), demo unchanged, leak scan of every response, security
   headers on pages, 404s, redirects, signed-in owner pages, server functions, CSRF 403s and
   database-down pages (exact values; no HSTS over http; `favicon.ico` bypasses the app), and a production build
   of the copy with a browser-bundle scan and a `.output/public/_headers` check.
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
protections listed in [CHANGELOG.md](CHANGELOG.md) (login-hardening commit), and on 2026-10-25 the ten
security-header protections listed there (security headers, uncommitted).

## Regenerating `src/routeTree.gen.ts` without loading `.env`

The router plugin regenerates it during `vite dev`/`vite build`, which load `.env` in the real
project. Instead: copy the project with
`git ls-files -z --cached --others --exclude-standard` into a temp folder (confirm no `.env*`
except `.env.example`), run `bun install --frozen-lockfile` and `node node_modules/vite/bin/vite.js build`
there with a minimal environment, then copy back only `src/routeTree.gen.ts`.

## Known test limitations

- E2E needs Chrome and ~95 s; it is opt-in.
- The per-address limit tests run up to ~40 real scrypt checks each, so they use a 60 s timeout.
  Each auth test gets fresh limiters; tests that share the process-wide hashing bound must not
  leave slots busy.
- Browser `SameSite` enforcement is shown via cookie attributes and CSRF replays, not a real
  cross-site page.
- The Cloudflare Workers runtime and the real Atlas database are not exercised by tests. HSTS is
  only unit-tested (E2E runs over http in dev mode); Cloudflare's handling of `_headers` is not
  tested.
- `server-errors.test.ts` imports `seroval`, a transitive dependency of TanStack Start.
- Normal `vite dev`/`vite build` in the real project are not run by agents (they load `.env`).
