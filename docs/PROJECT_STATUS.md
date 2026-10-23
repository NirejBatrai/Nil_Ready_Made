# Project status

_Last verified: **2026-10-24**, by inspecting the repository and running the checks below._
Update this file whenever the state changes.

## Summary

Luxe Retail OS is a mobile-first POS / back-office app for a small shop in Thailand.

- **The demo** (all `_shell` screens: dashboard, checkout, sales, products, inventory, payments,
  cash drawer, approvals, audit, employees, reports, settings) is a **browser-only simulation**
  with fictional data in `localStorage` and simulated roles. VERIFIED.
- **A real backend is being added alongside it** (TanStack Start server functions + MongoDB via
  Mongoose), currently covering: database connection, owner login, a read-only owner product
  list, and owner-only product creation. VERIFIED in code and isolated tests.
- **Not yet built:** product editing/archiving UI, sales, refunds, inventory movements, payments,
  employees, audit log, password reset, deployment. See [ROADMAP.md](ROADMAP.md).

## Git state (VERIFIED 2026-10-24, local repository only)

| Item                            | Value                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current branch                  | `feature/mongodb-foundation` (no upstream configured; no push recorded locally; GitHub not checked)                                                                                                    |
| Last commit on branch           | `722d86f` Add MongoDB connection foundation                                                                                                                                                            |
| `main`                          | `49aba5c`; matches `origin/main` according to the local remote-tracking ref (last updated 2026-10-23, not re-fetched)                                                                                  |
| Commits on branch not on `main` | 1 (`722d86f`)                                                                                                                                                                                          |
| Local backup refs               | `refs/original/refs/heads/master`, `refs/original-2/refs/heads/main`: pre-rewrite history with an old author identity. **Local only — never push, modify or delete them** without the owner's decision |

> **WARNING — large uncommitted work.** The product model/service step and Backend Steps 2a–3b (authentication, login UI, owner
> product list, product creation, index setup, and their tests) exist **only as uncommitted and
> untracked files** in the working tree:
> modified `bun.lock`, `package.json`, `src/routeTree.gen.ts`, `src/routes/index.tsx`,
> `tsconfig.json`, `vite.config.ts`; untracked `scripts/`, `src/lib/{auth,products,server-errors}.ts`,
> `src/routes/{dev.auth,login,owner.products,owner.products_.new}.tsx`, `src/server/auth/`,
> `src/server/models/`, `src/server/products.server.ts`, and five new test files.
> The handbook and its audit follow-up are also uncommitted: modified `AGENTS.md`,
> `vitest.config.ts`, `src/lib/db-health.ts`, `src/test/db.test.ts`; untracked `docs/`.
> **Never discard, reset, stash or overwrite them.** Committing them requires the owner's approval.

## Completed backend steps (VERIFIED in source and tests)

| Step                                            | What exists                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Connection foundation (committed `722d86f`) | `src/server/db.server.ts`: runtime `MONGODB_URI`, small pool, 5 s timeouts, sanitized errors; dev-only health check                                                                              |
| Product model + server-only service             | `models/product.server.ts`, `products.server.ts` (validation, per-product minimum, cost hidden), isolated-DB tests with mongodb-memory-server                                                    |
| 2a — Owner auth core                            | scrypt passwords, MongoDB sessions (token hash only, 7-day TTL), login limit, single-owner index, local `auth:create-owner` script, dev server bound to `127.0.0.1`                              |
| 2b — Request-flow integration                   | `safeErrors` (no stack traces to the browser), `requireOwner` middleware, `getProductForOwner`, `/dev/auth`, opt-in isolated E2E suite                                                           |
| 2c — Login UI                                   | `/login` (POST form, hydration-guarded), landing-page "Owner sign-in (real account)" link                                                                                                        |
| 3a — Read-only product list                     | `/owner/products` + `listProductsForOwner` (never returns cost); allowlisted `/login?redirect=/owner/products`                                                                                   |
| 3b — Product creation                           | `/owner/products/new` + `createProductForOwner`; SKU/barcode normalization; stock always 0; case-insensitive unique indexes; creation fails closed until indexes exist; local `db:setup-indexes` |

Details: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md).

## Latest check results (VERIFIED 2026-10-24 unless dated)

| Command                                                   | Result                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npx -y -p @typescript/native-preview tsgo --noEmit -p .` | exit 0 (2026-10-23)                                                                    |
| `bunx tsc --noEmit -p .` (run as `npx tsc --noEmit -p .`) | exit 0                                                                                 |
| `bun run lint`                                            | 0 errors, 11 warnings (pre-existing `react-refresh/only-export-components`)            |
| `bun run test`                                            | 12 files passed, 2 skipped; **161 tests passed, 0 failed, 36 skipped** (opt-in suites) |
| `bun run test:e2e`                                        | **34 passed, 0 failed, 1 skipped** (Chrome-not-found placeholder)                      |

Not run (they load `.env`): `bun run build`, `bun run dev`, `bun run test:db`, `bun run preview`. The E2E suite
builds production output in an isolated copy instead. See [TESTING.md](TESTING.md).

## Real environment state (NOT VERIFIED by agents)

- The owner reported that `bun run test:db` passed against a non-production Atlas database
  (connection foundation only). Agents have never connected to Atlas.
- **No real owner account** has been created by an agent (`bun run auth:create-owner` not run).
- **`bun run db:setup-indexes` has not been run** on the real database, so real product creation
  will refuse with "Product setup is incomplete" until the owner runs it. This is intended.
- Hosting/deployment is **paused** by the owner. The build target is still the Lovable default
  (Nitro `cloudflare-module`); a Node.js host was recommended but not adopted.

## Next approved action

**None.** Backend Step 3c has **not** been approved. Wait for the owner's explicit approval and
scope before implementing anything new. Candidate next steps are listed (unapproved) in
[ROADMAP.md](ROADMAP.md).

## Outstanding limitations

- All backend work since `722d86f` is uncommitted (see warning above).
- Demo screens still use simulated data and roles; the real product pages are separate.
- No audit log, inventory-movement history, employee accounts or password reset.
- Login attempt limit is in-memory (resets on restart, single process).
- The production cookie (`__Host-luxe_session`, `Secure`) requires HTTPS.
- Product SKUs and variant SKUs are unique within their own index, not against each other.
- Cloudflare Workers runtime, Atlas IP allowlisting for hosting, and backups are unresolved.
