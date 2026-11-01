# Project status

_Last verified: **2026-11-01** (interim Quick Sales), by inspecting the repository and running the checks below._
Update this file whenever the state changes. This file describes work by **step name**, not by
commit hash; see `git log` for commit hashes (and [CHANGELOG.md](CHANGELOG.md) for which commit
holds which finished step).

## Summary

Luxe Retail OS is a mobile-first POS / back-office app for a small shop in Thailand.

- **The demo** (all `_shell` screens: dashboard, checkout, sales, products, inventory, payments,
  cash drawer, approvals, audit, employees, reports, settings) is a **browser-only simulation**
  with fictional data in `localStorage` and simulated roles. VERIFIED. It is **OFF by default in
  production builds** (`DEMO_ENABLED`; `/` then shows only Sign in and demo screens redirect to
  `/login`), ON in dev and tests.
- **A real backend is being added alongside it** (TanStack Start server functions + MongoDB via
  Mongoose), currently covering: database connection, owner login, an owner product list
  (active and archived), and owner-only product creation, editing, archiving and restoring.
  VERIFIED in code and isolated tests.
- **Interim Quick Sales** (TEMPORARY, [decision 0004](decisions/0004-interim-quick-sales.md);
  retires when slice S9 lands): a `staff` role, a deny-by-default permission table
  (`requirePermission`), the staff page `/quick-sales` (opening change, add, "Your sales today":
  all own sales of today without totals, own cancel within 10 minutes), the owner page `/owner/today`
  (with owner cancel, soft-remove and restore, each with a reason), and `GET /api/daily-summary` (bearer token, for
  n8n later). VERIFIED in code, isolated tests and E2E. Not deployed.
- **Account scripts** (owner-run, CLI only): `auth:create-owner`, `auth:create-staff`,
  `auth:reset-password` (any account; revokes all its sessions). VERIFIED in isolated tests.
- **Not yet built:** real sales (0002 S9; Quick Sales is only a notebook), refunds, inventory movements, payments,
  employees, a general audit log, deployment. See [ROADMAP.md](ROADMAP.md).

## Git state (VERIFIED 2026-11-01)

| Item              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current branch    | `feature/mongodb-foundation`. Push status is not tracked in the docs; check `git status` / `git log origin/feature/mongodb-foundation..`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Committed work    | All of the following is committed on this branch (not merged into `main`): connection foundation, product model/service, Backend Steps 2a–3b, agent handbook and test-isolation hardening, login hardening, security headers, Step 1 (docs/tooling hygiene), Step 2 (login client address + per-account limit), Step 3 (stale product list fix), Step 5a (runtime decision record), Step 5b (build target Node server), Step 7a (session hardening), product edit/archive UI, Step 5c (Vercel variant: client address, MongoDB login limits, build preset), money in integer satang, interim Quick Sales (decision 0004), demo hidden by default in production, staff see their own sales for today, owner cancel and soft-remove, `auth:reset-password`, deploy checklist fixes |
| Uncommitted work  | None expected; check `git status`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Commit hashes     | See `git log --oneline main..feature/mongodb-foundation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `main`            | Not changed by the backend work; compare with `git log main..feature/mongodb-foundation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Local backup refs | `refs/original/refs/heads/master`, `refs/original-2/refs/heads/main`: pre-rewrite history with an old author identity. **Local only — never push, modify or delete them** without the owner's decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Pushing or merging the branch requires the owner's approval. The throwaway Step 4 branch
`spike/workers-runtime` and its worktree `../Nil_Ready_made-spike-workers` were never merged and
have been removed by the owner.

## Completed backend steps (VERIFIED in source and tests)

| Step                                | What exists                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Connection foundation           | `src/server/db.server.ts`: runtime `MONGODB_URI`, small pool, 5 s timeouts, sanitized errors; dev-only health check                                                                                                              |
| Product model + server-only service | `models/product.server.ts`, `products.server.ts` (validation, per-product minimum, cost hidden), isolated-DB tests with mongodb-memory-server                                                                                    |
| 2a — Owner auth core                | scrypt passwords, MongoDB sessions (token hash only, 7-day TTL), login limit (hardened 2026-10-24), single-owner index, local `auth:create-owner` script, dev server bound to `127.0.0.1`                                        |
| 2b — Request-flow integration       | `safeErrors` (no stack traces to the browser), `requireOwner` middleware, `getProductForOwner`, `/dev/auth`, opt-in isolated E2E suite                                                                                           |
| 2c — Login UI                       | `/login` (POST form, hydration-guarded), landing-page **Sign in** link (renamed 2026-11-01)                                                                                                                                      |
| 3a — Read-only product list         | `/owner/products` + `listProductsForOwner` (never returns cost); allowlisted `/login?redirect=/owner/products`                                                                                                                   |
| 3b — Product creation               | `/owner/products/new` + `createProductForOwner`; SKU/barcode normalization; stock always 0; case-insensitive unique indexes; creation fails closed until indexes exist; local `db:setup-indexes`                                 |
| Interim Quick Sales (decision 0004) | `staff` role + `auth:create-staff`; `src/lib/permissions.ts` + `requirePermission`; `/quick-sales`, `/owner/today`, `GET /api/daily-summary`; `opening_floats`, `quick_sales`. **Temporary** (retires at S9)                     |
| Password reset (CLI)                | `bun run auth:reset-password` (`scripts/reset-password.ts` → `resetPassword`): owner or staff; same policy and scrypt hash; changes only the password; revokes all of that account's sessions; tests in `reset-password.test.ts` |
| Product edit and archive UI         | `/owner/products/$productId/edit` + `getProductForEditing`/`updateProductForOwner`; Archive (confirmation) and Restore on `/owner/products`, Archived view; no delete; cost never loaded                                         |

Details: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md).

## Latest check results (VERIFIED 2026-11-01, with interim Quick Sales, unless dated)

| Command                                                   | Result                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx -y -p @typescript/native-preview tsgo --noEmit -p .` | exit 0 (2026-10-23)                                                                                                                                                                                                      |
| `bun run typecheck` (`tsc --noEmit -p .`)                 | exit 0                                                                                                                                                                                                                   |
| `bun run lint`                                            | 0 errors, 11 warnings (pre-existing `react-refresh/only-export-components`)                                                                                                                                              |
| `bun run format:check` (`prettier --check .`)             | exit 0, all files formatted                                                                                                                                                                                              |
| `bun run test`                                            | 23 files passed, 2 skipped; **336 tests passed, 0 failed, 57 skipped** (opt-in suites)                                                                                                                                   |
| `bun run test:e2e`                                        | **55 passed, 0 failed, 1 skipped** (Chrome-not-found placeholder)                                                                                                                                                        |
| Production smoke test (Step 5b)                           | Built with `node-server` in an isolated copy, started with `node .output/server/index.mjs` against a throwaway local `mongod`: login, empty list, create, row after reload; headers on pages, `favicon.ico`, `/assets/*` |
| Product-create E2E chain, 15× in a loop (Step 3)          | **15/15 passed** with the fix; with `staleReloadMode` removed the test failed (`shown: true`). See [CHANGELOG.md](CHANGELOG.md)                                                                                          |

**Former intermittent E2E failure: root-caused and fixed (Step 3).** After creating a product,
`/owner/products` briefly (11–38 ms) rendered the router's cached, stale list every time; the
E2E check only sometimes caught it. Fixed with `staleReloadMode: "blocking"` on the list
loader; the E2E test now observes every render. See [CHANGELOG.md](CHANGELOG.md).

Not run (they load `.env`): `bun run build`, `bun run dev`, `bun run test:db`, `bun run preview`. The E2E suite
builds production output in an isolated copy instead. See [TESTING.md](TESTING.md).

## Real environment state (NOT VERIFIED by agents)

- The owner reported that `bun run test:db` passed against a non-production Atlas database
  (connection foundation only). Agents have never connected to Atlas.
- **No real owner account** has been created by an agent (`bun run auth:create-owner` not run).
- **`bun run db:migrate-money-satang` has not been run** on any real database (agents never run
  it). Products created before 2026-11-01 store whole baht in `price`/`minimumSellingPrice`/`cost`
  and are not readable as prices by this version until the owner runs it (dry run first, then
  `--apply`). A database with no products needs nothing.
- **No staff account** has been created by an agent (`bun run auth:create-staff` not run), and
  **`SUMMARY_API_TOKEN` is not set anywhere** by an agent. Without it `/api/daily-summary`
  answers 503 to every request (fail closed).
- **`bun run db:setup-indexes` has not been run on Atlas** (or any hosted database), so product
  creation there refuses with "Product setup is incomplete" until the owner runs it. This is
  intended. With the owner's approval (2026-11-01) an agent ran it once against the owner's
  **local** podman database `luxe-mongo` (`127.0.0.1`, replica set `rs0`); it succeeded.
- **`bun run auth:reset-password` has never been run** by an agent on any real database.
- **Runtime decision (2026-10-28):** production runs as a **Node.js server** (Node LTS), not
  Cloudflare Workers; see [decisions/0001](decisions/0001-runtime-node-not-workers.md). The
  hosting provider is not chosen (paused by the owner). Step 5b switches the build from the
  Lovable default (Nitro `cloudflare-module`) to Nitro `node-server` (done 2026-10-28).

## Next approved action

None. Interim Quick Sales (decision 0004) is committed; it retires when slice S9 lands (see
[ROADMAP.md](ROADMAP.md#retirement-of-interim-quick-sales-when-slice-s9-lands)). Money in integer satang is committed; **all money is integer satang; never floats** (ARCHITECTURE.md#money). Step 5c (Vercel variant, decision 0003) is committed but **not deployed**; deploying is the owner's checklist [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md). The product edit/archive UI is committed; Step 7a (session hardening) is committed; Step 7b (idle timeout / PIN lock) is planned with the employee design, not approved. Step 4 (Workers runtime test) is done:
its result is decision 0001; its throwaway branch and worktree have been removed. Merging the branch needs the owner's approval. Backend Step 3c has **not** been approved. Wait
for the owner's explicit approval and scope before implementing anything new. Candidate next
steps are listed (unapproved) in [ROADMAP.md](ROADMAP.md).

## Outstanding limitations

- The branch is not merged into `main`.
- Login client address (Step 2): the socket address on the Node.js server; no shared fallback
  bucket; per-account limit 50 / 15 min. **Required before any real deployment:** trusted-proxy
  handling. Behind a reverse proxy, Cloudflare proxy or Tunnel all visitors share the proxy's
  address and the per-address limit becomes a global lockout (see [ROADMAP.md](ROADMAP.md)).
  The `CF-Connecting-IP` branch for Workers is historical (candidate for removal).
- Sessions: no idle timeout yet (Step 7b); the 5-session cap is soft under simultaneous logins;
  the TTL index that deletes expired sessions (and their IP/User-Agent) exists only where
  `db:setup-indexes` has run.
- Product edits: overlapping saves are refused ("changed at the same time"), but a form opened
  before someone else saved is not detected; the later save wins (the service takes no expected
  version). SKU and variants cannot be edited (service rule).
- `/owner/products/new` navigates to the list after a create without calling
  `router.invalidate()`; the list is fresh only because its loader uses blocking reload. See the
  invalidation rule in [ARCHITECTURE.md](ARCHITECTURE.md#router-data-after-mutations).
- Demo screens still use simulated data and roles; the real product pages are separate.
- Interim Quick Sales: no general audit log (owner cancel and remove do record who, when and the
  reason on the entry itself; nothing is ever deleted), no staff disable page (set `active: false` in the database),
  no shifts or time windows; item text is free text, not linked to products or stock. Staff use
  the normal 7-day password session. The staff page is `/quick-sales` because the demo owns
  `/sales`. Real staff recording real sales on the Vercel **Hobby** test deployment would
  conflict with decision 0003 (personal, non-commercial, test data only).
- No general audit log, inventory-movement history or employee accounts (0002). Password reset
  exists only as the owner-run CLI `bun run auth:reset-password` (no self-service reset).
- Login attempt limits are stored in MongoDB (shared, survive restarts; fail closed). The
  hashing bound is still in memory per process; a flood that fills it makes logins answer "Too
  many attempts" until it stops.
- Vercel (decision 0003) is for personal testing only and has **not been deployed**; Atlas would
  need `0.0.0.0/0`. Header routing, doubled headers, HSTS scheme and the
  `x-vercel-forwarded-for` overwrite are unverified until the owner's smoke test
  ([DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)).
- The production cookie (`__Host-luxe_session`, `Secure`) requires HTTPS.
- Security headers: no full Content-Security-Policy yet; HSTS off until the owner sets
  `SECURITY_HSTS_MAX_AGE` after verifying HTTPS.
- Product SKUs and variant SKUs are unique within their own index, not against each other.
- Hosting provider, Atlas IP allowlisting for it, and backups are unresolved.
- The production server listens on all interfaces unless `HOST` is set (see
  [SECURITY.md](SECURITY.md#development-access)).
- Workers-only code kept for now (candidates for removal): the `navigator.userAgent` Workers
  detection in `db.server.ts` and `client-address.server.ts`, and the `punycode/` alias in
  `nitro.config.ts`.
