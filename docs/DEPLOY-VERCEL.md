# Deploy to Vercel (personal testing only): owner checklist

For the **owner** to follow by hand. Agents do not run any of these steps: they need the owner's
accounts, real credentials and real database writes. Read
[decision 0003](decisions/0003-vercel-for-personal-testing.md) first.

- Vercel **Hobby** is for personal, non-commercial testing only.
- Use **test data only**. No real shop data, staff or customers.
- Commercial use needs Vercel Pro or the Node server path ([decision 0001](decisions/0001-runtime-node-not-workers.md)).

Keep every password and connection string in a password manager. Never paste them into chat,
code, commits, issues or screenshots.

## 1. MongoDB Atlas: free M0 cluster in Singapore

- [ ] Atlas → **Create cluster** → **M0 (Free)** → provider AWS (or another), region
      **Singapore (ap-southeast-1)**. Use a new project used only for this test, so nothing else
      shares its users or network rules.
- [ ] Name the database **`luxe`** (it is created on first write; nothing to do now).

## 2. Database user: `readWrite` on `luxe` only

- [ ] **Database Access → Add New Database User**, authentication **Password**.
- [ ] Username: e.g. `luxe-vercel-test`.
- [ ] Password: **Autogenerate Secure Password** (or at least 32 random characters, letters and
      digits only, so it needs no URL-encoding). Store it in your password manager. Never reuse
      it.
- [ ] **Database User Privileges → Specific Privileges → `readWrite`**, database **`luxe`**,
      collection empty (all collections). **Not** "Atlas admin" and **not** "Read and write to
      any database". (`readWrite` includes creating the indexes the setup script needs.)

## 3. Network access: `0.0.0.0/0` (accepted risk)

- [ ] **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)**. Vercel
      Hobby has no fixed outgoing IP. From now on the long password in step 2 and TLS are the
      only protection. This is why the database holds test data only.

## 4. Connection string

- [ ] **Connect → Drivers** gives `mongodb+srv://<user>:<password>@<cluster-host>/?...`.
      Add the database name **before** the `?`:
      `mongodb+srv://luxe-vercel-test:<password>@<cluster-host>/luxe?retryWrites=true&w=majority`.
      The app takes the database name from this path, and an empty path would use `test`.
- [ ] If the password has symbols, URL-encode them (or regenerate a letters-and-digits one).

## 5. Create the indexes and the owner from your laptop (real-database writes)

Run these in the project folder on your own computer. The scripts read `MONGODB_URI`.

- [ ] Put the Atlas string into `MONGODB_URI` for this terminal without it landing in your shell
      history:

  ```sh
  read -rs MONGODB_URI && export MONGODB_URI   # paste, press Enter (nothing is shown)
  ```

  Bun also loads `.env`; Bun's documentation says variables already set in the shell take
  precedence (NOT VERIFIED in this project). If your `.env` points at another database, check
  the script output or temporarily move `.env` aside.

- [ ] Only if this database already has products created before 2026-11-01 (whole baht):
      `bun run db:migrate-money-satang` (dry run: counts only) and then
      `bun run db:migrate-money-satang --apply`. A new, empty database needs neither.
- [ ] `bun run db:setup-indexes` → expect "Database indexes are in place. Product creation is
      enabled." It creates the session TTL, login-attempt TTL (`login_attempt_expiry`), unique
      email, single-owner and product indexes. It changes no data.
- [ ] `bun run auth:create-owner` → enter your email, name and a **new** password (10–128
      characters, not used anywhere else).
- [ ] Interim Quick Sales ([decision 0004](decisions/0004-interim-quick-sales.md)): for each staff
      account, `bun run auth:create-staff` → their email, name and their own **new** password
      (10–128 characters). Staff sign in at `/login` and can only use `/quick-sales`. Refuses an
      email that already exists. **Note:** this deployment is for test data only (decision 0003);
      real staff recording real shop sales here would be commercial use of the Hobby plan.
- [ ] `unset MONGODB_URI` and close the terminal.

## 6. Vercel project

- [ ] Vercel → **Add New → Project** → import the private GitHub repository
      `NirejBatrai/Nil_Ready_Made`. This connects an external service to the repository; Lovable
      stays disconnected.
- [ ] **Framework preset:** Other. **Install command:** `bun install --frozen-lockfile`.
      **Build command:** `bun run build`. **Output directory:** leave empty (Vercel uses the
      `.vercel/output` folder the build writes).
- [ ] **Node.js version:** 24.x (the build writes `runtime: nodejs24.x` for the function).
- [ ] **Functions region:** Singapore (`sin1`), next to the database.
- [ ] **Deployment Protection:** keep **Vercel Authentication** on for **Preview** deployments.

### Environment variables (Settings → Environment Variables)

| Name                     | Value                                                               | Environments       |
| ------------------------ | ------------------------------------------------------------------- | ------------------ |
| `MONGODB_URI`            | the connection string from step 4                                   | **Production**     |
| `NITRO_PRESET`           | `vercel` (Vercel's `VERCEL=1` also selects it; explicit is clearer) | Production (build) |
| `SECURITY_HSTS_MAX_AGE`  | **leave unset** (see step 8)                                        |                    |
| `DB_HEALTHCHECK_ENABLED` | **leave unset**                                                     |                    |
| `SUMMARY_API_TOKEN`      | output of `openssl rand -base64 32` (44 characters; ≥ 32 required)  | **Production**     |

- [ ] Mark `MONGODB_URI` as **Sensitive**. Give it to **Production only**, so preview builds of
      other branches cannot reach the database.
- [ ] Mark `SUMMARY_API_TOKEN` as **Sensitive**, **Production only**. Generate it on your own
      computer with `openssl rand -base64 32`, paste it straight into Vercel and your password
      manager (later: n8n's credential store), never into chat, code or commits. Without it, or
      with fewer than 32 characters, `/api/daily-summary` answers 503 to everyone (fail closed).
- [ ] Do **not** set `VERCEL` yourself (Vercel sets it). Never add any `VITE_*` variable holding
      a secret: `VITE_*` values are sent to the browser.

## 7. Deploy

- [ ] Trigger the production deployment (the import does it; later, push to the production
      branch you chose).
- [ ] The build log should show `Generated .vercel/output/nitro.json`. If it shows
      `.output/server`, the preset was not applied: check `NITRO_PRESET`.

## 8. Smoke test (replace `https://<app>.vercel.app`)

Things that could only be checked on a real deployment (decision 0003). Record the results in
`docs/CHANGELOG.md`.

- [ ] **Pages:**
      `curl -sI https://<app>.vercel.app/login`. Expect status 200, `cache-control: no-store`,
      `x-frame-options: DENY`, `content-security-policy: frame-ancestors 'none'`,
      `x-content-type-options: nosniff`,
      `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: …`.
      **Note whether any of them appears twice or as `DENY, DENY`** (route header plus app
      header). A doubled `X-Frame-Options` can be ignored by browsers: report it.
- [ ] **Static files:**
      `curl -sI https://<app>.vercel.app/favicon.ico`. Expect the same five headers (no
      `no-store`).
- [ ] **Hashed assets:** take a `/assets/….js` URL from the page source, then
      `curl -sI https://<app>.vercel.app/assets/<file>.js`. Expect status 200, the five headers
      **and** `cache-control: public, max-age=31536000, immutable`. A 404 here means Nitro's
      `/assets/(.*)` route stops routing on Vercel: report it.
- [ ] **HSTS:** `curl -sI` shows whether Vercel sends `strict-transport-security` on
      `*.vercel.app` by itself. Leave `SECURITY_HSTS_MAX_AGE` unset for this test deployment.
- [ ] **No secrets leak:** `curl -s https://<app>.vercel.app/_headers` → 404, and
      `/dev/db-health` shows "disabled".
- [ ] **Sign-in:** sign in at `/login` → `/owner/products` (empty list). Add a product, edit
      it, archive it, see it under Archived, restore it.
- [ ] **Login limit uses your address, not Vercel's:** sign out, then try a wrong password 6
      times. Expect "Too many attempts. Try again later." on the 6th. In Atlas → Browse
      Collections → `luxe.login_attempts`, the `address|…` document must show **your own**
      public IP (compare with e.g. `curl -s https://api.ipify.org`), not a Vercel address. A
      phone on mobile data (another address) must still be able to sign in.
- [ ] **Counts survive instances:** a redeploy, or 15+ minutes of idle time, must not reset an
      active block (the documents stay in `login_attempts` until their window ends). After 15
      minutes plus about a minute (TTL monitor), they disappear by themselves.
- [ ] **Cookie:** in the browser's dev tools, the session cookie is `__Host-luxe_session`,
      `Secure`, `HttpOnly`, `SameSite=Lax`.
- [ ] **Sign out everywhere** works.
- [ ] **Quick Sales (decision 0004):** sign in as a staff account → lands on `/quick-sales`;
      record the change money, add a sale with decimals, cancel it. `/owner/products` and `/`
      send staff back to `/quick-sales`. As the owner, `/owner/today` shows the day.
- [ ] **Summary API:** `curl -s https://<app>.vercel.app/api/daily-summary` → 401
      `{"error":"Not allowed."}`. With the token (typed from your password manager, not saved in
      shell history) → the day's JSON:

  ```sh
  read -rs T && curl -s -H "Authorization: Bearer $T" https://<app>.vercel.app/api/daily-summary; unset T
  ```

## When testing ends, or before any real use

- [ ] Delete the Vercel project (or remove `MONGODB_URI` and `SUMMARY_API_TOKEN`), and delete the
      Atlas test user (or rotate its password).
- [ ] Revisit [decision 0003](decisions/0003-vercel-for-personal-testing.md) before the shop
      uses the app: host (Pro or VPS), Atlas network access, backups and trusted-proxy handling.
