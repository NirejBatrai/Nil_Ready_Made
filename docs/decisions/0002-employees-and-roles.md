# 0002 — Employee accounts, till sign-in, shifts and sales

- **Status:** **ACCEPTED by the owner, 2026-10-31.** First draft 2026-10-29; revised
  2026-10-31 with decisions F1–F8, then O1–O13. **Accepting the design approves no
  implementation:** each slice in topic 12 still needs the owner's explicit approval before it
  starts.
- **Builds on:**
  - Step 7a: `revokeAllSessions`, `lastSeenAt`, the 5-session cap, `createdIp`, `userAgent`;
  - the per-request user re-read in `resolveSession` and `requireOwner` (`src/lib/auth.ts`,
    `src/server/auth/auth.server.ts`);
  - Step 5c: the MongoDB-backed attempt limiter (`src/server/auth/login-limiter.server.ts`,
    collection `login_attempts`, atomic, TTL, fail closed).
- **Current state (VERIFIED 2026-10-31):**
  - `users.role` allows only `"owner"` (`src/server/models/user.server.ts`), and a
    `single_owner` index allows one owner.
  - Every sensitive server function uses `.middleware([safeErrors, requireOwner])`.
  - The product model requires `variants.stock ≥ 0` (`min: 0`); slice S9 changes this (O11).
  - The demo's `Role = "owner" | "employee"` (`src/types/domain.ts`) is simulated and unrelated.

## Owner decisions (final, 2026-10-31)

**Design (F1–F8)**

| #   | Decision                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **No cash-drawer hardware features**: no drawer kick, no "no sale".                                                                                                                          |
| F2  | **No manager role, no approvals, no overrides.** Roles are exactly **owner** and **employee**.                                                                                               |
| F3  | Shop hours **08:00–23:00**, timezone **Asia/Bangkok**. "Today" = the Bangkok calendar day.                                                                                                   |
| F4  | **Opening:** before the first sale the employee records the starting change float (e.g. ฿600). Sales are blocked until it is recorded.                                                       |
| F5  | **Each sale:** the employee picks products and a payment method (**Cash** or **QR/transfer**). The price comes from the product; employees cannot change prices or give discounts.           |
| F6  | **Mistakes:** an employee can cancel **their own** sale within **10 minutes**. Cancels are logged and shown to the owner. Refunds of older sales are **owner-only**.                         |
| F7  | **Closing:** the employee enters the counted cash as a **blind count** (they never see the expected amount). That closes the day's shift.                                                    |
| F8  | **Visibility:** employees never see daily totals, sales history, other employees' sales or costs. The owner dashboard shows today's numbers (topic 8). Computed on demand; no scheduled job. |

**Details (O1–O13)**

| #   | Decision                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | **6-digit PIN.**                                                                                                                                                                                   |
| O2  | PIN hashes use a **server-side PIN secret from the host environment**: never committed, never in the database. How the owner makes it is in topic 2.                                               |
| O3  | On a **registered till only**: pick your name from a list, then enter your PIN.                                                                                                                    |
| O4  | **Lock after 15 minutes idle**, unlock with the same PIN. **No logout mid-shift** for idleness.                                                                                                    |
| O5  | A till session ends at **23:30 Bangkok or at shift close, whichever comes first**.                                                                                                                 |
| O6  | **Shift opening from 07:00.** **Sales until 23:15.** **Closing count until 23:59.** A missed close is closed by the **owner from the dashboard** and recorded as owner-closed.                     |
| O7  | **One shift per till** (per business day).                                                                                                                                                         |
| O8  | **The owner can sell at the till**; those sales count normally.                                                                                                                                    |
| O9  | QR/transfer is recorded **on the employee's word**; the dashboard shows the **QR total** for the owner to check against the bank.                                                                  |
| O10 | **No reopening** of a closed shift; the owner can add a **correction note** to it.                                                                                                                 |
| O11 | **Do not wait for inventory:** each sale **decrements stock atomically in the same operation**. It **never blocks at 0**. Negative stock is flagged on the owner dashboard as **"needs recount"**. |
| O12 | **Whole-sale refunds only**, owner-only. **Stock is returned.** A **cash refund reduces expected cash on the business day it is given.**                                                           |
| O13 | **Sales records are kept 5 years** (to be confirmed with an accountant). Session and IP data still expire with their sessions.                                                                     |

**How this record reads two of the answers together** (the owner may correct either before
the matching slice):

- **O5 + O6 (the late closing window).** Till sessions end at 23:30, but the count may be entered
  until 23:59. So between 23:30 and 23:59, a PIN sign-in on a till whose shift is still open
  gives a **closing-only session**: it allows `shift.close` and nothing else, and ends at 23:59
  or at the close.
- **Sales start time.** O6 sets only the end of sales (23:15). Sales start at **08:00**, the shop
  opening (F3). Between 07:00 and 08:00 an employee can sign in and record the float, but not
  sell.

Removed in the first revision: the manager role, on-till overrides, the approval queue,
discounts, price overrides, voids, drawer pay-in/pay-out and discrepancy resolution (former
decisions D1–D3, D10–D12, D15).

## 1. Roles and permission matrix

**Fixed roles in code:** `owner` and `employee`. Each has a fixed permission set (a closed
string-literal union, so a typo fails the typecheck). There is no per-employee toggle and no
role editing.

**Deny by default:**

- A role not in the table, a permission not granted, an inactive user or a missing session is
  refused.
- Every server function must declare its permission. A source check fails the test run if a
  server function has neither a permission middleware nor an explicit "public" marker.
- **P** = needs a **password session**. A PIN session cannot use it, even the owner's PIN session
  at the till.
- **T** = only on a **registered till**, with a PIN session.
- **W** = only inside its time window (topic 5), by the server's clock in Asia/Bangkok.

**Matrix** (✓ allowed, ✗ denied, — not applicable). "Built" = exists today.

| Area     | Permission                              | Action                                                              | Built?  | Owner                                | Employee |
| -------- | --------------------------------------- | ------------------------------------------------------------------- | ------- | ------------------------------------ | -------- |
| Self     | `self.sign_out_everywhere`              | End all own sessions                                                | Yes     | ✓                                    | ✓        |
| Self     | `self.change_pin`                       | Change own PIN (needs the current PIN)                              | Planned | ✓ T                                  | ✓ T      |
| Self     | `self.change_password`                  | Change own password                                                 | Planned | ✓ P                                  | —        |
| Products | `product.read.till`                     | Product picker: name, SKU, variant, price (never cost)              | Planned | ✓ T                                  | ✓ T      |
| Products | `product.read`                          | Owner product list (never cost)                                     | Yes     | ✓ P                                  | ✗        |
| Products | `product.cost.read`                     | See cost price                                                      | Yes     | ✓ P                                  | ✗        |
| Products | `product.create` / `.edit` / `.archive` | Create, edit (incl. prices), archive/restore                        | Yes     | ✓ P                                  | ✗        |
| Stock    | `stock.recount`                         | Set a variant's counted stock (clears "needs recount"), logged      | Planned | ✓ P                                  | ✗        |
| Shift    | `shift.open`                            | Record today's starting float on this till                          | Planned | ✓ T W                                | ✓ T W    |
| Shift    | `shift.close`                           | Enter the counted cash (blind) and close today's shift on this till | Planned | ✓ T W                                | ✓ T W    |
| Shift    | `shift.close.owner`                     | Close a missed shift from the dashboard (recorded as owner-closed)  | Planned | ✓ P                                  | ✗        |
| Shift    | `shift.note.add`                        | Add a correction note to a closed shift                             | Planned | ✓ P                                  | ✗        |
| Sales    | `sale.create`                           | Sell at the server's price, Cash or QR/transfer                     | Planned | ✓ T W                                | ✓ T W    |
| Sales    | `sale.cancel.own_recent`                | Cancel **own** sale ≤ 10 min old, while the shift is open           | Planned | ✓ T                                  | ✓ T      |
| Sales    | `sale.read.own_recent`                  | Own sales still inside the 10-minute cancel window (no totals)      | Planned | ✓ T                                  | ✓ T      |
| Sales    | `sale.read.all`                         | Sales list and details, any day, anyone                             | Planned | ✓ P                                  | ✗        |
| Refunds  | `refund.create`                         | Refund a whole sale                                                 | Planned | ✓ P                                  | ✗        |
| Reports  | `report.day.read`                       | Owner dashboard for a business day (topic 8)                        | Planned | ✓ P                                  | ✗        |
| Audit    | `audit.read`                            | Read the audit log, including cancels                               | Planned | ✓ P                                  | ✗        |
| People   | `employee.manage`                       | Create, rename, disable, enable, reset PIN                          | Planned | ✓ P                                  | ✗        |
| People   | `session.revoke.others`                 | End an employee's sessions                                          | Planned | ✓ P                                  | ✗        |
| Devices  | `device.register` / `.revoke`           | Register or revoke a till                                           | Planned | ✓ P                                  | ✗        |
| Settings | `settings.edit`                         | Shop settings                                                       | Planned | ✓ P                                  | ✗        |
| Dev      | (none: dev-only routes)                 | `/dev/auth`, `/dev/db-health`                                       | Yes     | dev-only, never in production builds |

**The owner at the till (O8).** The owner appears in the till's name list and signs in with their
own PIN, which they set from a password session. That PIN session has exactly the employee's
till permissions (**T**), including the blind count and the 10-minute own-sale cancel. It has
none of the **P** permissions, so a PIN typed in front of staff never opens the back office.
The owner's sales and shifts count like anyone else's.

**Nobody can:**

- create or modify the owner account through the app (that stays the local
  `auth:create-owner` script);
- change a sale's price, discount it, refund part of a sale, or sell below a product's minimum
  price;
- edit or delete a completed sale, a cancel, a refund, a shift record, a correction note or an
  audit event;
- reopen a closed shift (O10);
- change any role (one owner; everyone else an employee);
- see the expected cash from a till session, owner included.

**What a till shows:**

- the product picker, the current cart and the payment choice;
- the signed-in person's own sales still inside the 10-minute cancel window. That list exists
  only to pick what to cancel; it has no totals, and each sale drops off after 10 minutes.

No till response contains totals, other people's sales, expected cash, cost or stock levels.
Tests check every till response for these.

## 2. Sign-in on a shared till

**Method (O3):**

- A **registered till device**.
- The person **picked from a name list** (active employees and the owner; names are not secret
  on a registered till).
- A **6-digit PIN** (O1).

PIN sign-in exists only on registered tills. The owner keeps email + password for the back office
from any device.

**PIN hashing with a server-side secret (O2)**

- PINs are hashed with scrypt over HMAC-SHA-256(**PIN secret**, PIN). The secret lives only in
  the host's environment as **`PIN_SECRET`**. It is never in the database, the repository, logs,
  test output or `.env.example` values (only the empty name is listed there). A database leak
  alone then reveals no PINs.
- PIN sign-in **fails closed** without a valid secret (at least 32 bytes). The server refuses PIN
  sign-in and PIN changes, and password sign-in is unaffected.
- **How the owner generates it** (once, on their own computer, never pasted anywhere else):

  ```sh
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
  ```

  1. Store the output in the password manager.
  2. Set it as `PIN_SECRET` in the host's secret store (Vercel: **Production only**,
     **Sensitive**; Node server: the service's environment).
  3. Never put it in a commit, a chat, a ticket or a screenshot.

- **Rotating or losing it** invalidates every PIN: the owner resets all PINs (topic 7). Nothing
  else is affected. Rotate it if it may have been seen.
- Trivial PINs are rejected (`000000`, `123456`, repeated or sequential digits, the employee
  code).

**Rate limits and lockout.** These reuse the Step 5c limiter (MongoDB `login_attempts`, atomic,
shared by all instances, TTL cleanup, fail closed), with new limiter kinds and the same
count/undo semantics.

| Limit                     | Threshold                           | Effect                                             |
| ------------------------- | ----------------------------------- | -------------------------------------------------- |
| Per person                | 5 wrong PINs within 15 min          | That person's PIN sign-in locked 15 min (any till) |
| Per person, long window   | 10 wrong PINs within 24 h           | PIN disabled until the owner resets it             |
| Per till                  | 10 wrong PINs within 15 min, anyone | That till's PIN sign-in locked 15 min              |
| Password sign-in (exists) | Unchanged                           | Per address / email + address / account            |

- Each attempt is counted **before** the PIN check, atomically. A correct PIN clears only that
  person's 15-minute count.
- The till may say "PIN sign-in is locked for this person; ask the owner". Password sign-in keeps
  today's generic messages.
- A lockout does not end existing sessions. A PIN reset does.

**Device registration**

- The owner signs in with their password on the till, names it ("Till 1") and registers it.
- The server issues a random device token in a separate long-lived cookie
  (`__Host-luxe_device`, `HttpOnly`, `Secure`, `SameSite=Lax`, 1 year). MongoDB stores only
  its SHA-256 hash.
- PIN sign-in, PIN unlock, the name list and every **T** permission require a valid,
  non-revoked device token.
- The owner can list and revoke tills. Revoking ends every session created on that till.

## 3. Till session policy (this is Step 7b)

| Kind                                   | Ends at (whichever comes first)                                                    | Idle                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| Owner, password session (back office)  | 7 days after sign-in (unchanged)                                                   | none                                              |
| PIN session on a till (anyone)         | **23:30 Bangkok** · **the close of this till's shift** · logout · switch user (O5) | **lock after 15 min**, PIN unlock, no logout (O4) |
| Closing-only PIN session (23:30–23:59) | **23:59 Bangkok** · the close of this till's shift                                 | lock after 15 min                                 |

- **Closing the shift ends every session on that till.** This holds for the employee's close and
  for the owner's dashboard close.
- **Lock** keeps the session and the cart but hides everything behind a PIN prompt. Only the same
  person's PIN unlocks it. "Switch user" ends the locked session and starts a new sign-in.
- **The lock is enforced on the server.** A session has `lockedAt`. While it is set, every
  request except "unlock" and "switch user" is refused. The server also treats a session as
  locked when `now − lastSeenAt` ≥ 15 minutes, so a tampered browser cannot skip it. PIN
  sessions write `lastSeenAt` every minute (password sessions keep 5 minutes).
- **PIN unlock** uses the same check and limits as PIN sign-in. After 5 wrong attempts the locked
  session is ended.
- **New optional session fields:** `kind` (`"password" | "pin"`), `deviceId`, `lockedAt`,
  `endsAt` (computed at sign-in from the rules above), and `closingOnly`. Old sessions without
  them stay password sessions (no migration).
- One till holds at most one PIN session: a new PIN sign-in there ends the previous one.

## 4. Time and the business day

- Every shift, sale, cancel, refund and note stores `businessDay` (`"YYYY-MM-DD"` in
  Asia/Bangkok), computed **on the server** from the server clock. The client never sends a date
  or a time.
- The code uses the IANA zone `Asia/Bangkok` via `Intl`, not a fixed offset. Thailand has no
  daylight saving, so it is always UTC+7.
- All windows below lie inside one calendar day, so nothing crosses midnight.

## 5. Time windows (O6; Asia/Bangkok, server clock)

| Action                          | Allowed                                            |
| ------------------------------- | -------------------------------------------------- |
| PIN sign-in (normal session)    | 07:00–23:30                                        |
| `shift.open` (record float)     | 07:00–23:15                                        |
| `sale.create`                   | 08:00–23:15, and only with an open shift           |
| `sale.cancel.own_recent`        | Within 10 min of the sale, while the shift is open |
| PIN sign-in (closing-only)      | 23:30–23:59, only if this till's shift is open     |
| `shift.close` (blind count)     | Any time the shift is open, until 23:59            |
| `shift.close.owner` (dashboard) | Any time after 23:59 of that business day          |
| Owner refunds, notes, recount   | Any time (password session)                        |

A request outside its window is refused with a plain message, for example "Sales are closed
for today." The refusal is logged.

## 6. Shift, sale, cancel, refund and stock

**Shift (one per till per business day, O7)**

- **Open.** Records `startFloat` (whole baht, 0–20 000), who and when. A unique index on
  `(deviceId, businessDay)` makes a second opening fail, even when two arrive at once.
- **Close (blind).** A one-time atomic transition `open` → `closed`. It records `countedCash`
  (whole baht, 0–1 000 000), who, when and `closedBy: "till"`.
  - The response is only "closed": never the expected cash or the difference.
  - No till-reachable function computes or returns either value.
  - A second close fails.
- **Missed close.** A shift still open after 23:59 is shown as "not closed" on the dashboard.
  - The owner closes it there, entering the counted cash; this is not blind, since the owner sees
    the expected cash anyway. It is recorded with `closedBy: "owner"`, the owner's id and the
    time.
  - It does not block the next day: the next business day opens its own shift.
- **No reopening (O10).** The owner may add **correction notes** to a closed shift: append-only
  text with author and time, shown on the dashboard and logged. Notes never change the recorded
  figures.

**Sale (`sale.create`)**

- The client sends only variant ids, quantities (whole numbers 1–999) and the payment method
  (`cash` | `qr`). The schema is strict: unknown fields are rejected, and there is no price,
  discount, date, employee or till field.
- **The server sets every price** from the product at that moment and stores a price snapshot on
  each line, along with the seller, the till and the shift. Archived products cannot be sold.
  Whole baht only (`src/lib/calc.ts`).
- **Stock (O11).** The sale and the stock decrements happen in **one MongoDB transaction**: the
  sale is inserted and each line's `$inc: { "variants.$.stock": -qty }` is applied. Either all of
  it happens, or nothing does.
  - It **never blocks at 0**: stock may go negative, and the sale still completes.
  - Simultaneous sales of the same variant each decrement exactly once (an atomic `$inc`, no
    read-then-write).
  - The product model's `stock` rule changes from `min: 0` to "any whole number"
    (`openingStock` stays ≥ 0), so owner product edits still save when stock is negative.
  - Atlas (also M0) supports transactions. Tests use `MongoMemoryReplSet`, which ships with
    mongodb-memory-server, so no new dependency is needed.
- **QR/transfer (O9)** is recorded on the seller's word. There is no bank integration; the owner
  checks the dashboard's QR total against the bank.

**Cancel (`sale.cancel.own_recent`, F6)**

- Allowed only if all of these hold:
  - the sale belongs to the signed-in person;
  - `now − completedAt ≤ 10 minutes`, by the server clock;
  - the sale is still `completed`;
  - its shift is still open.
- One transaction checks all of these in the update filter, sets `status: "cancelled"`,
  `cancelledAt` and `cancelledBy`, and **returns the stock** (`$inc` +qty). Two cancels cannot
  both succeed.
- The sale is kept, never deleted, and an audit event is written. A cancelled sale counts in
  neither totals nor expected cash. The owner sees every cancel.

**Refund (`refund.create`, owner-only, O12)**

- **Whole sale only.** One refund per sale, enforced by a unique index on `saleId`. Only a
  `completed` (not cancelled) sale can be refunded.
- One transaction:
  - inserts an append-only refund record (`saleId`, amount = the sale total, method `cash` or
    `transfer`, reason, owner, time, `businessDay` = **the day it is given**);
  - marks the sale `refunded`;
  - **returns the stock**.
- **A cash refund** names the till shift its cash came from. That must be an **open** shift of
  the current business day. It reduces that shift's expected cash on **the day it is given**. The
  refunded sale's own day is unchanged: its figures stay as they were, with "refunded later"
  noted.
- **A cash refund with no open shift today** is recorded as "cash paid outside the till" and does
  not affect any expected cash.
- A transfer refund never affects expected cash.

**Recount (`stock.recount`, owner).** The owner sets the counted stock of a variant. The change
(old value, new value, who, when) is logged. This clears the "needs recount" flag. The full
inventory-movement history remains a later, separate step.

## 7. Account lifecycle (sessions revoked on every change)

| Action (owner only, password session) | Effect                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Create employee                       | Name, generated employee code; temporary PIN shown once; must change at first use |
| Rename                                | Name updated; `revokeAllSessions`                                                 |
| Disable                               | `active: false`; `revokeAllSessions`; cannot sign in; history kept                |
| Enable                                | `active: true`; PIN must be reset; `revokeAllSessions`                            |
| Reset PIN                             | New temporary PIN; PIN lockout counters cleared; `revokeAllSessions`              |
| Set own till PIN (owner)              | The owner's PIN for the till; ends the owner's PIN sessions                       |
| Delete                                | Not offered: sales reference people; anonymize after retention (topic 10)         |

- **Every** change to an account revokes that person's sessions **in the same server function**.
  Each action's test checks that a previously valid session is refused afterwards.
- There are no role changes. An employee can never become the owner (`single_owner` index), and
  nobody can act on the owner account through the app.

## 8. Owner dashboard (computed on demand)

`report.day.read` (owner, password session) takes a business day (default: today in Bangkok).
It is computed **when the owner opens it**, by aggregation queries over that day's records.
There is no scheduled job and no stored totals. Each figure is shown per till, and as a total
when there is more than one till.

| Figure              | Definition                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Sales total         | Sum of the day's `completed` + later-`refunded` sales (not cancelled)                             |
| Cash vs QR/transfer | The same split by payment method; **the QR total is the figure to check against the bank (O9)**   |
| Number of sales     | Count of those sales                                                                              |
| Cancels             | Count and amount; list with who and when                                                          |
| Refunds given today | Count and amount, cash vs transfer; list with the original sale's day                             |
| Start float         | `startFloat` of each shift                                                                        |
| Expected cash       | Start float + cash sales − cash refunds given today from that shift                               |
| Counted cash        | `countedCash`, with "closed at till" or "owner-closed", or "not closed" (with a Close button, O6) |
| Difference          | Counted − expected (when counted)                                                                 |
| Correction notes    | The shift's notes (O10), with an "Add note" action                                                |
| Needs recount       | Every variant with stock < 0 (any day), with a Recount action (O11)                               |

- Indexes: sales `{ businessDay: 1, status: 1 }` and `{ shiftId: 1 }`; refunds unique
  `{ saleId: 1 }` and `{ businessDay: 1 }`; shifts unique `{ deviceId: 1, businessDay: 1 }`;
  products `{ "variants.stock": 1 }` for the recount list. All are created by `db:setup-indexes`.
- The figures are recomputed from the records, so the owner always sees the true current state.

## 9. `requirePermission` middleware (replacing hard-coded `requireOwner`)

- Server-only `permissions.server.ts` holds `ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>>`
  plus the sets of **P**, **T** and **W** permissions. These are pure functions, unit-tested as a
  table against the matrix.
- `requirePermission(permission)` in `src/lib/auth.ts` returns a middleware built like
  `requireOwner` today. Usage: `.middleware([safeErrors, requirePermission("sale.create")])`.
- Per request it:
  - resolves the session (expiry, `endsAt`, lock, closing-only);
  - **re-reads the user from MongoDB** (role and active);
  - checks the session kind for **P** permissions;
  - checks the device token for **T** permissions;
  - checks the window for **W** permissions.

  It passes `{ user: { id, role }, sessionKind, deviceId }` to the handler. The handler never
  receives a role, a person, a price, a till or a time from the client.

- Refusals stay "Not signed in." / "Not allowed.", except time-window refusals, which say which
  window is closed (not a secret).
- `requireOwner` becomes a thin alias during migration. It is removed once every server function
  names a permission.
- **Tests:**
  - the full matrix (every server function × both roles × session kind × on/off a till × inside
    and outside windows, with a controllable clock);
  - the source check;
  - mutation checks: remove a check, widen a role, skip **P**, **T** or **W**, skip the re-read.

## 10. Audit events and data retention (Thailand PDPA)

Every audit event records:

- `at`, `actorId`, `actorRole` (at that time), `sessionKind`, `deviceId` (if any);
- `action`, `target`, `result` (`success` / `refused`) and a short summary.

Never: PINs, the PIN secret, passwords, tokens, token hashes, full User-Agent strings or IP
addresses.

- **Auth:** password and PIN sign-in success/failure, PIN lockout and escalation, lock, unlock,
  switch user, sign out, sign out everywhere, session ended by shift close or end time.
- **Tills:** registered, renamed, revoked.
- **People:** employee created, renamed, disabled, enabled, PIN reset, owner PIN set, sessions
  revoked.
- **Shift:** opened (float), closed at till, owner-closed, correction note added, refused outside
  a window.
- **Sales and money:** sale completed, sale cancelled (who, how long after), refund (method,
  shift).
- **Stock:** recount (old and new value).
- **Products and settings:** created, edited, price changed, archived/restored, settings changed.

**Retention (O13)**

| Data                                                       | Kept until                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sales, cancels, refunds, shifts, notes, money audit events | **5 years** after the business day (**to confirm with an accountant**) |
| Employee name and code referenced by those records         | As long as a referencing record is kept; then anonymized               |
| PIN hash                                                   | Deleted when the account is disabled                                   |
| PIN lockout counters                                       | Expire with their window (TTL)                                         |
| Session `createdIp`, `userAgent`, `lastSeenAt`             | **Deleted with the session** (unchanged, Step 7a)                      |

- Not stored: email (employees have no password), phone number, national ID, photos, address.
- The owner gives staff a short written notice of what is stored and why (NOT VERIFIED as
  legally sufficient; confirm with an advisor). Values are never logged.
- Nothing is deleted automatically after 5 years yet. A retention job is a later step, because
  F8's "no scheduled job" covers the dashboard only.

## 11. Demo boundary (unchanged)

- The `_shell` demo stays a browser-only simulation. Its `Role`, `EmployeeProfile`,
  `<OwnerOnly>`, role switch, approvals page and cash-drawer screens stay simulated and are
  **never** access control. Nothing in this decision changes the demo.
- Real screens get their own routes (proposal: `/owner/employees`, `/owner/day`, `/till/...`) and
  talk only to server functions.

## 12. Implementation slices (ordered; each needs its own approval)

O11 removes the dependency of sales on the inventory step. Sales now need only the shift slice,
plus the stock-rule change and transactions inside S9. A small owner recount slice (S13) is
added, so the "needs recount" flag can be cleared without waiting for inventory movements.

| #   | Slice                                                                                                                                                      | Size | Depends on |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| S1  | Permission table + `requirePermission` (P/T/W flags); migrate the product server functions; source check                                                   | S    | —          |
| S2  | User schema: `employee` role, employee code, PIN fields; index setup; existing owner unaffected                                                            | S    | S1         |
| S3  | Audit log foundation (append-only, write helper, owner-only read)                                                                                          | M    | —          |
| S4  | Owner employee management (create, rename, disable, enable, reset PIN, owner's own PIN); every change revokes sessions; UI                                 | M    | S2, S3     |
| S5  | Till registration (device cookie, owner register/list/revoke)                                                                                              | M    | S1         |
| S6  | PIN sign-in on registered tills: name list, `PIN_SECRET` HMAC + scrypt (fail closed), trivial-PIN check, per-person/per-till limits on the Step 5c limiter | L    | S4, S5     |
| S7  | Till session policy (Step 7b): `endsAt` 23:30 or shift close, closing-only 23:30–23:59, server-side 15-minute lock + PIN unlock, switch user               | M    | S6         |
| S8  | Business day + time windows; shift open (float, 07:00–23:15) and blind close (until 23:59, ends the till's sessions)                                       | M    | S7         |
| S9  | Sales: server-priced, Cash or QR, price snapshot, **one transaction with atomic stock decrement**, negative stock allowed (model rule change), 08:00–23:15 | L    | S8         |
| S10 | Own-sale cancel within 10 minutes (transaction, returns stock, logged) + the 10-minute own-sales list                                                      | S    | S9         |
| S11 | Owner day dashboard (on demand): totals, cash vs QR, cancels, float, expected vs counted, difference, needs-recount list; owner-close; correction notes    | M    | S10        |
| S12 | Owner whole-sale refunds (transaction, returns stock; a cash refund reduces expected cash on the day given)                                                | M    | S11        |
| S13 | Owner stock recount for a variant (clears "needs recount", logged)                                                                                         | S    | S11        |

Each slice gets:

- unit tests on the isolated database (sales slices on `MongoMemoryReplSet`);
- E2E where a browser flow exists;
- mutation checks for each protection;
- docs and CHANGELOG updates.

No new dependencies are expected: Node `crypto` covers HMAC and scrypt, `Intl` covers
Asia/Bangkok, and mongodb-memory-server covers replica sets. S6 needs the owner to set
`PIN_SECRET` on the host; agents never see or set it.

## 13. Open decisions

None. Two points remain to confirm outside the code:

- the 5-year retention, with an accountant (O13);
- that the staff notice is legally sufficient (topic 10).

The two readings at the top of this record (the closing-only session from 23:30 to 23:59, and
sales starting at 08:00) are applied unless the owner changes them before S7 and S8.
