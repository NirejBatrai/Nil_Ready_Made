# Roadmap

Status labels: **DONE** (verified in code/tests), **PENDING** (not started), **PLANNED**
(discussed, not approved). Every new phase or sub-step needs the owner's **explicit approval**
before implementation, even if it is listed here. Approval of one step does not approve the next.

_Last updated 2026-10-24._ This file supersedes the root `roadmap.md` (demo-era checklist).

## Completed

| Phase                                                                                         | Status | Notes                                        |
| --------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| Demo app (all screens, simulated roles, fictional data)                                       | DONE   | Browser-only; not a security boundary        |
| Phase One demo fixes (drawer/audit actors, deterministic reset, chart metrics, mobile layout) | DONE   | Committed on `main`                          |
| Per-product minimum selling price (demo checkout + rules in `calc.ts`)                        | DONE   | Committed on `main`                          |
| Repository prepared for private GitHub (no Lovable sync)                                      | DONE   | `main` = `origin/main` (local tracking ref)  |
| Backend Step 1 — MongoDB connection foundation                                                | DONE   | Commit `722d86f` (local branch, no upstream) |
| Product model + server-only product service                                                   | DONE   | **Uncommitted**                              |
| Backend Step 2a — owner auth core, local owner script, dev bound to `127.0.0.1`               | DONE   | **Uncommitted**                              |
| Backend Step 2b — `safeErrors`, `requireOwner`, isolated E2E suite                            | DONE   | **Uncommitted**                              |
| Backend Step 2c — `/login` UI                                                                 | DONE   | **Uncommitted**                              |
| Backend Step 3a — read-only `/owner/products`                                                 | DONE   | **Uncommitted**                              |
| Backend Step 3b — owner-only product creation + `db:setup-indexes`                            | DONE   | **Uncommitted**                              |
| Handbook (`AGENTS.md`, `docs/`) + audit hardening (`envDir: false`, `safeErrors` on health)   | DONE   | **Uncommitted**                              |

## Pending (none approved)

**Backend Step 3c is NOT approved.** Do not start it. Its scope has not been defined by the owner.

| Step            | Status                                          |
| --------------- | ----------------------------------------------- |
| Backend Step 3c | **AWAITING OWNER APPROVAL** (scope not defined) |

Candidate future work (PLANNED only, order not decided):

| Item                                                                                                        | Depends on          | Approval gate                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------- |
| Commit the uncommitted work (product model/service, Steps 2a–3b)                                            | Owner review        | Owner approval to commit/push            |
| Owner runs `bun run auth:create-owner` and `bun run db:setup-indexes` on the real DB                        | Owner decision      | Owner runs it (real database writes)     |
| Product editing / archiving through owner-only server functions                                             | 3b                  | New step approval                        |
| Inventory movements (stock history, adjustments)                                                            | Products            | New step approval                        |
| Sales/checkout against MongoDB (transactions, server-side prices/minimums, no overselling, immutable sales) | Products, inventory | New step approval                        |
| Audit log (append-only)                                                                                     | Auth                | New step approval                        |
| Employee accounts and roles; password reset                                                                 | Auth                | New step approval                        |
| Product images (Cloudflare R2 was discussed)                                                                | Products            | New step approval + service setup        |
| Connect demo screens to real data (Demo/Live separation)                                                    | Above               | New step approval                        |
| Hosting (Fly.io/Node with fixed egress IP was researched; paused)                                           | Owner decision      | Paused by owner; payment/accounts needed |
| Backups and recovery                                                                                        | Hosting             | New step approval                        |

## Standing approval gates

Owner approval is required for: new implementation phases or sub-steps, destructive operations,
database setup or real-database writes, dependency changes, commits, pushes, deployments, and
connecting any external service. See [../AGENTS.md](../AGENTS.md).
