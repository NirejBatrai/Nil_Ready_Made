# Changelog

Dated record of completed work, decisions, test evidence and corrections. Newest first.
Commit hashes refer to this repository; "uncommitted" means the work exists only in the
working tree (see [PROJECT_STATUS.md](PROJECT_STATUS.md)).

## 2026-10-24 — Handbook audit corrections and hardening (uncommitted)

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

## 2026-10-23 — Documentation system

- Added `AGENTS.md` (rewritten as the agent entry point) and `docs/` (`PROJECT_STATUS`,
  `ARCHITECTURE`, `SECURITY`, `TESTING`, `ROADMAP`, `CHANGELOG`). Documentation only.
- Re-verified: `tsc`/`tsgo` exit 0; lint 0 errors / 11 warnings; `bun run test` 160 passed,
  0 failed, 36 skipped; `bun run test:e2e` 34 passed, 0 failed, 1 skipped.

## 2026-10-23 — Backend Step 3b: owner-only product creation (uncommitted)

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

## 2026-10-23 — Backend Step 3a: read-only owner product list (uncommitted)

- `/owner/products` + `listProductsForOwner` (never returns cost); `/login?redirect=` allowlists
  exactly `/owner/products`; "Manage products (real data)" link.
- Correction: a first combined mutation run was invalid (filtered tests skipped their setup);
  redone one protection at a time with control runs.

## 2026-10-23 — Backend Step 2c: login UI (uncommitted)

- `/login` (POST form, hydration-guarded submit, password cleared each attempt, friendly
  database errors) and a landing-page "Owner sign-in (real account)" link.
- Correction: the first hydration-guard test always passed because Button CSS classes contain
  the word "disabled"; fixed to check the `disabled=""` attribute.

## 2026-10-23 — Backend Step 2b: request-flow integration (uncommitted)

- Found: thrown server-function errors reach the browser with stack traces (Seroval). Added
  `safeErrors` as the first middleware everywhere; validators never throw.
- `getProductForOwner` (owner-only), `/dev/auth`, opt-in isolated E2E (`bun run test:e2e`);
  dev-dependency `playwright-core@1.64.1`.

## 2026-10-23 — Product model and server-only product service (uncommitted)

- `src/server/models/product.server.ts` and `src/server/products.server.ts`: Zod-validated
  input, `productPricingError` (per-product minimum; owner confirmed there is **no** universal
  ฿350 minimum), cost `select: false`, optimistic concurrency, pricing changes only via `save()`.
- Dev-dependency `mongodb-memory-server@11.3.0` for isolated database tests.

## 2026-10-23 — Backend Step 2a: owner authentication core (uncommitted)

- scrypt hashing, MongoDB sessions (token hash only, 7-day TTL), in-memory attempt limit
  (5 / email+IP / 15 min), `single_owner` index, local `bun run auth:create-owner`, dev server
  bound to `127.0.0.1`. Employee accounts, audit, password reset postponed by the owner.

## 2026-10-23 — Backend Step 1: MongoDB connection foundation (`722d86f`, local branch, no upstream)

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
