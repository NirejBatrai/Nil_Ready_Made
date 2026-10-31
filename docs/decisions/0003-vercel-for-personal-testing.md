# 0003 — Vercel (Hobby) for personal testing only

- **Status:** Accepted by the owner, 2026-10-31 (Step 5c). **Revisit before any real shop uses
  the app.**
- **Relation to 0001:** [decision 0001](0001-runtime-node-not-workers.md) stays the production
  path: a Node.js server (Nitro `node-server`). This record adds a second, **temporary** target
  for the owner's own testing. It does not replace 0001.

## Context

The owner wants to try the real app on the internet before choosing a host for the shop. A Node
VPS needs payment, accounts and server administration, which is paused (see
[ROADMAP.md](../ROADMAP.md)). Vercel can run the app as Node.js functions from Nitro's `vercel`
preset at no cost on the Hobby plan.

Three parts of the app were built for one long-running Node process. Each is unsafe on Vercel as
it was:

- **Client address.** Vercel's proxy owns the socket. Every visitor would share one address,
  so the per-address login limit would become a global lockout.
- **Login limits.** They were in memory, per process. Vercel runs several short-lived instances,
  so each instance would allow its own quota, and every cold start would reset the counts.
- **Static files.** Vercel serves them itself from `.vercel/output/static`, using the routes in
  `.vercel/output/config.json`. The Node server's route rule does not apply there unless Nitro
  writes it into that file correctly.

## Decision

1. **Vercel Hobby is for the owner's personal, non-commercial testing only.** Vercel's Hobby
   plan is limited to personal, non-commercial use. No real shop data, no staff and no
   customers use the Vercel deployment.
2. **Commercial use needs a different path:** Vercel Pro (a paid plan), or the `node-server` VPS
   path of decision 0001. That decision is made before the shop relies on the app.
3. **MongoDB Atlas must allow `0.0.0.0/0`.** Vercel functions have no fixed outgoing IP address
   on Hobby, so Atlas cannot be limited to known addresses. The database is then protected only
   by its **credentials and TLS**: a dedicated database user with `readWrite` on the app's
   database only, and a long random password. Anyone on the internet can attempt to connect;
   only the password stops them.
4. **Code changes (Step 5c) so login is safe on Vercel:**
   - **Client address.** On Vercel (detected by the runtime variable `VERCEL=1`, never by
     request data), the address is the first entry of `x-vercel-forwarded-for`, which Vercel's
     edge sets. Off Vercel, behaviour is unchanged: the socket address, all headers ignored.
   - **Login limits in MongoDB** (`login_attempts`), shared by all instances, with a TTL index.
     If the counters cannot be reached, login fails closed.
   - **Build preset.** `NITRO_PRESET=vercel`, or Vercel's own `VERCEL=1` during its build,
     produces `.vercel/output`. `node-server` stays the default.
   - **Static-file headers.** On the Vercel build, the baseline security headers are the first
     route, for every path, with `continue: true` (see Consequences).

## Alternatives rejected

- **Pay for a VPS now:** paused by the owner.
- **Vercel with in-memory limits:** quotas multiply with instances and reset on cold starts.
- **Trust `X-Forwarded-For` on Vercel:** Vercel documents `x-vercel-forwarded-for` as its own
  header for the client address. Being explicit is safer than a generic proxy header.
- **Fail open when the counters are unreachable:** unlimited password guessing exactly when the
  database is degraded. Login needs the database anyway (user lookup, session), so failing
  closed costs almost nothing extra.

## Consequences

- **Atlas is reachable from anywhere** (risk accepted for testing only).
- **Data and credentials.** Only test data goes into this database. The Atlas password for this
  deployment must never be reused, and it is rotated before any real use.
- **Login cost.** Every login makes 3–5 extra small database writes (counting and un-counting).
- **Vercel routing is not verified on a real deployment.** It was checked by building locally
  with the `vercel` preset and reading `.vercel/output/config.json`, not on Vercel itself.
  - Nitro writes route-rule headers without `continue: true`, after its own `/assets/(.*)` cache
    rule. Under the Build Output API's documented rule (routing stops at the first match
    without `continue`), that would leave hashed assets without the baseline headers. Its
    header-only catch-all would also stop routing before the app function.
  - The Vercel build therefore emits the baseline as the first route, for every path, with
    `continue: true`, and no route rule.
  - Not verified until the first real deployment:
    - whether a page response then carries each header once or twice (route header plus
      function header);
    - Nitro's own `/assets/(.*)` cache route, which has no `continue`, still serving the file;
    - the request URL scheme seen by the function, which decides HSTS.
  - [DEPLOY-VERCEL.md](../DEPLOY-VERCEL.md) has the smoke test that checks these.
- **Personal data.** Login keys (email + client address) are stored in `login_attempts` for the
  15-minute window plus TTL delay. Atlas stores data in the region the owner chooses
  (Singapore).
- **Before any real shop use, revisit:**
  - the host (Pro or VPS);
  - the Atlas network access (fixed egress IP and allowlist, or private networking);
  - backups;
  - trusted-proxy handling for the chosen host;
  - this record.
