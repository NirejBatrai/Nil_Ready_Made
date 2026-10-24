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

| Item                            | Value                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current branch                  | `feature/mongodb-foundation`; working tree clean after the login-hardening commit `fix: harden login rate limiting and password hashing` (on top of `9b961e1`). No upstream configured; **not pushed** (no push made or recorded locally; GitHub not checked)                                                |
| Commits on branch, newest first | `fix: harden login rate limiting and password hashing`; `9b961e1` docs: record completed foundation commits; `4da3c13` docs: add AI agent handbook and harden test isolation; `ced5535` feat: add secure owner authentication and product management foundation; `722d86f` Add MongoDB connection foundation |
| `main`                          | `49aba5c`; matches `origin/main` according to the local remote-tracking ref (last updated 2026-10-23, not re-fetched)                                                                                                                                                                                        |
| Commits on branch not on `main` | `722d86f`, `ced5535`, `4da3c13`, `9b961e1`, and the login-hardening commit (see `git log`)                                                                                                                                                                                                                   |
| Local backup refs               | `refs/original/refs/heads/master`, `refs/original-2/refs/heads/main`: pre-rewrite history with an old author identity. **Local only — never push, modify or delete them** without the owner's decision                                                                                                       |

> **Committed, not pushed:** login hardening (atomic attempt counting, per-address limit,
> bounded password hashing), its tests and docs, in commit `fix: harden login rate limiting and password hashing`. See
> [CHANGELOG.md](CHANGELOG.md).
>
> **Committed, not pushed.** The product model/service step and Backend Steps 2a–3b are in
> commit `ced5535`; the handbook (`AGENTS.md`, `docs/`) and the audit hardening (`envDir: false`
> in `vitest.config.ts`, `safeErrors` on `getDatabaseHealth`) are in `4da3c13`. Both exist only on
> the local branch `feature/mongodb-foundation`. Pushing or merging requires the owner's approval.

## Completed backend steps (VERIFIED in source and tests)

| Step                                         | What exists                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Connection foundation (commit `722d86f`) | `src/server/db.server.ts`: runtime `MONGODB_URI`, small pool, 5 s timeouts, sanitized errors; dev-only health check                                                                              |
| Product model + server-only service          | `models/product.server.ts`, `products.server.ts` (validation, per-product minimum, cost hidden), isolated-DB tests with mongodb-memory-server                                                    |
| 2a — Owner auth core                         | scrypt passwords, MongoDB sessions (token hash only, 7-day TTL), login limit (hardened 2026-10-24), single-owner index, local `auth:create-owner` script, dev server bound to `127.0.0.1`        |
| 2b — Request-flow integration                | `safeErrors` (no stack traces to the browser), `requireOwner` middleware, `getProductForOwner`, `/dev/auth`, opt-in isolated E2E suite                                                           |
| 2c — Login UI                                | `/login` (POST form, hydration-guarded), landing-page "Owner sign-in (real account)" link                                                                                                        |
| 3a — Read-only product list                  | `/owner/products` + `listProductsForOwner` (never returns cost); allowlisted `/login?redirect=/owner/products`                                                                                   |
| 3b — Product creation                        | `/owner/products/new` + `createProductForOwner`; SKU/barcode normalization; stock always 0; case-insensitive unique indexes; creation fails closed until indexes exist; local `db:setup-indexes` |

Product model/service and Steps 2a–3b: commit `ced5535`. Handbook and hardening: commit `4da3c13`.

Details: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md).

## Latest check results (VERIFIED 2026-10-24 unless dated)

| Command                                                   | Result                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npx -y -p @typescript/native-preview tsgo --noEmit -p .` | exit 0 (2026-10-23)                                                                    |
| `bunx tsc --noEmit -p .` (run as `npx tsc --noEmit -p .`) | exit 0                                                                                 |
| `bun run lint`                                            | 0 errors, 11 warnings (pre-existing `react-refresh/only-export-components`)            |
| `bun run test`                                            | 12 files passed, 2 skipped; **175 tests passed, 0 failed, 36 skipped** (opt-in suites) |
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

**None.** Pushing or merging the branch needs the owner's approval. Backend Step 3c has **not** been approved. Wait for the owner's explicit approval and
scope before implementing anything new. Candidate next steps are listed (unapproved) in
[ROADMAP.md](ROADMAP.md).

## Outstanding limitations

- Commits `722d86f`, `ced5535` and `4da3c13` are local only (not pushed or merged into `main`).
- Demo screens still use simulated data and roles; the real product pages are separate.
- No audit log, inventory-movement history, employee accounts or password reset.
- Login attempt limits and the hashing bound are in-memory (reset on restart, per process); a
  flood that fills the hashing bound makes logins answer "Too many attempts" until it stops.
- The production cookie (`__Host-luxe_session`, `Secure`) requires HTTPS.
- Product SKUs and variant SKUs are unique within their own index, not against each other.
- Cloudflare Workers runtime, Atlas IP allowlisting for hosting, and backups are unresolved.
