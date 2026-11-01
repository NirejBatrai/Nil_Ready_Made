# 0004 — Interim "Quick Sales" notebook (temporary, until slice S9)

- **Status:** Accepted by the owner, 2026-11-01. **Temporary:** retires when slice S9 of
  [decision 0002](0002-employees-and-roles.md) lands.
- **Relation to 0002:** separate and temporary. It does **not** change the accepted 0002 design,
  its roles, its permission matrix or its slices. Nothing here is a step toward S1–S13; when S9
  is ready, the Quick Sales pages, server functions and the `staff` role are removed (see
  "Retirement").
- **Money:** **All money is integer satang; never floats.** Every amount is parsed on the server
  with `parseBahtToSatang` and shown with `formatSatang` (`src/lib/money.ts`, `฿1,800.00`).

## Context

The shop needs to record sales now. The real sales slice (0002, S9) needs products with
correct prices and stock, which will not be ready for about two weeks. Paper notes are easy to
lose and cannot be summed or sent to the owner. A very small digital notebook covers the gap:
staff write down what they sold, how much, and whether it was Cash or QR; the owner sees the day
and its totals.

## Decision

1. **A `staff` role** is added to `users.role` (`owner`, `staff`). Staff accounts are created only
   by the owner on their own computer with `bun run auth:create-staff` (same safety as
   `auth:create-owner`: hidden password prompt, no web route, no server function). Staff sign in
   at `/login` with email and password and always land on `/quick-sales`.
2. **Permissions** come from a small table (`src/lib/permissions.ts`) checked on the server by
   `requirePermission`, **deny by default**. Staff may only:
   - record today's opening change money;
   - add a quick sale;
   - cancel **their own** sale within **10 minutes**;
   - see their own entries of the last 10 minutes (needed for Cancel).

   Everything else is refused on the server, including every `/owner` page and every product
   server function (they keep `requireOwner`, which already refuses any role but `owner`).

3. **One staff page, `/quick-sales`** (not `/sales`: the demo already owns `/sales`). It shows the
   opening-change form until today's opening change exists, then the sale form and the last 5
   own entries of the past 10 minutes. No totals, no history, no other people's sales, no links.
   Staff are redirected away from the browser demo (`/` and every demo screen).
4. **Data** (MongoDB):
   - `opening_floats`: one per Bangkok business day. `_id` **is** the business day
     (`"YYYY-MM-DD"`), so MongoDB itself refuses a second one (no extra index needed); the
     second attempt gets a clear message.
   - `quick_sales`: `itemText` (trimmed, 1–100 characters), `amountSatang` (> 0, at most
     ฿10,000,000.00), `payment` (`cash` or `qr`), `userId`, server-set `createdAt` and
     `businessDay`, `cancelled` and `cancelledAt`. The browser never sends a date or a time.
   - Cancel is **one atomic update** whose filter requires: this sale, this user, not cancelled,
     created less than 10 minutes ago.
   - The business day is the calendar date in `Asia/Bangkok` (via `Intl`, as in 0002 §4);
     it changes at midnight Bangkok time. Sales need today's opening change first.
5. **Owner page `/owner/today`** (owner only): a date picker (default today, Bangkok), the opening
   change, total, Cash, QR, number of sales, number cancelled, expected cash (opening + Cash
   sales) and the full list (time, item, amount, payment, staff, cancelled).
6. **API for n8n (later):** `GET /api/daily-summary?date=YYYY-MM-DD` (default today, Bangkok),
   authorized only by `Authorization: Bearer <SUMMARY_API_TOKEN>` from the host environment.
   Constant-time comparison; fails closed when the variable is missing or shorter than 32
   characters; no cookies or sessions; failed attempts are rate-limited per client address with
   the existing MongoDB limiter.

## Data retention

Quick Sales records are business records: they are **kept 5 years** after their business day
(the same rule as 0002 O13, to confirm with an accountant). Nothing deletes them automatically.
They **may be imported later** into the S9 sales data; they keep their own collections, ids and
fields so an import can map them without guessing. Staff names on these records are kept as
long as the records are.

## Consequences

- Quick Sales are **not** linked to products or stock: the item is free text. Totals are only as
  good as what staff type.
- No audit log, no shifts, no till registration, no time windows, no PINs: this is a notebook,
  not the 0002 design. Staff use a normal 7-day password session (Step 7a rules apply).
- Disabling a staff account means setting `active: false` on the user (owner, in the database);
  existing sessions stop working at once. There is no page for it.
- `SUMMARY_API_TOKEN` is a new secret. It lives only in the host environment (Vercel: Production
  only, Sensitive) and is never committed.

## Retirement (when S9 lands)

1. Remove `/quick-sales`, `/owner/today`, `/api/daily-summary` (or replace it with an S9
   equivalent), the Quick Sales server functions and the `staff` role.
2. Deactivate or convert the staff accounts according to the S2 employee design.
3. Keep the `opening_floats` and `quick_sales` collections (5-year retention) or import them.
4. Remove `SUMMARY_API_TOKEN` from the host if nothing uses it.
