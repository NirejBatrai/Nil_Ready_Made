# Roadmap

Status labels: **DONE** (verified in code/tests), **PENDING** (not started), **PLANNED**
(discussed, not approved). Every new phase or sub-step needs the owner's **explicit approval**
before implementation, even if it is listed here. Approval of one step does not approve the next.

_Last updated 2026-10-28._ This file supersedes the root `roadmap.md` (demo-era checklist).

**Runtime target: a Node.js server** (Node LTS), not Cloudflare Workers. See
[decisions/0001-runtime-node-not-workers.md](decisions/0001-runtime-node-not-workers.md).
Workers-specific statements elsewhere in the docs are historical.

## Completed

| Phase                                                                                         | Status | Notes                                                                        |
| --------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Demo app (all screens, simulated roles, fictional data)                                       | DONE   | Browser-only; not a security boundary                                        |
| Phase One demo fixes (drawer/audit actors, deterministic reset, chart metrics, mobile layout) | DONE   | Committed on `main`                                                          |
| Per-product minimum selling price (demo checkout + rules in `calc.ts`)                        | DONE   | Committed on `main`                                                          |
| Repository prepared for private GitHub (no Lovable sync)                                      | DONE   | `main` = `origin/main` (local tracking ref)                                  |
| Backend Step 1 — MongoDB connection foundation                                                | DONE   | Commit `722d86f`                                                             |
| Product model + server-only product service                                                   | DONE   | Commit `ced5535`                                                             |
| Backend Step 2a — owner auth core, local owner script, dev bound to `127.0.0.1`               | DONE   | Commit `ced5535`                                                             |
| Backend Step 2b — `safeErrors`, `requireOwner`, isolated E2E suite                            | DONE   | Commit `ced5535`                                                             |
| Backend Step 2c — `/login` UI                                                                 | DONE   | Commit `ced5535`                                                             |
| Backend Step 3a — read-only `/owner/products`                                                 | DONE   | Commit `ced5535`                                                             |
| Backend Step 3b — owner-only product creation + `db:setup-indexes`                            | DONE   | Commit `ced5535`                                                             |
| Handbook (`AGENTS.md`, `docs/`) + audit hardening (`envDir: false`, `safeErrors` on health)   | DONE   | Commit `4da3c13`                                                             |
| Login hardening (atomic attempt counting, per-address limit, bounded password hashing)        | DONE   | Commit `42518cc`                                                             |
| Baseline security headers (`src/server.ts`, `public/_headers`, HSTS off by default)           | DONE   | Commit `4711be0`; `public/_headers` was Cloudflare-only; replaced in Step 5b |

| Step 7a — session hardening: revoke all sessions, "Sign out everywhere", old session deleted at login, 5-session cap, `createdIp`/`userAgent`/`lastSeenAt` | DONE | Committed 2026-10-28 |
| Step 5b — build target Nitro `node-server`; static-file headers from a `nitro.config.ts` route rule (`public/_headers` removed) | DONE | Committed 2026-10-28 |
| Step 4 — time-boxed Workers runtime test (local workerd, branch `spike/workers-runtime`, not merged) | DONE | Result: move to a Node server, [decision 0001](decisions/0001-runtime-node-not-workers.md) |

## Required before any real deployment

| Item                                                                                                                                                                                                                                                                      | Depends on     | Approval gate                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------- |
| **Trusted-proxy handling for the chosen host.** Behind Cloudflare proxy or Tunnel, all requests share one address and the per-address limit becomes a global lockout. (Also: HSTS is never sent when the proxy forwards plain `http`.) Design pending the hosting choice. | Hosting choice | New step approval             |
| **Run `bun run db:setup-indexes` as part of every deploy** (session TTL cleanup, unique email, single owner, product indexes). Without the TTL index expired sessions (with their IP/User-Agent) are never deleted.                                                       | Hosting choice | Owner runs it (real database) |

## Pending (none approved)

**Step 7b (PLANNED, not approved):** session idle timeout / PIN lock policy for shared shop
devices (e.g. shorter employee lifetimes, idle expiry from `lastSeenAt`), to be decided together
with the employee-account design.

**Backend Step 3c is NOT approved.** Do not start it. Its scope has not been defined by the owner.

| Step            | Status                                          |
| --------------- | ----------------------------------------------- |
| Backend Step 3c | **AWAITING OWNER APPROVAL** (scope not defined) |

Candidate future work (PLANNED only, order not decided):

| Item                                                                                                                                                                                                      | Depends on             | Approval gate                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------- |
| Merge `feature/mongodb-foundation` into `main`                                                                                                                                                            | Owner review           | Owner approval to merge                  |
| Login client address: stop all unknown addresses sharing one `"unknown"` limit bucket, plus a per-account limit — **done 2026-10-27 (Step 2, committed)**; its Workers path is historical (decision 0001) | Auth                   | New step approval                        |
| Investigate the intermittent E2E failure on the product list after creation — **root-caused and fixed 2026-10-27, re-verified 2026-10-28 (Step 3, committed)**: router showed the cached stale list       | 3b                     | Owner review                             |
| Workers/workerd test: run Mongoose and scrypt under `wrangler dev`/workerd and measure CPU and memory — **done 2026-10-28 (Step 4)**; decision 0001                                                       | Auth, products         | Done                                     |
| Persistent (shared) rate-limit storage, so limits survive restarts and hold across processes/instances                                                                                                    | Auth, hosting decision | New step approval                        |
| Device-cookie exemption for the per-account lockout (OWASP), after persistent rate limits                                                                                                                 | Persistent rate limits | New step approval                        |
| Owner runs `bun run auth:create-owner` and `bun run db:setup-indexes` on the real DB                                                                                                                      | Owner decision         | Owner runs it (real database writes)     |
| Product editing / archiving through owner-only server functions                                                                                                                                           | 3b                     | New step approval                        |
| Inventory movements (stock history, adjustments)                                                                                                                                                          | Products               | New step approval                        |
| Sales/checkout against MongoDB (transactions, server-side prices/minimums, no overselling, immutable sales)                                                                                               | Products, inventory    | New step approval                        |
| Audit log (append-only)                                                                                                                                                                                   | Auth                   | New step approval                        |
| Employee accounts and roles; password reset                                                                                                                                                               | Auth                   | New step approval                        |
| Product images (Cloudflare R2 was discussed)                                                                                                                                                              | Products               | New step approval + service setup        |
| Connect demo screens to real data (Demo/Live separation)                                                                                                                                                  | Above                  | New step approval                        |
| Hosting provider for the Node server (decision 0001; Fly.io/Node with a fixed egress IP was researched; paused)                                                                                           | Owner decision         | Paused by owner; payment/accounts needed |
| Backups and recovery                                                                                                                                                                                      | Hosting                | New step approval                        |

## Standing approval gates

Owner approval is required for: new implementation phases or sub-steps, destructive operations,
database setup or real-database writes, dependency changes, commits, pushes, deployments, and
connecting any external service. See [../AGENTS.md](../AGENTS.md).
