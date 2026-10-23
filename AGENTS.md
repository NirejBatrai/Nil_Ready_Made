<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Screens read demo state via `useDemoState()` and write only through `repo` in `src/lib/repository`; swap that module for a real backend later.
- Domain types live in `src/types/domain.ts`; money calculations live in `src/lib/calc.ts` with tests in `src/test/calc.test.ts`.
- tsconfig uses exactOptionalPropertyTypes/noUncheckedIndexedAccess: optional props are typed `?: T | undefined`, array indexing goes through `nth()`/`must()` from `src/lib/assert.ts`.
- Owner-only screens wrap content in `<OwnerOnly>`; this is UI-only and must be enforced server-side later.
