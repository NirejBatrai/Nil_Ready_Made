# Roadmap

Status labels: **DONE** (verified in code/tests), **PENDING** (not started), **PLANNED**
(discussed, not approved). Every new phase or sub-step needs the owner's **explicit approval**
before implementation, even if it is listed here. Approval of one step does not approve the next.

_Last updated 2026-10-24._ This file supersedes the root `roadmap.md` (demo-era checklist).

## Completed

| Phase                                                                                         | Status | Notes                                       |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| Demo app (all screens, simulated roles, fictional data)                                       | DONE   | Browser-only; not a security boundary       |
| Phase One demo fixes (drawer/audit actors, deterministic reset, chart metrics, mobile layout) | DONE   | Committed on `main`                         |
| Per-product minimum selling price (demo checkout + rules in `calc.ts`)                        | DONE   | Committed on `main`                         |
| Repository prepared for private GitHub (no Lovable sync)                                      | DONE   | `main` = `origin/main` (local tracking ref) |
| Backend Step 1 — MongoDB connection foundation                                                | DONE   | Commit `722d86f` (local branch, not pushed) |
| Product model + server-only product service                                                   | DONE   | Commit `ced5535` (local branch, not pushed) |
| Backend Step 2a — owner auth core, local owner script, dev bound to `127.0.0.1`               | DONE   | Commit `ced5535` (local branch, not pushed) |
| Backend Step 2b — `safeErrors`, `requireOwner`, isolated E2E suite                            | DONE   | Commit `ced5535` (local branch, not pushed) |
| Backend Step 2c — `/login` UI                                                                 | DONE   | Commit `ced5535` (local branch, not pushed) |
| Backend Step 3a — read-only `/owner/products`                                                 | DONE   | Commit `ced5535` (local branch, not pushed) |
| Backend Step 3b — owner-only product creation + `db:setup-indexes`                            | DONE   | Commit `ced5535` (local branch, not pushed) |
| Handbook (`AGENTS.md`, `docs/`) + audit hardening (`envDir: false`, `safeErrors` on health)   | DONE   | Commit `4da3c13` (local branch, not pushed) |

## Pending (none approved)

**Backend Step 3c is NOT approved.** Do not start it. Its scope has not been defined by the owner.

| Step            | Status                                          |
| --------------- | ----------------------------------------------- |
| Backend Step 3c | **AWAITING OWNER APPROVAL** (scope not defined) |

Candidate future work (PLANNED only, order not decided):

| Item                                                                                                          | Depends on          | Approval gate                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------- |
| Push `feature/mongodb-foundation` to GitHub and/or merge into `main` (work committed in `ced5535`, `4da3c13`) | Owner review        | Owner approval to push/merge             |
| Owner runs `bun run auth:create-owner` and `bun run db:setup-indexes` on the real DB                          | Owner decision      | Owner runs it (real database writes)     |
| Product editing / archiving through owner-only server functions                                               | 3b                  | New step approval                        |
| Inventory movements (stock history, adjustments)                                                              | Products            | New step approval                        |
| Sales/checkout against MongoDB (transactions, server-side prices/minimums, no overselling, immutable sales)   | Products, inventory | New step approval                        |
| Audit log (append-only)                                                                                       | Auth                | New step approval                        |
| Employee accounts and roles; password reset                                                                   | Auth                | New step approval                        |
| Product images (Cloudflare R2 was discussed)                                                                  | Products            | New step approval + service setup        |
| Connect demo screens to real data (Demo/Live separation)                                                      | Above               | New step approval                        |
| Hosting (Fly.io/Node with fixed egress IP was researched; paused)                                             | Owner decision      | Paused by owner; payment/accounts needed |
| Backups and recovery                                                                                          | Hosting             | New step approval                        |

## Standing approval gates

Owner approval is required for: new implementation phases or sub-steps, destructive operations,
database setup or real-database writes, dependency changes, commits, pushes, deployments, and
connecting any external service. See [../AGENTS.md](../AGENTS.md).
