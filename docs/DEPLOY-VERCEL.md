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

## 5. Create the indexes and the accounts from your laptop (real-database writes)

Run these in the project folder on your own computer. Use the **rotated** Atlas password: the
earlier one was exposed and must not be used anywhere. Never let the connection string reach your
shell history, a file or a chat.

- [ ] Read the Atlas string once into a shell variable (nothing is shown, nothing is saved):

  ```sh
  read -rs ATLAS_URI   # paste the string from step 4, press Enter
  ```

- [ ] Run every script with `MONGODB_URI` set **for that one command only**. A variable set this
      way takes precedence over `.env` (VERIFIED 2026-11-01 with Bun 1.4.4: a variable that is already set is not overridden by `.env`),
      so these commands use the Atlas database, not the one your local `.env` names:

  ```sh
  MONGODB_URI="$ATLAS_URI" bun run <script>
  ```

- [ ] Only if this database already has products created before 2026-11-01 (whole baht):
      `MONGODB_URI="$ATLAS_URI" bun run db:migrate-money-satang` (dry run: counts only), then
      the same with `--apply`. A new, empty database needs neither.
- [ ] `MONGODB_URI="$ATLAS_URI" bun run db:setup-indexes`. Expect "Database indexes are in place.
      Product creation is enabled." It creates the session TTL, login-attempt TTL
      (`login_attempt_expiry`), unique email, single-owner and product indexes. It changes no
      data.
- [ ] `MONGODB_URI="$ATLAS_URI" bun run auth:create-owner`. Enter your email, your name and a
      **new** password (10–128 characters, not used anywhere else).
- [ ] Interim Quick Sales ([decision 0004](decisions/0004-interim-quick-sales.md)): for each
      staff account, run `MONGODB_URI="$ATLAS_URI" bun run auth:create-staff` and enter their
      email, name and their own **new** password (10–128 characters). Staff sign in at `/login`
      and can only use `/quick-sales`. The script refuses an email that already exists.
      **Note:** this deployment is for test data only (decision 0003). Real staff recording real
      shop sales here would be commercial use of the Hobby plan.
- [ ] **Forgotten or exposed password** (owner or staff, at any time later): run
      `MONGODB_URI="$ATLAS_URI" bun run auth:reset-password`. Enter the account's email and the
      new password twice (hidden). It uses the same rules and hashing as account creation and
      changes only the password, so the role and the one-owner rule are untouched. Afterwards it
      signs that account out on **every** device. An unknown email gets only "No such user."
- [ ] `unset ATLAS_URI` and close the terminal.

## 6. Vercel project

### 6a. Keep the repository private and give Vercel access to it

- [ ] GitHub → `NirejBatrai/Nil_Ready_Made` → **Settings → General**: the repository must be
      **Private**. (Danger Zone → Change visibility, if it is not.) Agents never change this.
- [ ] Give Vercel's GitHub app access to **this repository only**. Either:
  - in Vercel's import screen, use **Adjust GitHub App Permissions**; or
  - in GitHub, go to **Settings (your account) → Applications → Installed GitHub Apps → Vercel →
    Configure → Repository access → Only select repositories**, and add `Nil_Ready_Made`.

  Do not grant access to all repositories. This connects an external service to the
  repository; Lovable stays disconnected. (These Vercel and GitHub menu names are NOT VERIFIED;
  they may differ slightly.)

### 6b. Import, then set the Production Branch BEFORE the real deploy

The import screen has no branch choice, and its first deployment builds the repository's default
branch, `main`. `main` is the old browser-only demo with no backend. Order the steps so that no
secret is ever available to a `main` build, and so that the real deployment comes from
`feature/mongodb-foundation`:

- [ ] Vercel → **Add New → Project** → import `NirejBatrai/Nil_Ready_Made`, and set the following
      on the import screen. **Add no environment variables yet.**
  - **Framework preset:** Other.
  - **Install command:** `bun install --frozen-lockfile`.
  - **Build command:** `bun run build`.
  - **Output directory:** leave empty (Vercel uses the `.vercel/output` folder the build
    writes).
- [ ] Let that first deployment of `main` finish (or cancel it). Do not use it.
- [ ] **Settings → Git → Production Branch** = `feature/mongodb-foundation`, then save. (Newer
      Vercel UIs may show this under **Settings → Environments → Production → Branch Tracking**;
      NOT VERIFIED.)
- [ ] **Settings → Functions → Node.js version:** 24.x (the build writes `runtime: nodejs24.x`
      for the function). **Functions region:** Singapore (`sin1`), next to the database.
- [ ] **Deployment Protection:** keep **Vercel Authentication** on for **Preview** deployments.

### 6c. Environment variables (Settings → Environment Variables)

Add these only **after** the Production Branch is set.

| Name                     | Required?            | Value / scope                                                                                                 | If missing                                                                                              |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`            | **Required**         | The **rotated** Atlas string from step 4, with `/luxe` before the `?`. **Production** only, **Sensitive**     | Every database page shows "cannot be reached"; sign-in fails safely                                     |
| `SUMMARY_API_TOKEN`      | Required for the API | Output of `openssl rand -base64 32` (44 characters; at least 32 required). **Production** only, **Sensitive** | `/api/daily-summary` answers 503 to everyone (fails closed); nothing else is affected                   |
| `NITRO_PRESET`           | Optional             | `vercel`. Vercel's own `VERCEL=1` already selects it; setting it explicitly is clearer                        | The build still uses the `vercel` preset (through `VERCEL=1`)                                           |
| `DEMO_ENABLED`           | **Leave unset**      | (`true` would offer the demo)                                                                                 | The demo stays off: `/` shows only Sign in, and demo screens redirect to `/login`                       |
| `DB_HEALTHCHECK_ENABLED` | **Leave unset**      | —                                                                                                             | `/dev/db-health` stays disabled                                                                         |
| `SECURITY_HSTS_MAX_AGE`  | **Leave unset**      | (see step 8)                                                                                                  | The app sends no HSTS header of its own. Whether Vercel adds one on `*.vercel.app` is a smoke-test item |

- [ ] Give `MONGODB_URI` and `SUMMARY_API_TOKEN` to **Production only**, so preview builds of
      other branches cannot reach the database or the API.
- [ ] Generate `SUMMARY_API_TOKEN` on your own computer. Paste it straight into Vercel and into
      your password manager (later also n8n's credential store). Never put it in chat, code or
      commits.
- [ ] Do **not** set `VERCEL` yourself (Vercel sets it). Never add a `VITE_*` variable holding
      a secret: `VITE_*` values are sent to the browser.

## 7. Deploy

- [ ] **Deployments → Redeploy** the latest `feature/mongodb-foundation` deployment, or push to
      that branch. Check that the deployment's branch is `feature/mongodb-foundation`, **not**
      `main`.
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
- [ ] **Start page:** `/` shows only the heading and **Sign in**: no demo accounts, and no
      "demo" in the tab title (it reads "Luxe Retail OS — sign in"). `/pos`, `/sales` and
      `/dashboard` redirect to `/login`.
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
- [ ] **Quick Sales, staff (decision 0004):** sign in as a staff account; you land on
      `/quick-sales`. Then check:
  - Record the change money.
  - **Payment buttons:** neither Cash nor QR is selected at first, and **Add** stays disabled
    until the item, the amount and a payment are all set. The chosen button is filled, with a
    check mark; the other is plainly outlined.
  - Add a sale with decimals. "Saved ✓" appears, and the item, the amount and the payment are
    all cleared again.
  - **"Your sales today"** lists all of this account's sales of today, newest first, and no
    totals, sums or counts. Another staff account's sales never appear.
  - **Cancel** shows only on entries under 10 minutes old. Cancel one; it stays listed, crossed
    out.
  - `/owner/products` and `/` send staff back to `/quick-sales`.
- [ ] **Quick Sales, owner:** `/owner/today` shows the day's totals and every sale. Then check:
  - **Cancel** a staff sale. The dialog needs a reason (Confirm stays disabled without one); the
    sale shows "Cancelled" with the reason, and the totals drop.
  - **Remove** a sale with a reason. It disappears from the list, from the totals, from the
    staff page and from `/api/daily-summary`.
  - **Show removed** lists it greyed out, with who, when and why. **Restore** brings it back
    into the list and the totals.
  - **Remove opening change** with a reason: the opening shows "Not recorded". A staff account
    can then record a new one the same day, and the old one appears under Show removed as
    replaced.
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
