## Repository

- Originally generated with Lovable, but **not connected to Lovable**. Do not connect or sync it to Lovable.
- Hosted in a private GitHub repository. Do not rewrite history that has been pushed (no force push, amend, rebase or squash of pushed commits).
- Never commit secrets: `.env*` files are ignored; document required variables in `.env.example` instead.

## Architecture rules

- Screens read demo state via `useDemoState()` and write only through `repo` in `src/lib/repository`; swap that module for a real backend later.
- Domain types live in `src/types/domain.ts`; money and pricing rules live in `src/lib/calc.ts` with tests in `src/test/calc.test.ts` and `src/test/pricing.test.ts`.
- tsconfig uses exactOptionalPropertyTypes/noUncheckedIndexedAccess: optional props are typed `?: T | undefined`, array indexing goes through `nth()`/`must()` from `src/lib/assert.ts`.
- Owner-only screens wrap content in `<OwnerOnly>`; this is UI-only and must be enforced server-side later.
