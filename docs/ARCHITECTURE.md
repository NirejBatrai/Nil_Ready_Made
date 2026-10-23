# Architecture

_VERIFIED against the source on 2026-10-23 (updated 2026-10-24) unless marked otherwise._

## Stack

| Layer           | Technology (version from `package.json`)                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| Framework       | TanStack Start `1.168.60` (React `^19.2.0`, TanStack Router file routes, server functions) |
| Build           | Vite `8.1.5` via `@lovable.dev/vite-tanstack-config` `2.26.5`; Nitro server bundle         |
| Package manager | Bun (`bun.lock`; `bunfig.toml` refuses packages published < 24 h ago)                      |
| Database        | MongoDB (Atlas in real use) via Mongoose `9.11.3` (driver `mongodb` 7.7)                   |
| Validation      | Zod `^3.25.76`                                                                             |
| Tests           | Vitest `^4.1.10`, mongodb-memory-server `11.3.0`, playwright-core `1.64.1` (dev only)      |

Build target: Nitro preset defaults to **`cloudflare-module`** (Workers, `nodejs_compat`); no
override in `vite.config.ts`. `nitro.config.ts` aliases `punycode/` so the MongoDB driver bundles
for that target. Hosting is paused; see [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Directory map

```
src/
  routes/                 File-based routes (TanStack Router). routeTree.gen.ts is GENERATED.
    __root.tsx            Root shell, head, error/not-found components
    index.tsx             Landing page: demo role cards + "Owner sign-in (real account)" link
    _shell.tsx            Demo layout (AppShell, simulated role switch)
    _shell.*.tsx          Demo screens (browser-only data)
    login.tsx             REAL owner sign-in            → /login
    owner.products.tsx    REAL read-only product list   → /owner/products
    owner.products_.new.tsx REAL product creation       → /owner/products/new (trailing _ = not nested)
    dev.auth.tsx          Dev-only auth diagnostic      → /dev/auth (only "Not available." in production)
    dev.db-health.tsx     Dev-only DB diagnostic        → /dev/db-health
  lib/                    Browser-importable code
    auth.ts               Server functions: login, logout, getCurrentUser; requireOwner middleware
    products.ts           Server functions: getProductForOwner, listProductsForOwner, createProductForOwner
    server-errors.ts      safeErrors middleware + toSafeError
    db-health.ts          getDatabaseHealth (dev-only diagnostic)
    calc.ts               Money/pricing rules shared by demo and server
    repository/           DEMO data layer (localStorage) — not the real backend
  server/                 SERVER-ONLY (*.server.ts; blocked from browser bundles)
    db.server.ts          Connection access (runtime MONGODB_URI, sanitized errors)
    health.server.ts      Health check core
    products.server.ts    Product service (validation, create, reads)
    models/               Mongoose models: product, user, session
    auth/                 password (scrypt), auth core, cookie options, session-context (HTTP bridge)
  types/domain.ts         Shared domain types
  test/                   Vitest tests (see TESTING.md)
scripts/                  Local-only CLI scripts run with Bun by the owner
  create-owner.ts         bun run auth:create-owner
  setup-indexes.ts        bun run db:setup-indexes
```

## Demo vs real backend (critical separation)

|          | Demo                                                                      | Real backend                                                |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Routes   | `/`, `/_shell/*` screens (`/pos`, `/products`, …)                         | `/login`, `/owner/products`, `/owner/products/new`          |
| Data     | `localStorage` (`src/lib/repository`, `src/data/demo-seed.ts`), fictional | MongoDB via `src/server/*`                                  |
| "Roles"  | Simulated Owner/Employee switch; `<OwnerOnly>` is **UI-only**             | Real session cookie checked by `requireOwner` on the server |
| Security | None (any user can edit browser data)                                     | Server-enforced auth, validation, CSRF, unique indexes      |

The two never mix: real pages do not read demo data, demo screens do not call real server
functions, and choosing a demo role creates no session (tested in E2E).

## Server boundary

- `*.server.ts` files are blocked from browser imports by TanStack Start import protection.
- Server functions (`createServerFn`) are defined in `src/lib/*.ts` (browser-importable). Their
  handler bodies become RPC stubs in the client bundle; they load server-only modules with a
  dynamic `import()` inside the handler. A production-build scan in the E2E suite confirms no
  Mongoose, scrypt, `MONGODB_URI`, password-hash or session-cookie code reaches the browser.
- A server function is only bundled if something imports it (why `/dev/*` pages exist).

### Server functions (VERIFIED)

| Function                | Method | Middleware                   | Purpose                                                   |
| ----------------------- | ------ | ---------------------------- | --------------------------------------------------------- |
| `login`                 | POST   | `safeErrors`                 | Verify credentials, set session cookie                    |
| `logout`                | POST   | `safeErrors`                 | Delete session, clear cookie                              |
| `getCurrentUser`        | GET    | `safeErrors`                 | Name and role only, or `null`                             |
| `getProductForOwner`    | GET    | `safeErrors`, `requireOwner` | One product **including cost** (used only by `/dev/auth`) |
| `listProductsForOwner`  | GET    | `safeErrors`, `requireOwner` | Active products, **never cost**                           |
| `createProductForOwner` | POST   | `safeErrors`, `requireOwner` | Create product; returns it **without cost**               |
| `getDatabaseHealth`     | GET    | `safeErrors`                 | Dev-only status word                                      |

## Authentication flow

1. Owner account created **locally** by the owner with `bun run auth:create-owner` (no web route).
2. `/login` → `login` server function → `auth.server.ts` verifies the scrypt hash, applies the
   attempt limit, creates a session (stores SHA-256 of a random token), and `session-context`
   sets the HttpOnly cookie.
3. Protected pages use `beforeLoad` → `getCurrentUser` to redirect signed-out visitors (cosmetic).
4. Every protected server function runs `requireOwner`, which re-reads the session **and** the
   user on each call (real enforcement).
5. `logout` deletes the session record and clears the cookie.

Details and parameters: [SECURITY.md](SECURITY.md).

## Database models (VERIFIED)

| Collection | Model file                 | Key points                                                                                                                                                                                                     |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`    | `models/user.server.ts`    | `role` enum is `owner` only; `passwordHash` `select:false`; unique email; `single_owner` partial unique index                                                                                                  |
| `sessions` | `models/session.server.ts` | `_id` = SHA-256 of token; `expiresAt` with TTL cleanup index                                                                                                                                                   |
| `products` | `models/product.server.ts` | Whole-baht money; per-product `minimumSellingPrice`; `cost` `select:false`; embedded variants (`sku`, `barcode`, `openingStock`, `stock`); optimistic concurrency; query updates touching pricing are rejected |

Product indexes (case-insensitive collation `{ locale: "en", strength: 2 }`, all unique):
`product_sku_unique_ci`, `variant_sku_unique_ci`, `variant_barcode_unique_ci` (partial). They
are created **only** by `bun run db:setup-indexes`; requests never create indexes.

## Data flow: creating a product

Browser form (`/owner/products/new`) → `createProductForOwner` (POST; CSRF check;
`safeErrors` → `requireOwner`) → `createProductService(conn).createProduct(input)`:
Zod strict parse (normalizes SKU/barcode, rejects unknown/stock fields) → `productPricingError`
→ `verifyProductIndexes` (fail closed) → Mongoose `create` (schema validation; unique indexes
decide duplicates, including concurrent ones) → cost-free `PublicProduct` returned.

## Connection behavior

`db.server.ts` reads `MONGODB_URI` at call time. On Node.js one connection is shared per
process; on Cloudflare Workers (if ever used) each call opens and destroys its own connection.
Options: small pool, `serverSelectionTimeoutMS` 5000, `bufferCommands: false`,
`autoIndex: false`, `autoCreate: false`. Errors become `DatabaseUnavailableError` with no
connection details.
