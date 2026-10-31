# Project status

_Last verified: **2026-10-31** (Step 5c), by inspecting the repository and running the checks below._
Update this file whenever the state changes. This file describes work by **step name**, not by
commit hash; see `git log` for commit hashes (and [CHANGELOG.md](CHANGELOG.md) for which commit
holds which finished step).

## Summary

Luxe Retail OS is a mobile-first POS / back-office app for a small shop in Thailand.

- **The demo** (all `_shell` screens: dashboard, checkout, sales, products, inventory, payments,
  cash drawer, approvals, audit, employees, reports, settings) is a **browser-only simulation**
  with fictional data in `localStorage` and simulated roles. VERIFIED.
- **A real backend is being added alongside it** (TanStack Start server functions + MongoDB via
  Mongoose), currently covering: database connection, owner login, an owner product list
  (active and archived), and owner-only product creation, editing, archiving and restoring.
  VERIFIED in code and isolated tests.
- **Not yet built:** sales, refunds, inventory movements, payments,
  employees, audit log, password reset, deployment. See [ROADMAP.md](ROADMAP.md).

## Git state (VERIFIED 2026-10-29, local repository only)

| Item              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current branch    | `feature/mongodb-foundation`. Push status is not tracked in the docs; check `git status` / `git log origin/feature/mongodb-foundation..`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Committed work    | All of the following is committed on this branch (not merged into `main`): connection foundation, product model/service, Backend Steps 2a–3b, agent handbook and test-isolation hardening, login hardening, security headers, Step 1 (docs/tooling hygiene), Step 2 (login client address + per-account limit), Step 3 (stale product list fix), Step 5a (runtime decision record), Step 5b (build target Node server), Step 7a (session hardening), product edit/archive UI, Step 5c (Vercel variant: client address, MongoDB login limits, build preset) |
| Uncommitted work  | None expected; check `git status`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Commit hashes     | See `git log --oneline main..feature/mongodb-foundation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `main`            | Not changed by the backend work; compare with `git log main..feature/mongodb-foundation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Local backup refs | `refs/original/refs/heads/master`, `refs/original-2/refs/heads/main`: pre-rewrite history with an old author identity. **Local only — never push, modify or delete them** without the owner's decision                                                                                                                                                                                                                                                                                                                                                     |

Pushing or merging the branch requires the owner's approval. The throwaway Step 4 branch
`spike/workers-runtime` and its worktree `../Nil_Ready_made-spike-workers` were never merged and
have been removed by the owner.

## Completed backend steps (VERIFIED in source and tests)

| Step                                | What exists                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Connection foundation           | `src/server/db.server.ts`: runtime `MONGODB_URI`, small pool, 5 s timeouts, sanitized errors; dev-only health check                                                                              |
| Product model + server-only service | `models/product.server.ts`, `products.server.ts` (validation, per-product minimum, cost hidden), isolated-DB tests with mongodb-memory-server                                                    |
| 2a — Owner auth core                | scrypt passwords, MongoDB sessions (token hash only, 7-day TTL), login limit (hardened 2026-10-24), single-owner index, local `auth:create-owner` script, dev server bound to `127.0.0.1`        |
| 2b — Request-flow integration       | `safeErrors` (no stack traces to the browser), `requireOwner` middleware, `getProductForOwner`, `/dev/auth`, opt-in isolated E2E suite                                                           |
| 2c — Login UI                       | `/login` (POST form, hydration-guarded), landing-page "Owner sign-in (real account)" link                                                                                                        |
| 3a — Read-only product list         | `/owner/products` + `listProductsForOwner` (never returns cost); allowlisted `/login?redirect=/owner/products`                                                                                   |
| 3b — Product creation               | `/owner/products/new` + `createProductForOwner`; SKU/barcode normalization; stock always 0; case-insensitive unique indexes; creation fails closed until indexes exist; local `db:setup-indexes` |
| Product edit and archive UI         | `/owner/products/$productId/edit` + `getProductForEditing`/`updateProductForOwner`; Archive (confirmation) and Restore on `/owner/products`, Archived view; no delete; cost never loaded         |

Details: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md).

## Latest check results (VERIFIED 2026-10-31, with Step 5c, unless dated)

| Command                                                   | Result                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx -y -p @typescript/native-preview tsgo --noEmit -p .` | exit 0 (2026-10-23)                                                                                                                                                                                                      |
| `bun run typecheck` (`tsc --noEmit -p .`)                 | exit 0                                                                                                                                                                                                                   |
| `bun run lint`                                            | 0 errors, 11 warnings (pre-existing `react-refresh/only-export-components`)                                                                                                                                              |
| `bun run format:check` (`prettier --check .`)             | exit 0, all files formatted                                                                                                                                                                                              |
| `bun run test`                                            | 17 files passed, 2 skipped; **268 tests passed, 0 failed, 46 skipped** (opt-in suites)                                                                                                                                   |
| `bun run test:e2e`                                        | **44 passed, 0 failed, 1 skipped** (Chrome-not-found placeholder)                                                                                                                                                        |
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
- **`bun run db:setup-indexes` has not been run** on the real database, so real product creation
  will refuse with "Product setup is incomplete" until the owner runs it. This is intended.
- **Runtime decision (2026-10-28):** production runs as a **Node.js server** (Node LTS), not
  Cloudflare Workers; see [decisions/0001](decisions/0001-runtime-node-not-workers.md). The
  hosting provider is not chosen (paused by the owner). Step 5b switches the build from the
  Lovable default (Nitro `cloudflare-module`) to Nitro `node-server` (done 2026-10-28).

## Next approved action

None. Step 5c (Vercel variant, decision 0003) is committed but **not deployed**; deploying is the owner's checklist [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md). The product edit/archive UI is committed; Step 7a (session hardening) is committed; Step 7b (idle timeout / PIN lock) is planned with the employee design, not approved. Step 4 (Workers runtime test) is done:
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
- No audit log, inventory-movement history, employee accounts or password reset.
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
