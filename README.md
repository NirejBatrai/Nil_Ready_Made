# Luxe Retail OS

Mobile-first point of sale and inventory management for a small retail shop in Thailand
(shoes, bags, swimwear, suitcases, sports balls, dresses).

> **Status: browser-only demo.** All data is fictional sample data stored in the browser's
> local storage. Sign-in, roles, approvals, payment verification and the audit log are
> simulated in the browser and are **not** security controls. Do not use it for real sales
> until a real backend (authentication, database, server-side validation, backups) is in place.

This project was originally generated with Lovable. It is **not connected to Lovable**; this
repository is the source of truth.

## Features (demo)

- Checkout for cash and QR / bank transfer, with change calculation and numbered receipts
- Per-item minimum selling price, enforced at checkout and in the sale-creation layer
- Products and variants, stock levels, stock counts and adjustment requests
- Manual QR payment verification, cash drawer opening and closing with discrepancy review
- Owner approvals, audit trail, daily reports and CSV export (Asia/Bangkok dates)

## Development

Requires [Bun](https://bun.sh) (the lockfile is `bun.lock`).

```sh
bun install
bun run dev        # start the dev server
bun run test       # unit and workflow tests (Vitest)
bun run lint       # ESLint
bunx tsc --noEmit -p .   # type check
bun run build      # production build
```

## Project layout

- `src/routes/` – screens (TanStack Router file routes)
- `src/lib/repository/` – data-access layer; the demo store lives here and will be replaced by a backend
- `src/lib/calc.ts` – money and pricing rules
- `src/data/demo-seed.ts` – fictional sample data
- `src/types/domain.ts` – shared domain types
- `src/test/` – tests

See `AGENTS.md` for architecture rules.

## Secrets

Never commit credentials. `.env*` files are ignored by Git; if environment variables are added,
document them in a committed `.env.example` without real values.
