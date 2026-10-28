# 0001 — Run on a Node.js server, not Cloudflare Workers

- **Status:** Accepted by the owner, 2026-10-28.
- **Evidence:** Step 4, a time-boxed local Workers runtime test (2026-10-28). It ran on the
  throwaway branch `spike/workers-runtime`, which is not merged. Its code is deliberately not
  copied into this repository; only its findings are recorded here.

## Context

The project was generated with Lovable, whose build defaults to Nitro's `cloudflare-module`
preset (Cloudflare Workers with `nodejs_compat`). The backend was then built and tested only
under Node.js:

- one shared, pooled Mongoose connection per process;
- in-memory login limits and a 2-at-once bound on password hashing;
- `crypto.scrypt` running on Node's thread pool;
- the client address taken from the TCP socket.

The unit and E2E suites run under Node (Vitest, `vite dev`). Two things had never been checked:
whether the code works under workerd (the Workers runtime), and whether it fits Workers' limits.

## How Step 4 tested it

- `wrangler dev --local` (workerd, wrangler 4.153.0) with a throwaway `mongod` 8.2.6 on
  `127.0.0.1`.
- No Cloudflare account, no deploy, no Atlas, no `.env`.
- Nitro generated `compatibility_date: "2026-10-28"` (the build date, not pinned) and
  `compatibility_flags: ["nodejs_compat"]`, with `no_bundle: true`.
- Local workerd does not enforce CPU limits, so all CPU and time figures below are
  **estimates**.

## Evidence (Step 4, 2026-10-28)

| #   | Check                                     | Result                         | Finding                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build and start under workerd             | PASS                           | Build succeeds; server bundle 5.8 MiB uncompressed (limit 64 MiB).                                                                                                                                                                                                                                                                            |
| 2a  | Mongoose connects, app as built           | **FAIL**                       | `Error: No such module "node:process"` while the bundled MongoDB driver loads. The bundle loads Node built-ins through `createRequire`, and workerd's `require` has no `node:process` (`node:fs`, `net`, `tls`, `dns`, `crypto` load). The `enable_nodejs_process_v2` flag did not help. The app showed this as "database cannot be reached". |
| 2b  | Mongoose connects, build output patched   | PASS                           | After replacing the 8 `require("node:process")` calls in the built driver by hand: connect 8–16 ms to local MongoDB. A rebuild undoes the patch; it is not a fix.                                                                                                                                                                             |
| 2c  | Connection reuse across requests          | FAIL (expected)                | A connection opened in one request hangs when used in the next ("code had hung"). One connection per request is mandatory on Workers.                                                                                                                                                                                                         |
| 2d  | Cold start                                | PASS (estimate)                | First request 130–170 ms, then ~15 ms (startup limit 1 s).                                                                                                                                                                                                                                                                                    |
| 3   | Login, product list, create (patched)     | PASS                           | UI login 482 ms; list rendered; create to visible row 261 ms; persisted after reload. A hash created under Bun verified under workerd.                                                                                                                                                                                                        |
| 4a  | `node:crypto` scrypt available            | PASS                           | Present and compatible with Node-created hashes.                                                                                                                                                                                                                                                                                              |
| 4b  | scrypt time (N=2^15, r=8, p=3), estimate  | **FAIL on Free**, PASS on Paid | ~275–340 ms per hash. 2 hashes: 580 ms; 4 hashes: 1,066 ms, so hashes run one after another on the request thread (no thread pool). Free plan: 10 ms CPU per request. Paid: 30 s by default, up to 5 min.                                                                                                                                     |
| 4c  | Memory per hash                           | Inconclusive                   | Theory: 128·N·r = 32 MiB per hash (isolate limit 128 MB). Measured process memory rose under 1 MB, which is unexplained, so not relied on.                                                                                                                                                                                                    |
| 5a  | `navigator.userAgent`                     | PASS                           | `"Cloudflare-Workers"`.                                                                                                                                                                                                                                                                                                                       |
| 5b  | `CF-Connecting-IP` and per-address limits | PASS                           | Present locally (`127.0.0.1`). The 6th attempt per email + address and the 21st per address were refused.                                                                                                                                                                                                                                     |
| 5c  | Client-supplied `CF-Connecting-IP`        | **FAIL locally**               | Local wrangler passes a client's own `CF-Connecting-IP` through; a spoofed value signed in a blocked owner. Cloudflare's edge is documented to overwrite it (not verified).                                                                                                                                                                   |
| 6   | Settings and fail-safe                    | PASS                           | `process.env` works. Over local https, `SECURITY_HSTS_MAX_AGE=300` sent `max-age=300`; an invalid value sent none. No `MONGODB_URI` gave the normal "unavailable" page, with nothing leaked.                                                                                                                                                  |
| 7   | Security headers                          | PASS                           | Baseline + `no-store` on dynamic responses; `public/_headers` rules applied to static files locally.                                                                                                                                                                                                                                          |

Limits are from Cloudflare's [Workers limits page](https://developers.cloudflare.com/workers/platform/limits/)
(updated 2026-10-12):

- CPU time: Free 10 ms per request; Paid 30 s by default, up to 5 min (waiting on I/O does not
  count).
- 128 MB memory per isolate.
- 1 s startup.
- 64 MiB uncompressed bundle.
- 6 simultaneous connections per request.

## Decision

Production runs as a **Node.js server** (Node LTS) built with Nitro's `node-server` preset. It
is not built for Cloudflare Workers. The hosting provider is not chosen yet.

## Alternatives rejected

1. **Workers as-is.** The app does not work: every database call fails while the driver loads
   (2a).
2. **Workers with changes.** All of the following would be needed:
   - a build fix for the driver's `node:process` loading (2a);
   - the Paid plan, because of scrypt CPU time (4b);
   - a shared rate-limit store (Durable Object), because in-memory limits are per isolate;
   - rethinking the hashing bound, because hashes run one after another on the request thread;
   - a new TLS connection to Atlas on every request (2c);
   - an open Atlas IP allowlist, because Workers have no fixed outgoing address;
   - verifying the edge's `CF-Connecting-IP` overwrite (5c).

   That is a migration, not configuration. It would also leave the code running somewhere the
   test suite does not run.

## Consequences

- **Keeps current design.** The backend's design stays as built and verified: pooled connection,
  in-memory limits per process, scrypt on the thread pool, socket address. Tests and production
  share one runtime.
- **Build target.** Nitro `node-server`, started with `node .output/server/index.mjs` (Step 5b).
  Static files are then served by the Node server. Cloudflare's `public/_headers` no longer
  applies, so its rules must be replaced server-side (Step 5b).
- **Claims now historical.** Workers-specific statements in the docs are kept but marked
  historical. This covers:
  - the `CF-Connecting-IP` branch;
  - per-isolate limits;
  - one connection per request;
  - `_headers` on Cloudflare;
  - the request URL scheme at the edge.
- **Code kept for now.** The Workers detection (`navigator.userAgent === "Cloudflare-Workers"` in
  `db.server.ts` and `client-address.server.ts`) and the `punycode/` alias in `nitro.config.ts`
  stay unchanged. Both are candidates for removal.
- **Required before any real deployment: trusted-proxy handling.** Behind a reverse proxy,
  Cloudflare proxy or Cloudflare Tunnel, every request arrives from the proxy's address. The
  per-address limit (20 per 15 minutes) would then become a **global lockout**. HSTS would also
  never be sent, because the app sees `http`. The design depends on the hosting choice (see
  [ROADMAP.md](../ROADMAP.md)).
- **Process limits.** Login limits and the hashing bound are per process. One Node process gives
  exactly the documented limits. Several processes or instances would each allow their own quota
  until a shared store exists.
- **Runtime.** Node LTS, not Bun, for production. The test suite (Vitest, `vite dev`) and the
  scrypt thread-pool behaviour are verified under Node only. Bun stays the package manager and
  runs the local owner scripts.
