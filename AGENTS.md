# AGENTS.md — start here

Mandatory instructions for any AI coding agent (Claude Code, Codex, ChatGPT agents, others) and
for humans picking up this project without prior conversation history.

**Source of truth:** the code and the test results in this repository. If a document disagrees
with the code, trust the code, then fix the document. Labels used in `docs/`:
**VERIFIED** (checked against code/tests, with date), **PLANNED** (approved or proposed, not
built), **NOT VERIFIED** (claimed or assumed, not checked).

## Read before doing anything

1. [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — what exists now, Git state, next approved action.
2. [docs/SECURITY.md](docs/SECURITY.md) — security boundaries and prohibited actions.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — where things live and how data flows.
4. [docs/TESTING.md](docs/TESTING.md) — exact commands and isolated-database rules.
5. [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/CHANGELOG.md](docs/CHANGELOG.md) — phases, approval gates, history.

The root `roadmap.md` is the old demo-era checklist; `docs/ROADMAP.md` supersedes it.

## Hard rules (never break these)

- **Never read, print, copy, or modify `.env`, `.dev.vars`, or any file holding secrets.** Work
  from `.env.example` and code references only. Never put secrets, connection strings,
  passwords, tokens or personal credentials in code, logs, test output, docs, or commits.
- **Commands that make the app load `.env`** (`bun run dev`, `bun run build`, `bun run test:db`,
  `bun run auth:create-owner`, `bun run auth:create-staff`, `bun run auth:reset-password`,
  `bun run db:setup-indexes`; `bun run preview` likely, NOT
  VERIFIED) touch the owner's real configuration or database. Do not run them unless the user
  explicitly asks; prefer that the user runs them (`! <command>` in Claude Code). `bun run test`
  and `bun run test:e2e` do not load `.env` (`vitest.config.ts` sets `envDir: false`). See
  [docs/TESTING.md](docs/TESTING.md).
- **Tests use only an isolated throwaway database** (mongodb-memory-server on `127.0.0.1`) and
  never real shop data or MongoDB Atlas.
- **Get explicit user approval before:** starting a new implementation phase or sub-step,
  destructive operations (deleting, resetting, force-pushing, rewriting history), database setup
  or any real-database write, adding/upgrading/removing dependencies, commits, pushes, deploys,
  or connecting any external service. Approval for one step does not carry over to the next.
- **The demo's simulated roles are not authentication.** Never treat the demo Owner/Employee
  switch or `<OwnerOnly>` as access control. Every sensitive server operation must check the real
  server-side session (`requireOwner`). See [docs/SECURITY.md](docs/SECURITY.md).
- **Do not connect or sync this repository to Lovable.** It was generated with Lovable but is
  not connected; this GitHub repository is the source of truth.
- **Do not rewrite pushed Git history** (no force push, amend, rebase or squash of pushed commits).
- **Push only the branch named by the user** (`git push origin <branch>`); never `--all`,
  `--mirror` or `--tags`. The local-only refs `refs/original/*` and `refs/original-2/*` hold
  pre-rewrite history with an old author identity: never push, modify or delete them unless the
  owner decides.

## Working method for every task

1. **Start:** read the documents above; run `git status --short` and `git branch --show-current`.
   Large uncommitted work may exist — never discard, reset, stash or overwrite it.
2. **Inspect:** read the actual code you will touch and its tests. Do not trust summaries.
3. **Plan:** propose the smallest safe change, list files to change and tests to add, and wait
   for approval when the task is a new phase or touches the hard rules above.
4. **Implement:** small, focused changes that match the surrounding code style.
5. **Test:** run the checks in [docs/TESTING.md](docs/TESTING.md). For security protections,
   prove the test catches the problem (temporarily remove the protection, see the test fail,
   restore it — one protection at a time, with a passing control run).
6. **Review the diff:** `git status --short` and `git diff`; confirm only intended files changed
   and nothing secret was added.
7. **Update docs:** record what changed in [docs/CHANGELOG.md](docs/CHANGELOG.md) and update
   [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) (and other docs if behavior changed). Do not
   claim a test passed unless you ran it.
8. **Report** files changed, exact commands run with results, and remaining limitations. Do not
   commit or push unless asked.

## Code conventions (VERIFIED 2026-10-23)

- TypeScript is strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`: optional
  props are typed `?: T | undefined`; array indexing goes through `nth()`/`must()` from
  `src/lib/assert.ts`. Do not use `any`, `@ts-ignore`, or unsafe type assertions.
- Demo screens read state via `useDemoState()` and write only through `repo` in
  `src/lib/repository`. Do not connect demo screens to MongoDB without an approved step.
- Money (real backend): **all money is integer satang; never floats.** Fields are named
  `…Satang` (`priceSatang`, `minimumSellingPriceSatang`, `costSatang`); parsing, display
  (`฿1,800.00`) and the pricing rule live in `src/lib/money.ts`. Each product has its own minimum
  selling price; there is **no universal minimum price**.
- Demo only: domain types `src/types/domain.ts` and rules `src/lib/calc.ts` (whole baht,
  browser-only simulation).
- Server-only code lives in `*.server.ts` files (TanStack Start blocks browser imports of them).
  Server functions live in browser-importable files under `src/lib/` and load server-only modules
  with a dynamic `import()` inside the handler.
- Every server function starts with the `safeErrors` middleware; sensitive ones add
  `requireOwner`. Input validators must never throw (return `null`/defaults instead).
- Match the existing code style; run Prettier (`bun run format` formats the whole repo — prefer
  `bunx prettier --write <files>` for the files you changed).
